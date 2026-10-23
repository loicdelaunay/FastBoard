# FastBoard

Outil de suivi de projet collaboratif en **temps réel**, entre Trello et Jira : tableau Kanban, liste, diagramme de Gantt et analyseur, avec comptes, rôles et permissions.

**Stack** : Vue 3 + TypeScript + [PrimeVue 4](https://primevue.dev) · Node 24 (Express 5, WebSocket `ws`) · SQLite (`node:sqlite`, aucune dépendance native).

## Démarrage rapide

Prérequis : **Node ≥ 24** (SQLite intégré et exécution native de TypeScript).

```bash
npm install
npm run dev          # API sur :3000 + interface Vite sur http://localhost:5173
```

Production (un seul processus, interface servie par le serveur) :

```bash
npm run build
npm run start:prod   # http://localhost:3000
```

### Exécutable autonome (Windows)

Un seul fichier `FastBoard.exe` embarque Node, le serveur et l'interface : aucune installation requise.

```bash
npm run build:exe        # construit release/FastBoard.exe (≈ 90 Mo)
```

Pour qu'il démarre tout seul avec la machine et se relance en cas d'arrêt : *Administration → Installation* (tâche planifiée Windows, unité systemd sous Linux, agent launchd sous macOS ; commandes manuelles affichées si les droits manquent). Double-cliquez sur l'exécutable (ou lancez-le dans un terminal) : le serveur démarre sur http://localhost:3000 et ouvre le navigateur. La base `data/fastboard.sqlite` et les pièces jointes `data/uploads/` sont créées **à côté de l'exécutable** ; les variables d'environnement ci-dessous (`PORT`, `FASTBOARD_DB`…) fonctionnent aussi, et `FASTBOARD_NO_OPEN=1` empêche l'ouverture du navigateur. L'exécutable se construit avec la version de Node qui exécute `npm run build:exe` (≥ 24) ; il n'est pas signé, Windows SmartScreen peut donc demander une confirmation au premier lancement.

Au premier lancement, le serveur crée la base `data/fastboard.sqlite` et le compte **super administrateur** :

| E-mail | Mot de passe |
| --- | --- |
| `admin@admin.com` | `admin1234` |

> Changez ce mot de passe dès la première connexion (menu du compte → Sécurité).

Jeu de données de démonstration (facultatif) : `npm run seed:demo` crée 4 utilisateurs (`camille@demo.fr`, `hugo@demo.fr`, `ines@demo.fr`, `theo@demo.fr`, mot de passe `demo1234`) et un projet avec livraisons, tickets et discussions.

## Fonctionnalités

**Collaboration temps réel (WebSocket)** — chaque modification (ticket, commentaire, déplacement, catégorie, livraison, membre…) est diffusée instantanément à tous les membres du projet ouvert. Indicateur de connexion, reconnexion automatique avec resynchronisation, présence des collègues (et de ceux qui consultent un ticket), mise en évidence des tickets modifiés par un autre.

**Cinq onglets** par projet ; les quatre premiers partagent leurs filtres (recherche, catégories, livraisons, personnes, statuts, « mes tickets », « en retard ») :
- **Analyseur** — indicateurs clés, réel vs théorique, burn-down, charge par personne, répartition par statut et catégorie, points de vigilance, priorités de suivi ; par livraison ou global (liste déroulante des versions).
- **Liste** — tableau triable avec regroupement (livraison, catégorie, statut, priorité), **filtres par valeur dans les en-têtes** (catégorie, priorité, composants, statut, assignés, livraison), changement de statut rapide, export CSV.
- **Kanban** — glisser-déposer entre colonnes et réordonnancement, ajout rapide dans une colonne, menu « Déplacer vers » pour le tactile et le clavier.
- **Gantt** — frise avec **numéros de semaine ISO**, zoom jour / semaine / mois, regroupement par livraison ou par personne (avec détection de surcharge), barres déplaçables et redimensionnables à la souris ou au clavier, livraisons en barres récapitulatives, ligne « aujourd'hui ».
- **Activités** — le fil de tout ce qui se passe sur le tableau, en direct : tickets créés, déplacés, modifiés, assignés, parts terminées, commentaires, catégories, livraisons, membres, réglages du projet. Regroupé par jour, avec filtres (type, personne, recherche, origine : interface ou API / agents), pagination, pastille de nouveautés sur l'onglet et mention « via <jeton> » pour les actions faites par une IA.

**Tickets** — titre, description, statut, **catégorie** (réglable par projet), **livraison ciblée** (avec mémorisation de la livraison initiale pour repérer les reports), dates, **plusieurs assignés** : chacun déclare **sa part terminée** (et peut régler son avancement) et peut avoir une **mission** facultative qui décrit ce qu'il doit faire sur le ticket (visible de tous, modifiable par la personne ou par un éditeur, historisée), l'**avancement global** est calculé (moyenne des parts) et affiché partout. Quand toutes les parts sont terminées, le ticket passe automatiquement à « Terminé » ; une part rouverte le relance. **Priorité** et **composants** (listes réglables par projet : nom, icône, couleur), **sous-tâches** (responsable, case à cocher, réordonnables), **dépendances** vers d'autres tickets avec une raison (liste ou texte libre ; un ticket bloqué affiche un cadenas). **Mentions `@`** de personnes et de tickets dans la description et les commentaires. **Historique** complet des modifications (avec « via <jeton> » pour les actions d'une IA) et **commentaires** avec réponses imbriquées (modifier / supprimer).

