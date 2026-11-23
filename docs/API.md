# FastBoard — guide de l'API pour les IA et les scripts

Tout ce que fait l'interface (Kanban, liste, Gantt, activité) passe par une API REST JSON. Un agent IA ou un script peut donc **lire le tableau, créer et déplacer des tickets, commenter et déclarer l'avancement**, exactement comme un utilisateur, avec les mêmes droits.

- **Swagger UI** (essai en direct) : `/api/docs`
- **Description OpenAPI 3.1** (à fournir à un agent ou à importer dans Postman) : `/api/openapi.json`
- **Ce guide**, servi par le serveur : `/api/docs/guide.md`

Dans les exemples : `FASTBOARD` est l'adresse du serveur (ex. `http://localhost:3000`) et `TOKEN` votre jeton d'API.

```bash
export FASTBOARD=http://localhost:3000
export TOKEN=fb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 1. Obtenir un jeton d'API

1. Connectez-vous à FastBoard, puis **menu du compte → Jetons d'API → Nouveau jeton**.
2. Choisissez :
   - un **nom** (ex. `agent-planning`) : il apparaît dans le journal d'activité à côté de chaque action de l'agent ;
   - la **portée** : `Lecture seule` (`read`, uniquement les routes `GET`) ou `Lecture et écriture` (`write`) ;
   - les **projets accessibles** : tous ceux auxquels vous avez accès, ou une sélection (recommandé pour un agent : un projet = un jeton) ;
   - l'**expiration** (90 jours par défaut, ou jamais).
3. Copiez le secret (`fb_…`) : **il n'est affiché qu'une seule fois**. Seul son empreinte est conservée côté serveur.

La permission « Créer des jetons d'API » (`tokens.create`) est requise ; les administrateurs voient et révoquent tous les jetons dans *Administration → Jetons d'API*. Un jeton révoqué, expiré, ou dont le propriétaire est désactivé est refusé immédiatement (`401 invalid_token`).

> **Conseil sécurité.** Créez un compte dédié à l'agent (ex. « Agent IA », rôle global *Invité*), invitez-le uniquement sur les projets utiles avec un rôle limité (*Contributeur* ou *Éditeur*), et créez le jeton depuis ce compte. Ses droits sont alors strictement ceux que vous avez décidés.

### Ce qu'un jeton peut et ne peut pas faire

- Il agit **avec les droits de son propriétaire** (rôle global + rôle dans chaque projet), jamais davantage.
- Un jeton `read` reçoit `403 token_read_only` sur toute route autre que `GET`.
- Un jeton limité à certains projets voit les autres comme inexistants (`404`) et ne peut pas créer de projet.
- **Interdit avec un jeton** (`403 session_required`) : administration (`/admin/*`), gestion des jetons, mot de passe et profil, suppression d'un projet.
- Débit : 600 requêtes par minute et par jeton (`429 rate_limited`, en-tête `Retry-After`).

---

## 2. Premier appel

Chaque requête envoie `Authorization: Bearer <jeton>`.

```bash
# Qui suis-je ? Quelles sont les limites du jeton ?
curl -s $FASTBOARD/api/me -H "Authorization: Bearer $TOKEN"
# → { "user": {...}, "token": { "id": 3, "name": "agent-planning", "scope": "write", "projectIds": [1] } }

# Projets accessibles
curl -s $FASTBOARD/api/projects -H "Authorization: Bearer $TOKEN"
```

Les corps de requête sont en JSON **encodé en UTF-8** (`-H "Content-Type: application/json"`). Sous Windows, un terminal en codage ANSI abîme les accents d'un `curl -d` : écrivez le JSON dans un fichier UTF-8 et envoyez-le avec `-d @corps.json`, ou utilisez un client HTTP (Python, Node, Postman). Les erreurs ont toujours la forme :

```json
{ "error": { "code": "forbidden", "message": "Vous n'avez pas la permission d'effectuer cette action.", "details": [] } }
```

| Statut | `error.code` | Signification |
| --- | --- | --- |
| 400 | `bad_request` | Données invalides : `details` liste `{path, message}` |
| 401 | `unauthorized`, `invalid_token` | Pas de jeton, ou jeton inconnu / expiré / révoqué |
| 403 | `forbidden`, `token_read_only`, `session_required` | Droit manquant, jeton en lecture seule, ou route réservée à l'interface |
| 404 | `not_found` | Ressource inexistante **ou invisible pour ce jeton** |
| 409 | `conflict` | Conflit (ex. projet archivé en lecture seule, dernier propriétaire…) |
| 429 | `rate_limited` | Trop de requêtes : attendre `Retry-After` secondes |

---

## 3. Le modèle en bref

**Projet** : porte une *clé* (`APP`) ; ses tickets s'appellent `APP-1`, `APP-2`… (`ticket.number` + clé du projet). Chaque projet a ses **catégories**, ses **priorités** (ordonnées de la plus haute à la plus basse), ses **composants** (nom, icône, couleur) et ses **livraisons** (nom, `startDate`, `endDate`).

**Ticket** : `title`, `description`, `status`, `categoryId`, `priorityId`, `componentIds` (plusieurs), `deliveryId` (livraison ciblée), `startDate`/`endDate` (sinon ils suivent la livraison), des **lignes d'avancement** (`parts` : un texte, une personne facultative, un pourcentage, terminée ou non), les **assignés** qui en découlent (`assignees`, une entrée par personne), un **ticket parent** (`parentId` : c'est alors un sous-ticket) et des **dépendances** vers d'autres tickets du projet (`links` : `targetId` + `reason`). `statusChangedAt` date le dernier changement de colonne (indicateur d'inactivité) ; `deliveryAddedAt` date le rattachement à la livraison actuelle (`null` sans livraison : burn-down des tickets ajoutés en cours de sprint).

**Description en Markdown** (GitHub Flavored Markdown : titres, listes, listes de tâches, tableaux, code) avec formules KaTeX (`$…$`, `$$…$$`) et diagrammes Mermaid (bloc ```` ```mermaid ````).

**Mentions** dans `description` et les commentaires : `@[Alice Martin](user:12)` pour une personne, `@[APP-12](ticket:34)` pour un ticket (l'interface les affiche en pastilles cliquables).

**Statuts** (colonnes du Kanban) :

| `status` | Colonne |
| --- | --- |
| `backlog` | Backlog |
| `todo` | À faire |
| `in_progress` | En cours |
| `blocked` | Bloqué |
| `review` | À tester |
| `done` | Terminé |

**Parts et avancement.** Chaque assigné déclare *sa part* : `done` (terminée) et/ou `progress` (0–100), et peut avoir une **mission** facultative (`note`, texte libre) qui décrit ce qu'il doit faire sur ce ticket. L'avancement global d'un ticket est :

- `100` si `status = done` ;
- sinon la moyenne des parts des assignés (une part terminée compte pour 100) ;
- sinon (aucun assigné) la valeur manuelle `progress` du ticket.

**Règles automatiques** :
- Quand **toutes** les parts sont terminées, le ticket passe tout seul à `done` ; si une part est rouverte (ou si une personne est ajoutée) sur un ticket `done`, il repasse à `in_progress`.
- `completedAt` est renseigné quand le ticket passe à `done`, et vidé quand il en sort.
- Un **projet archivé** est en lecture seule (`409`), sauf pour le désarchiver.
- Seuls les **membres actifs du projet** peuvent être assignés.

**Ordre dans une colonne.** Chaque ticket a une `position` (tri croissant). Ne la modifiez jamais directement : utilisez `POST /tickets/{id}/move` avec `beforeId`.

---

## 4. Recettes

### Lire le tableau

```bash
# Tout le projet en une requête (projet, membres, catégories, livraisons, tickets, vos permissions)
curl -s $FASTBOARD/api/projects/1 -H "Authorization: Bearer $TOKEN"

# Tickets filtrés et paginés (plus léger sur un gros projet)
curl -s "$FASTBOARD/api/projects/1/tickets?status=in_progress,blocked&assigneeId=me&limit=50" -H "Authorization: Bearer $TOKEN"
curl -s "$FASTBOARD/api/projects/1/tickets?key=APP-12" -H "Authorization: Bearer $TOKEN"
curl -s "$FASTBOARD/api/projects/1/tickets?q=paiement&deliveryId=none" -H "Authorization: Bearer $TOKEN"

# Un ticket, son historique, ses commentaires
curl -s $FASTBOARD/api/tickets/12          -H "Authorization: Bearer $TOKEN"
curl -s $FASTBOARD/api/tickets/12/history  -H "Authorization: Bearer $TOKEN"
curl -s $FASTBOARD/api/tickets/12/comments -H "Authorization: Bearer $TOKEN"
```

Filtres de `GET /projects/{id}/tickets` : `status` (liste séparée par des virgules), `categoryId`, `priorityId`, `componentId`, `deliveryId` (id ou `none`), `assigneeId` (id, `me` ou `none`), `key`, `q`, `updatedSince` (ISO 8601), `limit` (≤ 500), `offset`. La réponse contient `total` (avant pagination).

### Créer un ticket

```bash
curl -s -X POST $FASTBOARD/api/projects/1/tickets \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Corriger le calcul de TVA", "description": "Arrondi faux sur les remises.",
        "status": "todo", "categoryId": 2, "priorityId": 2, "componentIds": [5], "deliveryId": 4, "assigneeIds": [3], "endDate": "2026-11-20" }'
```

Les identifiants de priorités et de composants sont dans `GET /projects/{id}` (`priorities`, `components`).

### Déplacer un ticket (action du Kanban)

```bash
# Passer APP-12 (id 12) en « En cours », en fin de colonne
curl -s -X POST $FASTBOARD/api/tickets/12/move -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "in_progress", "beforeId": null }'

# … ou juste avant le ticket 40 de la colonne cible
curl -s -X POST $FASTBOARD/api/tickets/12/move -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "in_progress", "beforeId": 40 }'
```

### Modifier un ticket

Seuls les champs envoyés changent :

```bash
curl -s -X PATCH $FASTBOARD/api/tickets/12 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "startDate": "2026-11-03", "endDate": "2026-11-12", "deliveryId": 4, "assigneeIds": [3, 5] }'
```

`assigneeIds` **remplace** la liste des personnes : une personne ajoutée reçoit une ligne ; une personne retirée perd ses lignes vides, celles qui ont un texte restent sans personne. Passer `categoryId`, `deliveryId`, `startDate` ou `endDate` à `null` les vide.

### Déplacer un ticket vers un autre projet

```bash
curl -s -X POST $FASTBOARD/api/tickets/12/transfer -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "projectId": 3, "status": "todo" }'
```

Il faut `ticket.edit` dans le projet d'origine et `ticket.create` dans le projet cible. Le ticket reçoit une nouvelle clé (réponse `key`) ; catégorie, priorité, composants et livraison sont repris s'ils existent sous le même nom.

### Suivre un ticket et lire ses notifications

```bash
curl -s -X POST $FASTBOARD/api/tickets/12/watch -H "Authorization: Bearer $TOKEN"        # DELETE pour ne plus suivre
curl -s "$FASTBOARD/api/me/notifications?unread=true" -H "Authorization: Bearer $TOKEN"
curl -s -X POST $FASTBOARD/api/me/notifications/read -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

Le créateur, les assignés, les commentateurs et les personnes mentionnées suivent automatiquement un ticket ; une mention `@[Nom](user:12)` notifie la personne.

Ce qui est notifié dépend du **niveau** choisi par chaque personne pour chaque projet (`GET /me/notification-settings` liste les projets visibles et leur niveau) :

```bash
curl -s $FASTBOARD/api/me/notification-settings -H "Authorization: Bearer $TOKEN"
curl -s -X PUT $FASTBOARD/api/me/notification-settings/3 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "level": "mentions" }'
```

| `level` | Notifié |
| --- | --- |
| `all` | toute l'activité des tickets du projet, suivis ou non, assignations et mentions |
| `participating` (par défaut) | changements des tickets suivis, assignations et mentions |
| `mentions` | mentions `@` et assignations |
| `none` | rien, mentions comprises |

Les mentions dans la documentation ne dépendent pas d'un projet : elles sont toujours notifiées. Les tickets que vous créez ou commentez avec un jeton d'API ne s'ajoutent pas à vos tickets suivis (un agent qui travaille pour vous ne remplit pas vos notifications) ; les personnes assignées ou mentionnées les suivent comme d'habitude.

### Lignes d'avancement

```bash
# Ajouter (texte, personne ou les deux), terminer, régler, confier, réordonner (position = rang, 0 = première), supprimer
curl -s -X POST $FASTBOARD/api/tickets/12/parts -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "note": "Écrire les tests", "userId": 3 }'
curl -s -X PATCH $FASTBOARD/api/parts/7 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "progress": 50 }'
# 100 % et « terminée », c'est tout un : ceci revient à { "progress": 100 }
curl -s -X PATCH $FASTBOARD/api/parts/7 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "done": true }'
curl -s -X DELETE $FASTBOARD/api/parts/7 -H "Authorization: Bearer $TOKEN"
```

Chaque appel retourne le ticket à jour. La progression du ticket est la moyenne de ses lignes ; quand toutes sont terminées, il passe à `done`. Modifier le texte, l'avancement ou la fin de ses propres lignes demande `ticket.update_own_part` ; le reste demande `ticket.edit`.

**Rappel d'avancement.** Avec `settings.progressReminder` (et `settings.progressReminderDays`, 2 jours par défaut) dans `PATCH /projects/{id}`, les tickets `in_progress` d'une livraison en cours signalent dans l'interface les personnes qui n'ont pas mis à jour leur avancement depuis ce délai. Chaque ticket donne `progressUpdates` : pour chaque personne, la date de sa dernière mise à jour (pourcentage, état ou texte de sa ligne, ou commentaire). Un agent qui met à jour l'avancement pour quelqu'un le fait avec le jeton de cette personne, ou laisse un commentaire de progression.

### Documentation

À activer dans *Administration → Documentation* (sinon `409 docs_disabled`). Un espace contient des notes Markdown et des images, dans des dossiers. L'identifiant d'un fichier ne change pas quand on le renomme ou le déplace.

```bash
# Créer un espace, une note (dossiers créés au besoin), puis lire et remplacer son texte
curl -s -X POST $FASTBOARD/api/documentation/spaces -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "name": "Technique" }'
curl -s -X POST $FASTBOARD/api/documentation/spaces/1/nodes -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "path": "Guides/Installation", "content": "# Installer" }'
curl -s $FASTBOARD/api/documentation/nodes/5 -H "Authorization: Bearer $TOKEN"
curl -s -X PUT $FASTBOARD/api/documentation/nodes/5/content -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "content": "# Installer\n\nÉtape 1" }'
# Renommer ou déplacer, historique, restauration
curl -s -X PATCH $FASTBOARD/api/documentation/nodes/5 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "path": "Guides/Déploiement" }'
curl -s $FASTBOARD/api/documentation/nodes/5/versions -H "Authorization: Bearer $TOKEN"
curl -s -X POST $FASTBOARD/api/documentation/versions/12/restore -H "Authorization: Bearer $TOKEN"
# Export, puis réimport en deux temps : analyse, puis décisions
curl -s $FASTBOARD/api/documentation/spaces/1/export -H "Authorization: Bearer $TOKEN" -o espace.zip
curl -s -X POST $FASTBOARD/api/documentation/spaces/1/import -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/zip" --data-binary @espace.zip
curl -s -X POST $FASTBOARD/api/documentation/spaces/1/import/$IMPORT/apply -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "decisions": [{ "path": "Guides/Installation.md", "action": "auto" }] }'
# Un fichier seul (ou un dossier, en ZIP), et son réimport : le corps est le fichier, comparé à ce fichier-ci
curl -s $FASTBOARD/api/documentation/nodes/5/export -H "Authorization: Bearer $TOKEN" -o Installation.md
curl -s -X POST $FASTBOARD/api/documentation/nodes/5/import -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/markdown" --data-binary @Installation.md
# Ce que la note cite et ce qui la cite
curl -s $FASTBOARD/api/documentation/nodes/5/links -H "Authorization: Bearer $TOKEN"
# Commenter un passage (texte sans sa syntaxe Markdown), répondre, résoudre
curl -s -X POST $FASTBOARD/api/documentation/nodes/5/comments -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "quote": "Étape 1", "before": "Installer", "after": "", "body": "À revoir @[Léa](user:12)" }'
curl -s -X POST $FASTBOARD/api/documentation/nodes/5/comments -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "parentId": 3, "body": "Fait" }'
curl -s -X PATCH $FASTBOARD/api/documentation/comments/3 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "resolved": true }'
```

**Apparence.** `PATCH /me` enregistre aussi l’apparence du compte (`appearance`) : thèmes personnalisés (`colors` : couleurs `#RRGGBB` réglées une à une, comme `background`, `text`, `mdH1`, `mdLink` ou `mdCodeBg` ; `fonts` : polices propres au thème), polices (`doc` et `docSize` pour le texte des notes) et largeur du texte des notes (`reading` : `screen`, `column` ou `full`). `GET /themes/shared` liste les thèmes partagés du site ; `POST /themes/shared` en publie un (`{ theme }`), `DELETE /themes/shared/{id}` le retire (son auteur, ou `settings.manage`).

**Modèles de notes.** Chaque espace a ses modèles, à part de l'arbre : `GET /documentation/spaces/{id}` les donne dans `templates` (l'arbre reste dans `nodes`). Un modèle se crée comme une note, avec `kind: "template"` et un nom sans dossier (ses noms ne gênent pas ceux des notes), puis se lit, s'écrit, se renomme et se supprime comme elle. Pour créer une note d'après un modèle, passez son identifiant dans `fromId` à la place de `content` : `{{title}}` (ou `{{titre}}`) devient le titre de la note, `{{date}}` et `{{time}}` (ou `{{heure}}`) la date et l'heure du serveur, `{{author}}` (ou `{{auteur}}`) votre nom ; un format se donne à la manière de Moment.js, comme `{{date:DD/MM/YYYY}}` ou `{{date:dddd D MMMM}}`. Les variables inconnues restent telles quelles. Avec `kind: "template"` et `fromId` d'une note, le modèle en reprend le texte. Les modèles ne sont ni dans l'export ZIP de l'espace, ni dans la recherche, ni sur son site web.

```bash
curl -s -X POST $FASTBOARD/api/documentation/spaces/1/nodes -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "path": "Compte rendu", "kind": "template", "content": "# {{title}}\n\nLe {{date:DD/MM/YYYY}}, par {{author}}" }'
curl -s -X POST $FASTBOARD/api/documentation/spaces/1/nodes -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "path": "Réunions/Point du lundi", "fromId": 42 }'
```

Le ZIP reproduit exactement l'arbre de l'espace, dossiers vides compris, sans fichier ajouté. Le texte exporté reste 90 jours sur le serveur, pour vos 20 derniers exports d'un espace : il sert de version d'origine à la fusion. Sans lui (autre serveur, archive trop ancienne), les fichiers modifiés des deux côtés sont présentés en conflit.

Chaque fichier ou dossier porte une note libre (`memo`), écrite avec `PUT /documentation/nodes/{id}/memo`. `GET /documentation/nodes/{id}/info` donne sa taille (contenu compris pour un dossier), ses dates et, pour une note, ses mots et caractères. Chacun a ses favoris : `PUT` ou `DELETE /documentation/nodes/{id}/bookmark`, liste avec `GET /documentation/bookmarks`. Un espace peut accepter la syntaxe d'Obsidian (`obsidian`, vrai par défaut) et devenir un site web en lecture seule : `PUT /documentation/spaces/{id}/site` avec `visibility` (`members`, `people` avec `people`, ou `public`). Le site se lit à l'adresse `/wiki/{slug}`, et son contenu par `GET /wiki/{slug}` et `GET /wiki/{slug}/pages/{id}` de l'API, avec une recherche dans les titres et le texte des pages (`GET /wiki/{slug}/search?q=`) : sans compte s'il est public.

**Images d'une note.** `POST /documentation/spaces/{id}/images?folder=<dossier de la note>` (le corps est l'image, son nom dans l'en-tête `X-File-Name`) la range dans un sous-dossier à côté de la note : `imageFolder` de l'espace (réglé à la création ou par `PATCH /documentation/spaces/{id}`, `null` ou vide pour s'en remettre au site), sinon celui de *Administration → Documentation* (`defaultImageFolder` de l'espace ; `PUT /admin/documentation` avec `imageFolder`, `Pictures` par défaut). Le chemin retourné (`node.path`) se cite dans la note avec `![](…)` ou `![[…]]`. Changer de dossier ne déplace pas les images déjà rangées.

`POST /documentation/spaces/{id}/import` accepte aussi un fichier seul (`.md` ou image), nommé par l'en-tête `X-File-Name` : il devient une nouvelle note, ou la mise à jour de celle qui porte son nom. Avant d'appliquer, `GET …/import/{importId}/compare?path=…` donne le texte du serveur, celui de l'import et leur origine commune (`base`, ou `null`) ; le texte final retenu s'envoie dans `content`, avec l'action `auto`. De même, `POST /documentation/versions/{id}/restore` accepte un `content` pour ne reprendre qu'une partie d'une version.

Rôles : `reader` lit, `editor` écrit, `owner` gère aussi les membres et l'espace. Un texte envoyé par l'API apparaît en direct chez les personnes qui éditent la note. Pour citer un fichier dans un ticket ou une note : `@[Titre](doc:5)`. Les personnes mentionnées qui ont accès à l'espace sont notifiées. L'historique et la corbeille sont gardés 15 jours. Tous les membres peuvent commenter, lecteurs compris : `quote` retrouve le passage par son texte, `before` et `after` le départagent s'il figure plusieurs fois.

### Tableaux blancs

Comme la documentation : des espaces (`GET /boards/spaces`, `POST /boards/spaces`) avec les mêmes rôles, qui rangent des tableaux en dossiers (`GET /boards/spaces/{id}` donne l'arbre). Un tableau se crée avec `POST /boards/spaces/{id}/nodes` (`path`, `kind: "board"` ou `"folder"`, et éventuellement ses `elements` de départ), se lit avec `GET /boards/nodes/{id}` et s'écrit en entier avec `PUT /boards/nodes/{id}/elements` : les personnes qui l'ont ouvert voient le changement aussitôt. `GET /boards/nodes/{id}/preview` en donne une image SVG (`width`, `theme=dark` pour le thème sombre), et `GET /boards/search?q=` cherche dans les noms et les textes. `GET /boards/nodes/{id}/links` donne ses rétroliens (notes et tickets qui le mentionnent, tableaux qui le montrent dans un Fast Element) et ce que montrent ses Fast Elements ; `GET /documentation/nodes/{id}/links` liste de même les tableaux (`boards`) d'une note.

Un élément a un `id` (court, unique dans le tableau), un `type`, un ordre d'empilement `z` et, sauf pour un lien, une position et une taille `x`, `y`, `w`, `h` en pixels :

```json
[
  { "id": "a", "type": "shape", "z": 1, "x": 0, "y": 0, "w": 160, "h": 80, "shape": "rounded", "text": "Client", "color": "blue", "fill": "solid", "size": "m" },
  { "id": "b", "type": "shape", "z": 2, "x": 300, "y": 0, "w": 160, "h": 80, "shape": "cylinder", "text": "Base", "color": "default", "fill": "solid", "size": "m" },
  { "id": "l", "type": "connector", "z": 3, "from": { "id": "a", "side": null, "x": 0, "y": 0 }, "to": { "id": "b", "side": null, "x": 0, "y": 0 }, "label": "lit", "route": "elbow", "dashed": false, "arrowStart": false, "arrowEnd": true, "color": "default" }
]
```

Pour ajouter, remplacer ou retirer quelques éléments sans réécrire tout le tableau : `PATCH /boards/nodes/{id}/elements` avec `upsert` (éléments, remplacés s'ils ont le même `id`) et `remove` (identifiants ; les liens accrochés partent avec eux). Ce que d'autres dessinent en même temps est gardé.

Les types : `shape` (formes `rect`, `rounded`, `ellipse`, `diamond`, `parallelogram`, `hexagon`, `cylinder`, `triangle`), `text`, `sticky` (post-it, avec `votes`), `frame` (section titrée), `mind` (nœud de carte mentale, `parent`), `path` (trait à main levée), `fast` (objet de FastBoard : `ref: { kind: "ticket" | "note" | "folder" | "space" | "board", id }`), `table` (`rows`, la première ligne étant l'en-tête), `chart` (`chart`: `bar`, `line`, `pie`, `doughnut`, `radar`, données dans `rows` ou dans le tableau `source`) et `connector`. Couleurs : `default`, `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`. Un élément illisible est ignoré. Pour citer un tableau dans un ticket ou une note : `@[Titre](board:7)`.

Groupes : un élément (lien compris) peut porter `group`, un identifiant libre d'au plus 40 caractères ; les éléments qui partagent le même `group` forment un groupe, que l'interface sélectionne, déplace, copie et aligne d'un bloc (un groupe d'un seul élément ne compte pas). Pour dégrouper, renvoyez les éléments sans `group`. Les nœuds de carte mentale (`mind`) ne se groupent pas : le champ y est ignoré.

Icônes et images : un élément `icon` (`icon: "lucide:camera"` pour la bibliothèque intégrée, plus de 2 000 icônes Lucide ; `icon: "custom:12"` pour une icône ajoutée par un administrateur, voir `GET /boards/icons`), avec `color` et l'épaisseur `stroke` ; un élément `image` (`asset` : clé d'un fichier de l'espace). Les images et SVG d'un espace s'envoient avec `POST /boards/spaces/{id}/assets` (le corps est le fichier, son nom dans l'en-tête `X-File-Name`), se listent avec `GET /boards/spaces/{id}/assets` et se lisent sans compte à `/board-assets/{key}`.

Modèles : un nœud `kind: "template"` (un nom sans dossier) se crée comme un tableau, avec ses `elements`, et se lit et s'écrit de même. Une copie posée sur un tableau garde sur chacun de ses éléments un lien `tpl: { id, inst, key, v }` (le modèle, la copie, l'élément d'origine, la version copiée, c'est-à-dire le `updatedAt` du modèle) : l'interface compare la copie au modèle et propose de la remettre à jour.

Partager un tableau au-delà des membres de son espace (propriétaire de l'espace) : `PUT /boards/nodes/{id}/share` avec `audience` (`users` : toute personne connectée ; `people` : les personnes de `people` ; `public` : tout le monde, même sans compte), `role` (`reader` ou `editor`) et un `password` facultatif (absent : inchangé ; `null` : retiré). La réponse donne le `slug` de l'adresse `/t/{slug}` ; `GET` lit le partage et `DELETE` le retire (ceux qui sont entrés par l'adresse sortent aussitôt). Côté visiteur, `GET /board-shares/{slug}` décrit le tableau partagé ; s'il est protégé (`401`, code `board_password`), `POST /board-shares/{slug}/unlock` avec le `password` rend un jeton valable 7 jours, à renvoyer dans l'en-tête `X-Board-Share`. `GET /board-shares/{slug}/preview` en donne l'image.

### Champs personnalisés

Chaque projet peut définir ses propres champs (`settings.customFields` dans `GET /projects/{id}`) : `id` (`cf_…`), `label`, `type` (`text`, `longtext`, `number`, `date`, `select`, `multiselect`, `checkbox`, `url`, `user`) et `options` pour les listes. Les valeurs sont dans `ticket.customFields`.

```bash
# Renseigner (ou effacer avec null) des champs personnalisés ; les autres valeurs ne changent pas
curl -s -X PATCH $FASTBOARD/api/tickets/12 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "customFields": { "cf_budget": 1200, "cf_client": "Acme", "cf_valide": true, "cf_recette": "2026-12-01", "cf_referent": 3 } }'
```

Une valeur qui ne convient pas au type (choix absent de la liste, date mal écrite, personne non membre…) est refusée (`400`), sauf pour une liste ouverte (`allowNewOptions`) : le nouveau choix est alors ajouté à la liste du projet. Avec `settings.allowNewComponents`, `POST /projects/{id}/components` est permis à qui peut modifier les tickets. `settings.ticketFields` indique les champs standard affichés dans l'interface (un champ masqué garde ses valeurs).

### Sous-tickets (comme les sous-tâches de Jira)

Un sous-ticket est un ticket complet (colonne, assignés, dates, priorité…) rattaché à un ticket parent par `parentId`.

```bash
# Créer un sous-ticket de APP-12 (id 12)
curl -s -X POST $FASTBOARD/api/projects/1/tickets -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Maquettes", "parentId": 12 }'
# Rattacher un ticket existant, ou le détacher (null)
curl -s -X PATCH $FASTBOARD/api/tickets/15 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "parentId": 12 }'
curl -s -X PATCH $FASTBOARD/api/tickets/15 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "parentId": null }'
```

Les sous-tickets d'un ticket sont ceux dont `parentId` vaut son identifiant (`GET /projects/{id}` → `tickets`). Règles : même projet, un seul niveau (un sous-ticket n'a pas de sous-tickets, un ticket qui en a ne peut pas en devenir un). Supprimer le parent ou le déplacer dans un autre projet détache ses sous-tickets, qui restent.

L'avancement d'un ticket qui a des sous-tickets est, par défaut, la moyenne de l'avancement de ses sous-tickets (un parent dans une colonne « terminée » vaut toujours 100 %). Le champ `progressFromChildren` (vrai par défaut) règle ce calcul ticket par ticket ; `false` rend au ticket son avancement propre (parts des assignés ou valeur manuelle) :

```bash
curl -s -X PATCH $FASTBOARD/api/tickets/12 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "progressFromChildren": false }'
```

### Dépendances entre tickets

```bash
# APP-12 (id 12) est bloqué par le ticket 9 ; raisons proposées : « Bloqué par », « Bloque », « Dépend de »,
# « Est requis par », « Lié à », « Duplique », « Est dupliqué par », « Cause », « Est causé par » — ou un texte libre
curl -s -X POST $FASTBOARD/api/tickets/12/links -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "targetId": 9, "reason": "Bloqué par" }'
curl -s -X DELETE $FASTBOARD/api/links/4 -H "Authorization: Bearer $TOKEN"
```

Une dépendance est portée par un ticket (`links`) ; les dépendances *entrantes* se lisent sur les autres tickets du projet (`links[].targetId`).

### Déclarer l'avancement ou la fin d'une part

```bash
# Ma part est terminée (l'agent n'agit que pour le compte dont il porte le jeton)
curl -s -X PATCH $FASTBOARD/api/tickets/12/assignees/3 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "done": true }'

# Avancement personnel à 60 %
curl -s -X PATCH $FASTBOARD/api/tickets/12/assignees/3 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "progress": 60 }'
```

Chacun gère sa propre part (permission `ticket.update_own_part`) ; corriger celle d'un autre demande `ticket.edit`.

### Décrire la mission d'un assigné

```bash
# Ce que « test » (id 3) doit faire sur le ticket 12 ; une chaîne vide efface la mission
curl -s -X PATCH $FASTBOARD/api/tickets/12/assignees/3 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "note": "Écrire les tests d intégration du paiement et corriger les arrondis." }'
```

La mission est visible de tous les membres du projet (`assignees[].note` sur le ticket) et apparaît dans l'historique et le journal d'activité. La personne assignée peut éditer la sienne ; modifier celle d'un autre demande `ticket.edit`.

### Joindre un fichier à un ticket

```bash
# Le corps de la requête EST le fichier (octets bruts, pas de multipart/form-data).
# Le nom peut être donné par X-File-Name (encodé) ou par ?name=
curl -s -X POST $FASTBOARD/api/tickets/12/attachments -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/pdf" -H "X-File-Name: rapport-juin.pdf" --data-binary @rapport-juin.pdf

# Lister, télécharger, supprimer
curl -s $FASTBOARD/api/tickets/12/attachments -H "Authorization: Bearer $TOKEN"
curl -s -o rapport.pdf $FASTBOARD/api/attachments/5/download -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE $FASTBOARD/api/attachments/5 -H "Authorization: Bearer $TOKEN"
```

Lien web ou chemin vers un fichier / dossier (poste ou partage réseau) :

```bash
curl -s -X POST $FASTBOARD/api/tickets/12/attachment-links -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "kind": "url", "target": "https://exemple.fr/specification", "name": "Spécification" }'
```

25 Mo maximum par fichier (réponse `413`), 30 pièces jointes par ticket. Envoyer demande la permission `attachment.create` ; supprimer, celle d'en être l'auteur ou `attachment.moderate`. Les images sont reconnues d'après leur contenu ; tout autre fichier est toujours servi en téléchargement.

### Commenter, répondre

```bash
curl -s -X POST $FASTBOARD/api/tickets/12/comments -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "body": "Analyse terminée : cause = arrondi appliqué avant la remise." }'

# Répondre à un commentaire
curl -s -X POST $FASTBOARD/api/tickets/12/comments -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "body": "Merci, je prépare le correctif.", "parentId": 87 }'
```

### Suivre l'activité du tableau

```bash
# Les 50 derniers évènements
curl -s "$FASTBOARD/api/projects/1/activity" -H "Authorization: Bearer $TOKEN"

# Page suivante (plus anciens) : réutiliser nextBefore tant qu'il n'est pas null
curl -s "$FASTBOARD/api/projects/1/activity?before=420" -H "Authorization: Bearer $TOKEN"

# Filtres : group=ticket,comment,config,member · userId · source=api (actions des agents) ou source=ui · ticketId
curl -s "$FASTBOARD/api/projects/1/activity?group=ticket&ticketId=12&limit=20" -H "Authorization: Bearer $TOKEN"
```

Chaque évènement a un `group`, un `data.kind` (`ticket`, `ticket_deleted`, `comment`, `category`, `priority`, `component`, `delivery`, `member`, `project`), l'auteur (`userId`) et `via` (nom d'affichage du jeton si l'action vient de l'API). L'historique d'un ticket (`GET /tickets/{id}/history`) porte aussi `via`. Pour surveiller le tableau en continu, interrogez toutes les 10–30 secondes en mémorisant le plus grand `id` déjà vu, ou utilisez le WebSocket (§5).

Chaque évènement porte aussi sa discussion (`comments`). Pour commenter un évènement (les personnes mentionnées sont notifiées) :

```bash
curl -s -X POST $FASTBOARD/api/activities/420/comments -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "body": "Validé avec @[Alice](user:3)" }'
# Modifier (son propre commentaire) ou supprimer
curl -s -X PATCH $FASTBOARD/api/activity-comments/7 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "body": "Validé" }'
curl -s -X DELETE $FASTBOARD/api/activity-comments/7 -H "Authorization: Bearer $TOKEN"
```

### Exporter un projet

```bash
curl -s -o projet.json "$FASTBOARD/api/projects/1/export?format=json" -H "Authorization: Bearer $TOKEN"   # projet complet
curl -s -o tickets.csv "$FASTBOARD/api/projects/1/export?format=csv"  -H "Authorization: Bearer $TOKEN"   # tableau des tickets
```

### Recherche globale

```bash
# Projets, tickets, documents et utilisateurs visibles ; une clé exacte arrive en tête
curl -s "$FASTBOARD/api/search?q=paiement&type=tickets&limit=20" -H "Authorization: Bearer $TOKEN"
curl -s "$FASTBOARD/api/search?q=installation&type=docs" -H "Authorization: Bearer $TOKEN"
```

### Catégories, priorités, composants et livraisons

```bash
curl -s -X POST $FASTBOARD/api/projects/1/categories -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Sécurité", "color": "#ef4444" }'

curl -s -X POST $FASTBOARD/api/projects/1/components -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "API", "color": "#0ea5e9", "icon": "pi pi-server" }'

curl -s -X POST $FASTBOARD/api/projects/1/deliveries -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "V1.2 — Paiement", "startDate": "2026-12-01", "endDate": "2027-01-31", "color": "#10b981" }'
```

---

## 5. Temps réel (facultatif)

Le serveur diffuse les évènements d'un projet en WebSocket : `ws://<hôte>/ws` avec l'en-tête `Authorization: Bearer <jeton>` (non disponible dans le `WebSocket` du navigateur, mais présent dans les clients Node/Python). Messages JSON :

```jsonc
// client → serveur
{ "t": "subscribe", "projectId": 1 }
// serveur → client
{ "t": "subscribed", "projectId": 1 }
{ "t": "event", "projectId": 1, "event": { "type": "ticket.updated", "ticket": { … } }, "actorId": 3, "origin": null, "at": "2026-10-15T10:00:00.000Z" }
{ "t": "event", "projectId": 1, "event": { "type": "activity.created", "activity": { … } }, … }
```

Types d'évènements : `ticket.created|updated|deleted`, `tickets.reordered`, `comment.created|updated|deleted`, `history.created`, `activity.created`, `category.*`, `priority.*`, `component.*`, `delivery.*`, `project.updated`, `members.changed`. La définition complète est dans `shared/realtime.ts`.

---

## 6. Bonnes pratiques pour un agent

1. **Commencez par `GET /me`** pour connaître la portée et les projets du jeton, puis `GET /projects/{id}` pour comprendre le tableau (catégories, livraisons, membres) avant d'écrire.
2. **N'inventez pas d'identifiants** : utilisez ceux lus dans les réponses (`categoryId`, `deliveryId`, ids des membres…). La clé `APP-12` n'est pas un id : `GET /projects/{id}/tickets?key=APP-12` donne l'`id`.
3. **Relisez avant de modifier** : un collègue a peut-être changé le ticket. Les `PATCH` ne touchent que les champs envoyés, ce qui limite les conflits.
4. **Une intention = un appel.** Préférez `POST /tickets/{id}/move` à un `PATCH` de `status` quand vous déplacez une carte (c'est ce que fait l'interface, et le rang est géré).
5. **Expliquez vos actions** par un commentaire court sur le ticket : l'équipe verra « via <nom du jeton> » dans l'activité.
6. **Respectez le débit** (`X-RateLimit-Remaining`, `Retry-After`) et paginez (`limit`, `offset`, `before`) au lieu de tout recharger.
7. **Gérez les erreurs** : `409`/`403`/`404` sont normaux (projet archivé, droit manquant, ticket supprimé) ; ne réessayez pas en boucle, remontez le message.
8. **Moindre privilège** : un jeton par agent, limité aux projets utiles, en lecture seule tant que l'agent n'a pas besoin d'écrire.

### Exemple de consigne système pour un agent

> Tu es l'assistant de planification de l'équipe. Tu travailles sur le projet FastBoard n°1 via l'API (`$FASTBOARD/api`, jeton dans l'en-tête `Authorization: Bearer`). Avant d'agir, lis `GET /me` et `GET /projects/1`. Tu peux créer des tickets, les déplacer (`POST /tickets/{id}/move`), ajuster leurs dates et commenter. Tu ne supprimes jamais de ticket. Après chaque modification, ajoute un commentaire d'une phrase expliquant pourquoi. Si une requête échoue en 403/409, arrête et explique la raison à l'utilisateur. La documentation complète est dans `$FASTBOARD/api/docs/guide.md` et `$FASTBOARD/api/openapi.json`.
