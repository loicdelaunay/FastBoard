# Consignes pour les agents (IA) qui modifient FastBoard

Ce fichier s'adresse aux assistants de code (Claude, Codex…) qui travaillent sur ce dépôt. Lisez aussi le
[README](README.md) (architecture, commandes) et [docs/API.md](docs/API.md) (API pour les agents qui *utilisent* FastBoard).

## Version et journal des modifications (obligatoire)

L'application affiche sa version dans une pastille sous son nom ; un clic ouvre le journal des modifications.

**À chaque modification importante** (nouvelle fonctionnalité, changement visible, correction notable, changement
de schéma de base ou d'API) :

1. Incrémentez la version dans [`shared/changelog.ts`](shared/changelog.ts) (`APP_VERSION`) **et** dans
   `package.json` (`version`) — un test vérifie qu'elles sont identiques. Semver : `x.y.Z` correction, `x.Y.0`
   fonctionnalité, `X.0.0` rupture (API ou données).
2. Ajoutez une entrée **en tête** de `CHANGELOG` dans le même fichier : `version`, `date` (`AAAA-MM-JJ`) et une
   liste de `{ category, text }` où `category` vaut `Nouveauté`, `Amélioration`, `Correction` ou `Sécurité` et
   `text` est une phrase courte en français, du point de vue de l'utilisateur.
3. Ajoutez la traduction anglaise de chaque `text` dans le catalogue `src/i18n/en.*.ts` (le test des traductions
   échoue sinon).

Une modification sans effet visible (refactorisation, tests, documentation interne) ne change pas la version.

## Règles du projet

- **Langue** : l'interface, les messages et la documentation sont en français ; le texte français sert de clé de
  traduction (`$t('…')` dans les gabarits, `t('…')` dans les scripts). Toute nouvelle chaîne doit avoir sa
  traduction anglaise (`npm test` le vérifie). Les messages d'erreur du serveur se traduisent dans
  `src/i18n/server.ts`.
- **API** : chaque route doit être décrite dans `server/openapi/spec.ts` (le test `openapi.test.ts` compare le code
  et la documentation). Mettez à jour `docs/API.md` pour les usages intéressant un agent.
- **Base de données** : on ne modifie jamais une migration publiée ; on en ajoute une (`server/db/migrations.ts`,
  `PRAGMA user_version`). Voir [Migrations de la base](#migrations-de-la-base-obligatoire) : à tenir à jour et testées.
- **Partir de la dernière `main`** : avant de commencer (et avant de fusionner), récupérez `origin/main`
  (`git fetch origin main`) et travaillez par-dessus. D'autres sessions avancent en parallèle : version, journal,
  catalogues `src/i18n/en.vNN.ts` et surtout numéros de migration se percutent sinon.
- **PrimeVue reste en 4.x** (la 5 exige une licence).
- **Temps réel** : toute modification passe par l'API REST puis est diffusée par WebSocket (`shared/realtime.ts`) ;
  le client applique les évènements de façon idempotente. Seule exception : la frappe dans la documentation, qui passe
  directement par WebSocket (Yjs, `server/docs/collab.ts`). L'API REST y reste possible et rejoint les salles ouvertes.
- **Permissions** : une action protégée vérifie sa permission côté serveur (`requireProject` / `requireGlobal`) ;
  l'interface ne fait que masquer.
- **Lecture seule hors ligne** : toute nouvelle lecture, écriture ou zone d'édition doit garder le mode hors ligne
  cohérent. Voir [Lecture seule hors ligne](#lecture-seule-hors-ligne-à-maintenir).
- **Vérifications avant de rendre la main** : `npm run typecheck` et `npm test` doivent passer.
- **Pas de délégation** : faites le travail vous-même, dans la session en cours. Ne le confiez pas à des sous-agents
  (ni à d'autres sessions), sauf si l'utilisateur le demande explicitement.

## Migrations de la base (obligatoire)

Les migrations sont la liste `MIGRATIONS` de [`server/db/migrations.ts`](server/db/migrations.ts) : la migration
d'indice `i` porte le numéro `i + 1`, et `PRAGMA user_version` retient le numéro de la dernière appliquée. Une base
déjà en version N ne rejoue jamais les N premières : **deux migrations différentes sous le même numéro cassent les
bases** (la 2.27.0 a ainsi sauté la création des groupes sur une base passée par une branche qui avait pris le même
numéro : « no such table: doc_access »).

1. **Numéro** : partez de la dernière `main` et ajoutez votre migration **à la fin**. Ne réutilisez jamais un numéro,
   n'insérez rien au milieu, ne modifiez, ne réordonnez ni ne supprimez une migration publiée (même pour une faute :
   corrigez par une nouvelle migration). Si `main` a reçu une migration pendant votre travail, renumérotez la vôtre
   après la sienne avant de fusionner.
2. **Branche déjà distribuée** : si une base a pu recevoir votre migration sous un autre numéro (build installé depuis
   une branche), rendez la migration idempotente (`CREATE TABLE IF NOT EXISTS`, test d'une colonne avant
   `ALTER TABLE`) et ajoutez une réparation au démarrage dans `migrate()` (exemple : `repairSkippedGroups`, qui
   applique la migration sautée quand ses tables manquent).
3. **Bases réelles** : une migration tourne dans une transaction sur des bases qui ont des données. Prévoyez des
   valeurs par défaut, remplissez les nouvelles colonnes à partir de l'existant, et gardez les fichiers hors base sous
   `uploads/` ou `docs/` (inclus dans les sauvegardes).
4. **Tests** :
   - mettez à jour les assertions `PRAGMA user_version` (`server/tests/parts.test.ts`, `server/tests/activity.test.ts`) ;
   - ajoutez un test de la migration : `new Db(':memory:')`, `migrate(db, N - 1)`, données à l'ancienne, `migrate(db)`,
     vérification du résultat ; puis un second `migrate(db)` qui ne fait rien ;
   - pour une réparation, reproduisez l'état fautif (exemple : `server/tests/frozenFiles.test.ts`).
5. **Essai sur une copie** : lancez le serveur sur une copie d'une vraie base
   (`FASTBOARD_DB=<copie> PORT=3300 npm run dev:server`), puis vérifiez `PRAGMA user_version`, les tables, et que les
   pages s'ouvrent sans erreur dans le journal.
6. Un changement de schéma est une modification importante : version et journal (voir plus haut).

## Lecture seule hors ligne (à maintenir)

Quand le serveur ne répond plus, l'interface continue **en lecture seule** avec ce qu'elle a gardé sur l'appareil, et
reprend seule à son retour (voir le README). Les pièces :

| Fichier | Rôle |
| --- | --- |
| [`shared/offline.ts`](shared/offline.ts) | Ce qui se garde (`offlineCacheable`), ce qui est une panne (`serverUnreachable`), limites |
| [`src/offline/cache.ts`](src/offline/cache.ts) | IndexedDB par compte (`offlineKey`, `readOffline`, `writeOffline`, `clearOffline`) |
| [`src/offline/connection.ts`](src/offline/connection.ts) | État `connection.offline`, sonde `/api/health`, reprise (`realtime.resync()`) |
| [`src/api/http.ts`](src/api/http.ts) | Lectures gardées et servies hors ligne, écritures refusées |
| [`src/components/layout/OfflineBanner.vue`](src/components/layout/OfflineBanner.vue) | Bandeau |
| [`src/pwa/sw.template.js`](src/pwa/sw.template.js) | Interface et images de l'API (HTTPS ou `localhost` seulement) |

À respecter :

- **Lectures** : passez par `http()` (`src/api`). Elles sont alors gardées et servies hors ligne d'elles-mêmes ; un
  `fetch` direct n'en profite pas.
- **Ce qui ne doit pas se garder** : une nouvelle route `GET` qui rend des secrets ou des données d'administration, ou
  dont les réponses varient sans fin (recherche, export), s'exclut dans `offlineCacheable`, avec un cas dans
  [`server/tests/offline.test.ts`](server/tests/offline.test.ts). Un appel indispensable au démarrage, lu avant de
  savoir qui est connecté (comme `/me` et `/app`), se garde hors compte dans `offlineCacheKey` (`src/api/http.ts`).
- **Écritures** : passez par `http()` (hors ligne, elle refuse avec un message clair). Toute nouvelle zone d'édition se
  désactive quand `connection.offline` est vrai, comme `canWrite` (`DocSpaceView.vue`) ou `can-edit` des tableaux.
- **Contenu reçu par WebSocket (Yjs)** : il ne passe pas par l'API. Gardez-le une fois synchronisé
  (`writeOffline(offlineKey(compte, 'genre:id'), …)`). Hors ligne, ouvrez-le dans une session **détachée**
  (`new DocSession(id, user, texte)`, `new BoardSession(id, user, null, éléments)`), jamais en le réinjectant dans une
  session reliée au serveur : il serait renvoyé au retour et dupliqué si le serveur a redémarré.
- **Erreurs du serveur** : FastBoard ne répond jamais 502, 503 ni 504 sans son message d'erreur JSON (`HttpError`) ;
  sans lui, l'interface croit à une panne et passe hors ligne.
- **Confidentialité** : tout ce qui est gardé sur l'appareil appartient au compte et s'efface à la déconnexion
  (`clearOffline`, appelée par `auth.expire` et `auth.login`). Une nouvelle donnée locale suit la même règle.
- **Vérification** quand vous touchez à ces parties :
  1. `npm run build`, puis servez `dist` : `FASTBOARD_DB=<copie> PORT=3300 node server/index.ts`, et ouvrez
     `http://localhost:3300`.
  2. Ouvrez quelques pages, puis arrêtez le serveur. Vérifiez le bandeau, la lecture des pages déjà ouvertes, le refus
     d'une modification, et le message pour une page jamais ouverte.
  3. Rechargez la page (le service worker rouvre l'application), relancez le serveur, et vérifiez la reprise.
  4. Faites-le aussi avec le service worker bloqué (cas d'un serveur en HTTP sur le réseau local) : un onglet déjà
     ouvert continue en lecture seule.

## Données de développement

Le serveur de développement utilise `data/fastboard.sqlite`. Ne supprimez jamais `data/` et n'y écrivez pas de
données de test : travaillez sur une copie (`FASTBOARD_DB=<copie> PORT=3300 npm run dev:server`).