**Export PDF de l'analyseur** — bouton « Exporter en PDF » sur chaque périmètre (ensemble du projet ou une livraison, aussi depuis le tableau des livraisons) : indicateurs, réel vs théorique, graphiques (statuts, burn-down, charge, catégories), points de vigilance, priorités, livraisons et liste des tickets. Généré dans le navigateur (jsPDF, chargé à la demande), dans la langue de l'interface.

**Langues (français / anglais)** — le choix se fait sur la page de connexion ou dans *Mon compte → Apparence*, il est enregistré sur le compte et la page se recharge. Le français est la langue source : ses textes servent de clés (`src/i18n/index.ts`), l'anglais est dans `src/i18n/en.*.ts` et un test vérifie que chaque texte de l'interface est traduit. Dates, noms de mois, unités, messages d'erreur du serveur et libellés PrimeVue suivent la langue ; les journaux serveur et la documentation de l'API restent en français. Pour ajouter une langue : ajouter son code dans `shared/locales.ts` et un catalogue `en.*.ts` équivalent.

**Réglages du projet** — onglet *Colonnes* : renommer, recolorer, réordonner et masquer (si vide) les colonnes du Kanban ; les noms et couleurs suivent partout (liste, Gantt, filtres, analyseur, historique). Les statuts restent fixes car ils portent les règles d'avancement ; « Terminé » ne se masque pas. Onglet *Automatisation* : passage automatique dans « Terminé » quand toutes les parts sont finies (désactivable), réouverture automatique, **confettis** quand un ticket arrive dans Terminé (désactivés si le système réduit les animations) et **indicateur d'inactivité** façon Jira (barre sur les cartes : depuis combien de jours le ticket n'a pas changé de colonne). Colonnes dans lesquelles un ticket compte pour 100 % (par exemple « À tester »), tri automatique des cartes par colonne (priorité, échéance, titre…), pastille colorée sur les tickets dont la livraison approche (seuils réglables). Onglets *Priorités* et *Composants*. Réglages modifiables via l'API (`PATCH /projects/{id}` → `settings`).

**Pièces jointes** — dans un ticket, glissez-déposez des fichiers n'importe où (ou collez une capture d'écran, ou utilisez « Ajouter ») : envoi en parallèle avec barre de progression, vignettes et aperçu plein écran des images, téléchargement, suppression (par l'auteur ou un modérateur). Elles sont historisées, visibles dans les Activités, comptées sur les cartes, synchronisées en temps réel et disponibles par l'API. 25 Mo par fichier et 30 par ticket ; stockées sur disque à côté de la base (`data/uploads/`), servies en téléchargement isolé (jamais de HTML ni de SVG en ligne).

**Livraisons** — nom, date de début, date de fin, couleur, description.

**Menu contextuel des tickets** — clic droit sur un ticket (Kanban, liste, Gantt) ou bouton « ⋯ » d'une carte : ouvrir, copier le lien ou la clé, déplacer vers un statut, s'assigner / se retirer, terminer ou rouvrir sa part, dupliquer, **supprimer** (avec confirmation). Les entrées dépendent des permissions ; la suppression est aussi dans l'en-tête et le détail du ticket.

**Supervision (administration)** — deux pages réservées aux permissions `monitoring.view` et `logs.view` :
- **Performances** — santé globale, trafic, erreurs, latences (médiane, p95, p99, répartition), routes de l'API les plus lentes, processeur, mémoire, retard de la boucle d'évènements, connexions WebSocket, requêtes SQLite, taille de la base et des pièces jointes. Fenêtres de 15 min à 3 jours, rafraîchissement automatique ; les indicateurs sont agrégés par minute et survivent aux redémarrages (3 jours conservés).
- **Journaux** — erreurs serveur (avec pile d'appels), accès refusés, requêtes lentes, connexions et échecs de connexion, actions d'administration, jetons d'API, pièces jointes. Filtres (niveau, source, texte, période, requête), suivi en direct, export NDJSON. Chaque réponse porte un `X-Request-Id` pour retrouver l'erreur vue par un utilisateur. Conservation 14 jours.

**Description en Markdown** — barre d'outils (gras, titres, listes, tâches, liens, tableaux, code), formules mathématiques (KaTeX), diagrammes Mermaid, mentions `@`, et mode plein écran (éditeur et aperçu côte à côte). Le rendu est assaini (DOMPurify) ; Mermaid est chargé à la demande.

**Assistant IA** — bouton « cerveau » à droite de la recherche : un panneau latéral (façon Gemini dans Workspace) qui connaît le projet et le ticket ouverts, cherche sur tous les champs dans un projet ou partout, lit avec les droits de la personne et, si elle coche « Autoriser les modifications » et en a le droit, crée, modifie, déplace et commente des tickets (« via Assistant IA » dans l'historique). Fournisseur compatible OpenAI v1 (OpenAI, Mistral, Ollama, LM Studio…) configuré dans *Administration → IA* ; permissions globales (`ai.use`, `ai.manage`) et par projet (`ai.read`, `ai.write`).

**Notifications** — cloche dans l'en-tête : changements des tickets suivis (bouton « Suivre » ; créateur, assignés et commentateurs suivent automatiquement), assignations et mentions `@`, en direct.

**Clic droit sur un ticket** — renommer, assignés, dates, priorité, livraison, colonne, ou déplacement vers un autre projet (nouvelle clé, listes reprises par leur nom). **Clic droit sur un projet** (page d'accueil) — export CSV ou JSON complet.

**Recherche globale** — en haut à droite (`Ctrl+K`) : projets, tickets et utilisateurs, aperçu instantané et page « tous les résultats ». **Page utilisateur** : projets communs, tickets en cours, actions des 30 derniers jours.

**Personnalisation et maintenance (administration)** — nom et logo de l'application (en-tête, page de connexion, onglet du navigateur) ; bandeau de maintenance à trois niveaux (information, perturbations, interruption), programmable, diffusé en direct à tous.

**Sauvegardes (administration)** — activables, vers un ou plusieurs dossiers : archive ZIP de la base, des pièces jointes et de la clé de chiffrement, **incrémentale** (seules les nouvelles pièces jointes, chaîne de N archives), planification quotidienne ou toutes les N heures, conservation façon Duplicati (tout garder, N dernières, durée, *intelligente* 1W:1D,4W:1W,12M:1M ou règles personnalisées), historique et sauvegarde immédiate. Chaque archive contient un `README.txt` de restauration.

**Version et nouveautés** — la version s'affiche sous le nom de l'application ; un clic ouvre le journal des modifications ([`shared/changelog.ts`](shared/changelog.ts), voir [AGENTS.md](AGENTS.md)).

**Annuler / rétablir** (`Ctrl+Z`, `Ctrl+Maj+Z` / `Ctrl+Y`) pour les déplacements, changements de dates, statuts, etc. Raccourci `N` : nouveau ticket.

**Comptes et permissions**
- Seul un administrateur crée les comptes. Chaque utilisateur modifie son **nom**, son **image de profil** (recadrée automatiquement), son mot de passe et son **thème**.
- **14 thèmes** répartis en *clairs* et *sombres* (presets Aura, Lara, Nora, Material), enregistrés sur le compte et appliqués instantanément.
- **Rôles globaux** (super admin, administrateur, membre, invité…) et **rôles de projet** (propriétaire, gestionnaire, éditeur, contributeur, lecteur…), tous personnalisables dans *Administration → Rôles et permissions* (matrice de permissions). On ne peut jamais accorder plus de droits que les siens, ni modifier un compte plus privilégié que le sien, ni retirer le dernier super administrateur / propriétaire.
- Partage de projet : le propriétaire invite des utilisateurs existants avec le rôle de son choix.

**API pour les IA et les scripts** — tout ce que fait l'interface est disponible en REST. Un utilisateur crée des **jetons d'API** (menu du compte → *Jetons d'API*) : portée lecture seule ou lecture/écriture, projets accessibles, expiration (prolongeable), **nom d'affichage** (« via … » dans l'activité et l'historique), révocation immédiate ; le secret `fb_…` est stocké chiffré (clé `data/secret.key`) et peut être **réaffiché** par son propriétaire après saisie de son mot de passe. Un jeton agit avec les droits de son propriétaire, jamais davantage, avec une limite de débit, et ne peut ni administrer ni gérer d'autres jetons. Documentation :
- **Swagger UI** : `/api/docs` · **OpenAPI 3.1** : `/api/openapi.json` (générée depuis les schémas de validation réels, un test garantit qu'elle décrit chaque route) ;
- **Guide pour les IA** (concepts, recettes `curl`, bonnes pratiques, exemple de consigne) : [`docs/API.md`](docs/API.md), aussi servi sur `/api/docs/guide.md`.

```bash
curl -s http://localhost:3000/api/projects/1/tickets?status=in_progress -H "Authorization: Bearer fb_…"
```

## Architecture

```
shared/     Types, permissions, thèmes, dates, calcul d'avancement — partagés serveur ↔ interface
server/
  app.ts, index.ts          Démarrage Express + WebSocket, fichiers statiques
  db/                       Connexion SQLite, migrations (PRAGMA user_version), seed
  auth/                     Mots de passe (scrypt), sessions (cookie HttpOnly), jetons d'API (Bearer)
  http/                     Erreurs, validation (zod : schemas.ts), middlewares, protection CSRF
  routes/                   auth, admin (utilisateurs, rôles, jetons), projets, tickets, docs (Swagger)
  openapi/                  Description OpenAPI 3.1 (générée depuis les schémas de validation)
  services/                 Logique métier (tickets, sous-tâches, dépendances, commentaires, pièces jointes, historique, recherche…)
  backup/                   Sauvegardes : écriture ZIP, planificateur, conservation
  system/                   Installation en service et superviseur (--supervise)
  monitoring/               Journal applicatif (logger), indicateurs de performance (metrics), instantané admin
  realtime/hub.ts           Salles WebSocket par projet, présence
  tests/                    Tests d'intégration (API, permissions, temps réel)
src/
  api/                      Client HTTP · realtime/ : client WebSocket (reconnexion)
  stores/                   Pinia : auth, projets, projet courant (évènements, annuler/rétablir)
  views/ components/        Vues, Kanban, Gantt maison, analyseur, tickets, réglages, administration
  theme/                    Application des thèmes PrimeVue à chaud
docs/API.md                 Guide de l'API pour les IA et les scripts
```

### Temps réel

Les modifications passent par l'API REST (validation et permissions côté serveur) ; le serveur diffuse ensuite un évènement à tous les clients abonnés au projet via `/ws` (`ticket.updated`, `comment.created`, `members.changed`…). Le client applique chaque évènement de façon idempotente (comparaison de `updatedAt`) et met à jour son interface instantanément (mise à jour optimiste pour les déplacements et les dates). Après une coupure, le projet est rechargé à la reconnexion. Le protocole est décrit dans [`shared/realtime.ts`](shared/realtime.ts).

### Modèle de permissions

Une permission est une chaîne (`ticket.edit`, `project.members`, `tokens.create`…) ; le catalogue est dans [`shared/permissions.ts`](shared/permissions.ts). Les droits d'un utilisateur dans un projet = ceux de son rôle de projet (`projects.manage_all` donne tous les droits partout, `projects.view_all` donne la lecture seule). Les rôles sont des lignes en base : créez les vôtres sans toucher au code.

## Configuration

Variables d'environnement (toutes facultatives) :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Adresse d'écoute |
| `FASTBOARD_DB` | `data/fastboard.sqlite` | Fichier de base de données |
| `NODE_ENV` | — | `production` active l'en-tête CSP |
| `FASTBOARD_UPLOADS` | `<dossier de la base>/uploads` | Dossier des pièces jointes |
| `FASTBOARD_MAX_UPLOAD_MB` | `25` | Taille maximale d'une pièce jointe |
| `FASTBOARD_LOG_LEVEL` | `info` | Niveau minimal des journaux conservés (`debug` journalise chaque requête) |
| `FASTBOARD_LOG_CONSOLE` | `1` | `0` : ne pas recopier les journaux sur la console |
| `ALLOWED_ORIGINS` | — | Origines supplémentaires acceptées derrière un proxy (séparées par des virgules) |
| `FASTBOARD_HTTPS` | — | `0` : ignorer les réglages HTTPS au démarrage (secours si un certificat bloque l'accès) |

**HTTPS** : *Administration → HTTP / HTTPS* sert le site en HTTPS sur un second port avec vos certificats (PEM ou PFX, ou un certificat auto-signé pour essayer), avec redirection HTTP → HTTPS et HSTS en option ; c'est appliqué sans redémarrer et les certificats renouvelés sont relus automatiquement. Depuis la machine elle-même, HTTP n'est jamais redirigé (accès de secours).

Derrière un reverse proxy HTTPS, transmettez les en-têtes `Upgrade`/`Connection` pour `/ws` et `X-Forwarded-Proto` ; le cookie de session devient alors `Secure`. Cochez « Derrière un proxy inverse » dans *HTTP / HTTPS* pour que FastBoard fasse confiance aux en-têtes `X-Forwarded-*`.

## Qualité

```bash
npm test            # tests d'intégration et unitaires (node:test)
npm run typecheck   # vue-tsc + tsc
npm run build       # contrôle des types puis build de production
```

## Choix notables

- **PrimeVue 4.5** (licence MIT) : la version 5 exige une clé de licence (offre Community gratuite sous conditions). Le passage à la v5 se fait sans changement d'API publique si vous le souhaitez.
- Le **Gantt est développé sur mesure** (Vue, sans bibliothèque) : il s'intègre au temps réel, aux thèmes et aux permissions, affiche les semaines ISO et se pilote au clavier.
- Les images de profil sont stockées dans SQLite (réduites à 256 px côté navigateur, PNG/JPEG/WebP uniquement).
- L'annuaire des utilisateurs (pour inviter) est visible de tout compte connecté : adaptez `GET /api/users` si ce n'est pas souhaité.
