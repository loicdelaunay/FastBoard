import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('version 1.5', () => {
  let app: Booted;
  let owner: TestClient;
  const ids: Record<string, number> = {};

  before(async () => {
    app = await bootServer();
    owner = app.client();
    await owner.login('admin@admin.com', 'admin1234');
    ids.me = (await owner.get('/api/me')).body.user.id;
    ids.project = (await owner.post('/api/projects', { name: 'Atelier', key: 'ATL' })).body.project.id;
    ids.other = (await owner.post('/api/projects', { name: 'Ailleurs', key: 'AIL' })).body.project.id;
    ids.ticket = (await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Refonte' })).body.ticket.id;
  });

  after(async () => {
    await app.running.close();
  });

  describe('champs des tickets', () => {
    const FIELDS = [
      { id: 'cf_budget', label: 'Budget', type: 'number', options: [], showOnCard: true },
      { id: 'cf_client', label: 'Client', type: 'select', options: ['Acme', 'Globex'], showOnCard: false },
      { id: 'cf_tags', label: 'Étiquettes', type: 'multiselect', options: ['web', 'mobile', 'api'], showOnCard: false },
      { id: 'cf_valide', label: 'Validé', type: 'checkbox', options: [], showOnCard: false },
      { id: 'cf_echeance', label: 'Recette', type: 'date', options: [], showOnCard: false },
      { id: 'cf_lien', label: 'Maquette', type: 'url', options: [], showOnCard: false },
      { id: 'cf_referent', label: 'Référent', type: 'user', options: [], showOnCard: false },
    ];

    it('masque des champs standard et définit des champs personnalisés', async () => {
      const initial = (await owner.get(`/api/projects/${ids.project}`)).body.project.settings;
      assert.equal(initial.ticketFields.priority, true);
      assert.deepEqual(initial.customFields, []);
      const updated = await owner.patch(`/api/projects/${ids.project}`, { settings: { ticketFields: { priority: false, comments: false }, customFields: FIELDS } });
      assert.equal(updated.status, 200);
      const settings = updated.body.project.settings;
      assert.equal(settings.ticketFields.priority, false);
      assert.equal(settings.ticketFields.comments, false);
      assert.equal(settings.ticketFields.description, true, 'les autres champs restent affichés');
      assert.equal(settings.customFields.length, FIELDS.length);
      assert.deepEqual(settings.customFields[1].options, ['Acme', 'Globex']);
      // Un patch partiel des champs garde les autres réglages.
      const again = await owner.patch(`/api/projects/${ids.project}`, { settings: { ticketFields: { comments: true } } });
      assert.equal(again.body.project.settings.ticketFields.priority, false);
      assert.equal(again.body.project.settings.ticketFields.comments, true);
      assert.equal((await owner.patch(`/api/projects/${ids.project}`, { settings: { customFields: [{ id: 'mauvais', label: 'X', type: 'text' }] } })).status, 400);
      assert.equal((await owner.patch(`/api/projects/${ids.project}`, { settings: { customFields: [{ id: 'cf_x', label: 'X', type: 'couleur' }] } })).status, 400);
    });

    it('enregistre et vérifie les valeurs selon le type, avec l’historique', async () => {
      const set = (customFields: Record<string, unknown>) => owner.patch(`/api/tickets/${ids.ticket}`, { customFields });
      const ok = await set({ cf_budget: 1200.5, cf_client: 'Acme', cf_tags: ['api', 'web'], cf_valide: true, cf_echeance: '2026-12-01', cf_lien: 'https://exemple.fr/maquette', cf_referent: ids.me });
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body.ticket.customFields, { cf_budget: 1200.5, cf_client: 'Acme', cf_tags: ['web', 'api'], cf_valide: true, cf_echeance: '2026-12-01', cf_lien: 'https://exemple.fr/maquette', cf_referent: ids.me });

      for (const [patch, message] of [
        [{ cf_budget: 'beaucoup' }, /nombre/],
        [{ cf_client: 'Initech' }, /Acme, Globex/],
        [{ cf_tags: ['desktop'] }, /choix/],
        [{ cf_echeance: '01/12/2026' }, /AAAA-MM-JJ/],
        [{ cf_lien: 'javascript:alert(1)' }, /http/],
        [{ cf_inconnu: 'x' }, /inconnu/],
      ] as const) {
        const refused = await set(patch);
        assert.equal(refused.status, 400, JSON.stringify(patch));
        assert.match(refused.body.error.message, message);
      }
      assert.equal((await set({ cf_referent: 999 })).status, 400, 'la personne doit être membre du projet');

      // Fusion : seule la valeur envoyée change ; null efface.
      const cleared = await set({ cf_budget: null, cf_valide: false });
      assert.equal(cleared.body.ticket.customFields.cf_budget, undefined);
      assert.equal(cleared.body.ticket.customFields.cf_valide, undefined);
      assert.equal(cleared.body.ticket.customFields.cf_client, 'Acme');

      const history = (await owner.get(`/api/tickets/${ids.ticket}/history`)).body.history as Array<{ data: { kind: string; changes?: Array<{ field: string; label?: string; from: unknown; to: unknown }> } }>;
      const changes = history.flatMap((entry) => entry.data.changes ?? []).filter((change) => change.field === 'custom');
      assert.ok(changes.some((change) => change.label === 'Budget' && change.from === null && change.to === 1200.5));
      assert.ok(changes.some((change) => change.label === 'Référent' && change.to === 'Super Admin'), 'la personne est nommée');
      assert.ok(changes.some((change) => change.label === 'Budget' && change.from === 1200.5 && change.to === null));

      const csv = String((await owner.get(`/api/projects/${ids.project}/export?format=csv`)).body);
      assert.ok(csv.split('\r\n')[0]!.endsWith(';Budget;Client;Étiquettes;Validé;Recette;Maquette;Référent'));
      assert.ok(csv.includes('Acme;web, api'));

      // Création avec des valeurs.
      const created = await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Avec champs', customFields: { cf_client: 'Globex' } });
      assert.equal(created.status, 201);
      assert.deepEqual(created.body.ticket.customFields, { cf_client: 'Globex' });
    });

    it('garde les valeurs d’un champ de même libellé en changeant de projet', async () => {
      await owner.patch(`/api/projects/${ids.other}`, { settings: { customFields: [{ id: 'cf_autreclient', label: 'client', type: 'select', options: ['Acme'] }] } });
      const moved = await owner.post(`/api/tickets/${ids.ticket}/transfer`, { projectId: ids.other, status: 'todo' });
      assert.equal(moved.status, 200);
      assert.deepEqual(moved.body.ticket.customFields, { cf_autreclient: 'Acme' });
    });
  });

  describe('apparence', () => {
    const theme = { id: 'custom-abc123', label: 'Bureau', mode: 'dark', preset: 'lara', primary: '#ff6600', surface: '#334155' };
    const fonts = { body: "Georgia, 'Times New Roman', serif", heading: "'Ma Police', system-ui, sans-serif", mono: '', size: 16 };

    it('enregistre des thèmes et des polices personnalisés sur le compte', async () => {
      const me = (await owner.get('/api/me')).body.user;
      assert.deepEqual(me.appearance, { customThemes: [], fonts: { body: '', heading: '', mono: '', size: 15 } });
      assert.equal((await owner.patch('/api/me', { theme: 'custom-abc123' })).status, 400, 'thème personnalisé inexistant');

      const saved = await owner.patch('/api/me', { appearance: { customThemes: [theme], fonts }, theme: theme.id });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.user.theme, theme.id);
      assert.deepEqual(saved.body.user.appearance.customThemes, [theme]);
      assert.deepEqual(saved.body.user.appearance.fonts, fonts);

      assert.equal((await owner.patch('/api/me', { appearance: { customThemes: [{ ...theme, primary: 'orange' }], fonts } })).status, 400, 'couleur #RRGGBB');
      assert.equal((await owner.patch('/api/me', { appearance: { customThemes: [], fonts: { ...fonts, body: 'x; } body { display:none' } } })).status, 400, 'police refusée');
      assert.equal((await owner.patch('/api/me', { appearance: { customThemes: [], fonts: { ...fonts, size: 40 } } })).status, 400);

      // Supprimer le thème utilisé ramène au thème par défaut.
      const removed = await owner.patch('/api/me', { appearance: { customThemes: [], fonts } });
      assert.equal(removed.body.user.theme, 'aura-indigo-light');
      assert.deepEqual(removed.body.user.appearance.fonts, fonts, 'les polices restent');
    });
  });
});
