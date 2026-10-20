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
  `PRAGMA user_version`).
- **PrimeVue reste en 4.x** (la 5 exige une licence).
- **Temps réel** : toute modification passe par l'API REST puis est diffusée par WebSocket (`shared/realtime.ts`) ;
  le client applique les évènements de façon idempotente.
- **Permissions** : une action protégée vérifie sa permission côté serveur (`requireProject` / `requireGlobal`) ;
  l'interface ne fait que masquer.
- **Vérifications avant de rendre la main** : `npm run typecheck` et `npm test` doivent passer.

## Données de développement

Le serveur de développement utilise `data/fastboard.sqlite`. Ne supprimez jamais `data/` et n'y écrivez pas de
données de test : travaillez sur une copie (`FASTBOARD_DB=<copie> PORT=3300 npm run dev:server`).
