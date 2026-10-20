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

**Ticket** : `title`, `description`, `status`, `categoryId`, `priorityId`, `componentIds` (plusieurs), `deliveryId` (livraison ciblée), `startDate`/`endDate` (sinon ils suivent la livraison), plusieurs **assignés**, des **sous-tâches** (`subtasks`) et des **dépendances** vers d'autres tickets du projet (`links` : `targetId` + `reason`). `statusChangedAt` date le dernier changement de colonne (indicateur d'inactivité).

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

`assigneeIds` **remplace** la liste des assignés (les parts des personnes conservées sont gardées). Passer `categoryId`, `deliveryId`, `startDate` ou `endDate` à `null` les vide.

### Sous-tâches

```bash
# Ajouter, cocher, renommer, réordonner (position = rang, 0 = première), supprimer
curl -s -X POST $FASTBOARD/api/tickets/12/subtasks -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "title": "Écrire les tests", "assigneeId": 3 }'
curl -s -X PATCH $FASTBOARD/api/subtasks/7 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{ "done": true }'
curl -s -X DELETE $FASTBOARD/api/subtasks/7 -H "Authorization: Bearer $TOKEN"
```

Chaque appel retourne le ticket à jour. Cocher une sous-tâche dont on est responsable demande `ticket.update_own_part` ; le reste demande `ticket.edit`.

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

### Recherche globale

```bash
# Projets, tickets et utilisateurs visibles ; une clé exacte arrive en tête
curl -s "$FASTBOARD/api/search?q=paiement&type=tickets&limit=20" -H "Authorization: Bearer $TOKEN"
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
