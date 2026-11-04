import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { LDAP_DEFAULTS, LDAP_PROFILE_DEFAULTS, type LdapTestResultDTO } from '../../shared/ldap.ts';
import { buildFilter, displayName, escapeFilterValue } from '../auth/ldap.ts';
import { createSelfSignedCertificate } from '../system/selfSigned.ts';
import { bootServer, TestClient } from './helpers.ts';
import { startDirectory, type FakeDirectory } from './ldapServer.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('authentification LDAP', () => {
  it('échappe les valeurs placées dans le filtre', () => {
    assert.equal(escapeFilterValue('a*b(c)d\\e'), 'a\\2ab\\28c\\29d\\5ce');
    assert.equal(escapeFilterValue('prénom.nom@exemple.fr'), 'prénom.nom@exemple.fr');
    assert.equal(buildFilter('(|(mail={user})(uid={user}))', '*)(uid=*'), '(|(mail=\\2a\\29\\28uid=\\2a)(uid=\\2a\\29\\28uid=\\2a))');
    assert.equal(buildFilter('(mail={user})', '$&'), '(mail=$&)', 'pas de motif de remplacement');
  });

  it('lit le nom selon le profil', () => {
    assert.equal(displayName('classic', ' Jean Dupont '), 'Jean Dupont');
    assert.equal(displayName('classic', 'DUPONT, Jean (ACME)'), 'DUPONT, Jean (ACME)');
    assert.equal(displayName('specific', 'DUPONT, Jean (ACME)'), 'Jean DUPONT');
    assert.equal(displayName('specific', 'DUPONT, Jean'), 'Jean DUPONT');
    assert.equal(displayName('specific', 'DUPONT'), 'DUPONT');
    assert.equal(displayName('specific', ''), '');
  });

  describe('API', () => {
    let app: Booted;
    let directory: FakeDirectory;
    let admin: TestClient;
    const JEAN = { dn: 'CN=DUPONT\\, Jean (ACME),OU=People,DC=test', password: 'motdepasse-jean', attributes: { objectCategory: 'person', objectClass: 'person', cn: 'DUPONT, Jean (ACME)', mail: 'jean.dupont@exemple.fr', uid: 'jdupont', displayName: 'Jean Dupont', userPassword: 'ne-pas-afficher' } };
    const LUCIE = { dn: 'CN=MARTIN\\, Lucie,OU=People,DC=test', password: 'motdepasse-lucie', attributes: { objectCategory: 'person', objectClass: 'person', cn: 'MARTIN, Lucie', mail: 'lucie.martin@exemple.fr', uid: 'lmartin' } };
    const ROOT = { dn: 'CN=ROOT,OU=People,DC=test', password: 'motdepasse-root', attributes: { objectCategory: 'person', cn: 'ROOT', mail: 'admin@admin.com' } };

    const settings = (extra: Record<string, unknown> = {}) => ({
      ...LDAP_DEFAULTS,
      ...LDAP_PROFILE_DEFAULTS.specific,
      enabled: true,
      profile: 'specific',
      host: '127.0.0.1',
      port: directory.port,
      bindDn: directory.service.dn,
      searchBase: 'DC=test',
      ...extra,
    });
    const configure = async (extra: Record<string, unknown> = {}) => {
      const response = await admin.request('PUT', '/api/admin/auth', settings(extra));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response;
    };
    const signIn = async (login: string, password: string) => {
      const client = app.client();
      return { client, response: await client.login(login, password) };
    };
    const test = async (extra: Record<string, unknown>) => (await admin.post('/api/admin/auth/ldap/test', { ...settings(), ...extra })).body as LdapTestResultDTO;
    const removeAccount = (email: string) => app.running.ctx.db.run('DELETE FROM users WHERE email = ? COLLATE NOCASE', email);

    before(async () => {
      directory = await startDirectory([JEAN, LUCIE, ROOT]);
      app = await bootServer();
      admin = app.client();
      await admin.login('admin@admin.com', 'admin1234');
      await configure({ bindPassword: directory.service.password });
    });

    beforeEach(async () => {
      directory.entries = [JEAN, LUCIE, ROOT];
      directory.anonymousSearch = false;
      await configure();
      removeAccount(JEAN.attributes.mail);
      removeAccount(LUCIE.attributes.mail);
    });

    after(async () => {
      await app.running.close();
      await directory.close();
    });

    it('ne renvoie jamais le mot de passe du compte de service', async () => {
      const { ldap } = (await admin.get('/api/admin/auth')).body;
      assert.equal(ldap.hasBindPassword, true);
      assert.equal(ldap.bindPassword, undefined);
      assert.ok(!JSON.stringify(ldap).includes(directory.service.password));
      const stored = app.running.ctx.db.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'ldap'")!.value;
      assert.ok(!stored.includes(directory.service.password), 'chiffré en base');
    });

    it('annonce la connexion LDAP à la page de connexion', async () => {
      await configure({ loginLabel: 'Identifiant maison' });
      assert.deepEqual((await app.client().get('/api/app')).body.ldap, { loginLabel: 'Identifiant maison' });
      await configure({ enabled: false });
      assert.equal((await app.client().get('/api/app')).body.ldap, null);
    });

    it('crée le compte à la première connexion, sans garder le mot de passe, puis le retrouve', async () => {
      const first = await signIn(JEAN.attributes.mail, JEAN.password);
      assert.equal(first.response.status, 200, JSON.stringify(first.response.body));
      const { user } = first.response.body;
      assert.equal(user.name, 'Jean DUPONT', 'nom « NOM, Prénom (Société) » du profil spécifique');
      assert.equal(user.email, JEAN.attributes.mail);
      assert.equal(user.authSource, 'ldap');
      assert.equal(user.roleKey, 'member');
      assert.ok(directory.binds.includes(JEAN.dn), 'le mot de passe est vérifié avec le DN de la personne');
      const row = app.running.ctx.db.get<{ password_hash: string; ldap_dn: string }>('SELECT password_hash, ldap_dn FROM users WHERE id = ?', user.id)!;
      assert.equal(row.ldap_dn, JEAN.dn);
      assert.ok(!row.password_hash.includes(JEAN.password));
      assert.equal((await first.client.get('/api/me')).status, 200, 'session ouverte');

      const second = await signIn(JEAN.attributes.mail.toUpperCase(), JEAN.password);
      assert.equal(second.response.body.user.id, user.id);
    });

    it('applique le rôle choisi et refuse les mauvais mots de passe', async () => {
      const roles = (await admin.get('/api/roles?scope=global')).body.roles as Array<{ id: number; key: string }>;
      await configure({ defaultRoleId: roles.find((role) => role.key === 'guest')!.id });
      assert.equal((await signIn(JEAN.attributes.mail, JEAN.password)).response.body.user.roleKey, 'guest');
      await configure();

      const wrong = await signIn(LUCIE.attributes.mail, 'mauvais');
      assert.equal(wrong.response.status, 401);
      assert.equal(wrong.response.body.error.message, 'Identifiant ou mot de passe incorrect.');
      assert.equal((await signIn('personne@exemple.fr', 'x')).response.status, 401);
      assert.equal((await signIn(LUCIE.attributes.mail, '')).response.status, 400, 'pas de connexion anonyme avec un mot de passe vide');
    });

    it('résiste à l’injection dans le filtre', async () => {
      // Une seule entrée : sans échappement, le joker la trouverait et le mot de passe serait accepté.
      directory.entries = [JEAN];
      for (const login of ['*', '*)(mail=*', 'jean.dupont@exemple.fr)(|(mail=*']) {
        assert.equal((await signIn(login, JEAN.password)).response.status, 401, login);
      }
    });

    it('refuse une recherche ambiguë', async () => {
      directory.entries = [JEAN, { ...LUCIE, attributes: { ...LUCIE.attributes, mail: JEAN.attributes.mail } }];
      assert.equal((await signIn(JEAN.attributes.mail, JEAN.password)).response.status, 401);
    });

    it('profil classique : autre attribut d’identifiant, nom lu tel quel', async () => {
      await configure({ ...LDAP_PROFILE_DEFAULTS.classic, profile: 'classic' });
            const { response } = await signIn('jdupont', JEAN.password);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.user.name, 'Jean Dupont');
      assert.equal(response.body.user.email, JEAN.attributes.mail);
    });

    it('profil classique : recherche anonyme sans compte de service', async () => {
      await configure({ ...LDAP_PROFILE_DEFAULTS.classic, profile: 'classic', bindDn: '' });
      directory.anonymousSearch = true;
            assert.equal((await signIn('lmartin', LUCIE.password)).response.status, 200);
    });

    it('refuse une entrée sans adresse e-mail quand l’identifiant n’en est pas une', async () => {
      await configure({ ...LDAP_PROFILE_DEFAULTS.classic, profile: 'classic', userFilter: '(uid={user})' });
      const { mail: _mail, ...attributes } = LUCIE.attributes;
      directory.entries = [{ ...LUCIE, attributes }];
      assert.equal((await signIn('lmartin', LUCIE.password)).response.status, 401);
    });

    it('rattache un compte local de même adresse, jamais un super administrateur', async () => {
      const created = await admin.post('/api/admin/users', { email: LUCIE.attributes.mail, name: 'Lucie locale', password: 'motdepasse-local', roleId: 3 });
      assert.equal(created.status, 201, JSON.stringify(created.body));

      await configure({ linkExisting: false });
      assert.equal((await signIn(LUCIE.attributes.mail, LUCIE.password)).response.status, 401, 'option désactivée');
      assert.equal((await signIn(LUCIE.attributes.mail, 'motdepasse-local')).response.status, 200, 'le mot de passe local reste valable');

      await configure();
      const linked = await signIn(LUCIE.attributes.mail, LUCIE.password);
      assert.equal(linked.response.status, 200);
      assert.equal(linked.response.body.user.id, created.body.user.id);
      assert.equal(linked.response.body.user.authSource, 'ldap');
      assert.equal(linked.response.body.user.name, 'Lucie locale', 'le nom du compte existant est gardé');
      assert.equal((await signIn(LUCIE.attributes.mail, 'motdepasse-local')).response.status, 401, 'le mot de passe local ne vaut plus');

      assert.equal((await signIn('admin@admin.com', ROOT.password)).response.status, 401, 'super administrateur');
      assert.equal((await signIn('admin@admin.com', 'admin1234')).response.status, 200);
    });

    it('un compte désactivé reste bloqué', async () => {
      const { user } = (await signIn(JEAN.attributes.mail, JEAN.password)).response.body;
      assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { isActive: false })).status, 200);
      const refused = await signIn(JEAN.attributes.mail, JEAN.password);
      assert.equal(refused.response.status, 403);
      assert.equal(refused.response.body.error.code, 'account_disabled');
    });

    it('le mot de passe d’un compte de l’annuaire se gère dans l’annuaire', async () => {
      const { client, response } = await signIn(JEAN.attributes.mail, JEAN.password);
      assert.equal((await client.post('/api/me/password', { currentPassword: JEAN.password, newPassword: 'nouveau-mot-de-passe' })).status, 400);

      const token = await client.post('/api/me/tokens', { name: 'Script' });
      assert.equal(token.status, 201, JSON.stringify(token.body));
      assert.equal((await client.post(`/api/me/tokens/${token.body.token.id}/reveal`, { password: 'mauvais' })).status, 400);
      assert.equal((await client.post(`/api/me/tokens/${token.body.token.id}/reveal`, { password: JEAN.password })).body.secret, token.body.secret, 'mot de passe vérifié par l’annuaire');

      // Un mot de passe défini par un administrateur repasse le compte en local.
      assert.equal((await admin.patch(`/api/admin/users/${response.body.user.id}`, { password: 'mot-de-passe-local' })).body.user.authSource, 'local');
      assert.equal((await signIn(JEAN.attributes.mail, 'mot-de-passe-local')).response.status, 200);
    });

    it('annuaire injoignable : message dédié, les comptes locaux continuent', async () => {
      await configure({ port: 1, timeoutSeconds: 2 });
      const down = await signIn(JEAN.attributes.mail, JEAN.password);
      assert.equal(down.response.status, 503);
      assert.equal(down.response.body.error.code, 'ldap_unavailable');
      assert.equal((await signIn('admin@admin.com', 'admin1234')).response.status, 200);
    });

    it('teste les réglages étape par étape sans rien enregistrer', async () => {
      assert.deepEqual(await test({ login: '', password: '' }), { ok: true, step: 'done', message: 'Connexion à l’annuaire réussie.', detail: null, entry: null });

      const unreachable = await test({ port: 1, timeoutSeconds: 2, login: '', password: '' });
      assert.equal(unreachable.ok, false);
      assert.equal(unreachable.step, 'connection');
      assert.ok(unreachable.detail);

      const service = await test({ bindPassword: 'mauvais', login: '', password: '' });
      assert.equal(service.step, 'bind');
      assert.equal(service.ok, false);

      const missing = await test({ login: 'personne@exemple.fr', password: '' });
      assert.equal(missing.step, 'search');
      assert.equal(missing.ok, false);

      const found = await test({ login: JEAN.attributes.mail, password: '' });
      assert.equal(found.ok, true);
      assert.equal(found.entry?.dn, JEAN.dn);
      assert.equal(found.entry?.name, 'Jean DUPONT');
      assert.equal(found.entry?.attributes.uid, 'jdupont');
      assert.equal(found.entry?.attributes.userPassword, undefined, 'les mots de passe ne sont jamais montrés');

      assert.equal((await test({ login: JEAN.attributes.mail, password: 'mauvais' })).step, 'account');
      const signedIn = await test({ login: JEAN.attributes.mail, password: JEAN.password });
      assert.equal(signedIn.ok, true);
      assert.equal(signedIn.step, 'done');
      assert.equal(app.running.ctx.db.get('SELECT id FROM users WHERE email = ?', JEAN.attributes.mail), undefined, 'aucun compte créé par un test');
    });

    for (const mode of ['ldaps', 'starttls'] as const) {
      it(`se connecte en ${mode} et vérifie le certificat`, async () => {
        const { cert, key } = createSelfSignedCertificate(['localhost']);
        const secure = await startDirectory([JEAN], { cert, key, mode });
        try {
          const tlsSettings = { port: secure.port, host: 'localhost', security: mode, login: JEAN.attributes.mail, password: JEAN.password };
          const refused = await test({ ...tlsSettings, verifyCertificate: true });
          assert.equal(refused.ok, false, 'certificat auto-signé refusé par défaut');
          assert.equal(refused.step, 'connection');
          assert.ok(refused.detail);

          const accepted = await test({ ...tlsSettings, verifyCertificate: false });
          assert.equal(accepted.ok, true, JSON.stringify(accepted));
          assert.equal(accepted.step, 'done');

          // Autorité interne : le certificat est vérifié et reconnu.
          const caPath = path.join(os.tmpdir(), `fastboard-ldap-ca-${process.pid}-${mode}.pem`);
          fs.writeFileSync(caPath, cert);
          try {
            const trusted = await test({ ...tlsSettings, verifyCertificate: true, caPath });
            assert.equal(trusted.ok, true, JSON.stringify(trusted));
          } finally {
            fs.rmSync(caPath, { force: true });
          }
        } finally {
          await secure.close();
        }
      });
    }

    it('valide les réglages et protège la configuration', async () => {
      assert.equal((await admin.request('PUT', '/api/admin/auth', settings({ host: '' }))).status, 400);
      assert.equal((await admin.request('PUT', '/api/admin/auth', settings({ host: 'ldap://x/y' }))).status, 400);
      assert.equal((await admin.request('PUT', '/api/admin/auth', settings({ searchBase: '' }))).status, 400);
      assert.equal((await admin.request('PUT', '/api/admin/auth', settings({ bindDn: '' }))).status, 400, 'le profil spécifique demande un compte de service');
      assert.equal((await admin.request('PUT', '/api/admin/auth', settings({ userFilter: '(mail=x)' }))).status, 400, '{user} obligatoire');
      assert.equal((await admin.request('PUT', '/api/admin/auth', settings({ userFilter: '(mail={user}' }))).status, 400, 'filtre mal formé');
      assert.equal((await admin.request('PUT', '/api/admin/auth', settings({ defaultRoleId: 999_999 }))).status, 400);

      const { user } = (await signIn(JEAN.attributes.mail, JEAN.password)).response.body;
      const member = app.client();
      await member.login(JEAN.attributes.mail, JEAN.password);
      assert.equal(user.permissions.includes('auth.manage'), false);
      assert.equal((await member.get('/api/admin/auth')).status, 403);
      assert.equal((await member.request('PUT', '/api/admin/auth', settings())).status, 403);
      assert.equal((await member.post('/api/admin/auth/ldap/test', { ...settings(), login: '', password: '' })).status, 403);
    });
  });
});
