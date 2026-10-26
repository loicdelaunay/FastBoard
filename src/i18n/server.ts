import { currentLocale } from './index';

/**
 * Les messages d'erreur du serveur sont en français. Dans une autre langue, on les traduit ici : texte exact d'abord,
 * puis modèles à variables (noms, nombres), puis messages de validation (« champ : message »).
 */
const EXACT: Record<string, string> = {
  // 1.6
  "Évènement introuvable.": "Event not found.",
  "Le commentaire est vide.": "The comment is empty.",
  "Ce commentaire a été supprimé.": "This comment has been deleted.",
  "Vous ne pouvez modifier que vos propres commentaires.": "You can only edit your own comments.",
  "Vous ne pouvez supprimer que vos propres commentaires.": "You can only delete your own comments.",
  // 1.5
  "Police invalide.": "Invalid font.",
  // 1.4
  "Un ticket ne peut pas être son propre parent.": "A ticket cannot be its own parent.",
  "Le ticket parent doit appartenir au même projet.": "The parent ticket must belong to the same project.",
  "Le ticket parent est déjà un sous-ticket : un seul niveau est possible.": "The parent ticket is already a sub-ticket: only one level is possible.",
  "Ce ticket a déjà des sous-tickets : il ne peut pas devenir un sous-ticket.": "This ticket already has sub-tickets: it cannot become a sub-ticket.",
  "Conversation introuvable.": "Conversation not found.",
  "Identifiant de conversation invalide.": "Invalid conversation identifier.",
  "Conversation trop longue pour être enregistrée : commencez-en une nouvelle.": "Conversation too long to be saved: start a new one.",
  "Aucun modèle d'IA n'est proposé.": "No AI model is offered.",
  "Ajoutez au moins un fournisseur.": "Add at least one provider.",
  "Indiquez les fichiers du certificat pour activer HTTPS.": "Enter the certificate files to enable HTTPS.",
  "Certificat valide.": "Valid certificate.",
  "Le fichier du certificat n’est pas un certificat PEM valide.": "The certificate file is not a valid PEM certificate.",
  "Clé privée chiffrée : mot de passe absent ou incorrect.": "Encrypted private key: missing or wrong password.",
  "La clé privée n’est pas une clé PEM valide.": "The private key is not a valid PEM key.",
  "La clé privée ne correspond pas au certificat.": "The private key does not match the certificate.",
  "PFX illisible : mot de passe absent ou incorrect.": "Unreadable PFX: missing or wrong password.",
  "Nom d’hôte ou adresse IP invalide.": "Invalid host name or IP address.",
  "Choisissez au moins un modèle.": "Choose at least one model.",
  "Image invalide (PNG, JPEG, WebP ou GIF en base64).": "Invalid image (base64 PNG, JPEG, WebP or GIF).",
  // 1.3
  "L'assistant IA n'est pas activé sur ce site.": "The AI assistant is not enabled on this site.",
  "Vous n'avez pas accès à l'assistant IA dans ce projet.": "You do not have access to the AI assistant in this project.",
  "L'assistant IA est désactivé.": "The AI assistant is disabled.",
  "Erreur interne de l'assistant.": "Internal assistant error.",
  "Réponse du fournisseur d'IA inattendue (aucun message).": "Unexpected answer from the AI provider (no message).",
  "Le dernier message doit venir de la personne.": "The last message must come from the person.",
  // 1.2
  "Adresse web invalide.": "Invalid web address.",
  "Seules les adresses http, https, ftp et mailto sont acceptées.": "Only http, https, ftp and mailto addresses are accepted.",
  "Indiquez un chemin absolu, par exemple C:\\Dossier\\fichier.pdf, \\\\serveur\\partage ou /home/moi/fichier.pdf.": "Enter an absolute path, for example C:\\Folder\\file.pdf, \\\\server\\share or /home/me/file.pdf.",
  "Ce fichier ou ce dossier n'existe pas sur cette machine.": "This file or folder does not exist on this machine.",
  "FastBoard ne tourne pas sur votre poste : ouvrez le chemin vous-même.": "FastBoard is not running on your computer: open the path yourself.",
  "Cette pièce jointe n'est pas un chemin de fichier.": "This attachment is not a file path.",
  "Cette pièce jointe est un lien : il n'y a pas de fichier à télécharger.": "This attachment is a link: there is no file to download.",
  "Le ticket est déjà dans ce projet.": "The ticket is already in this project.",
  "Le projet cible est archivé.": "The target project is archived.",
  "Le fichier n'est pas une image PNG, JPEG ou WebP valide (512 Ko maximum).": "The file is not a valid PNG, JPEG or WebP image (512 KB maximum).",
  "La fin de la maintenance doit suivre son début.": "The maintenance end must come after its start.",
  "Aucun logo.": "No logo.",
  // 1.1 : priorités, composants, sous-tâches, dépendances, jetons, sauvegardes, service.
  'Priorité introuvable.': 'Priority not found.',
  'Composant introuvable.': 'Component not found.',
  'Une priorité porte déjà ce nom dans le projet.': 'A priority with this name already exists in the project.',
  'Un composant porte déjà ce nom dans le projet.': 'A component with this name already exists in the project.',
  "Cette priorité n'appartient pas au projet.": 'This priority does not belong to the project.',
  "Ce composant n'appartient pas au projet.": 'This component does not belong to the project.',
  'Sous-tâche introuvable.': 'Subtask not found.',
  'Dépendance introuvable.': 'Dependency not found.',
  'Un ticket ne peut pas dépendre de lui-même.': 'A ticket cannot depend on itself.',
  'Le ticket lié doit appartenir au même projet.': 'The linked ticket must belong to the same project.',
  'Cette dépendance existe déjà.': 'This dependency already exists.',
  'Un jeton révoqué ne peut plus être modifié.': 'A revoked token can no longer be modified.',
  'Mot de passe incorrect.': 'Incorrect password.',
  'Ce jeton est révoqué.': 'This token is revoked.',
  "Ce jeton a été créé avant la version 1.1 ou sa clé de chiffrement a changé : il ne peut pas être réaffiché. Créez-en un nouveau.": 'This token was created before version 1.1 or its encryption key changed: it cannot be shown again. Create a new one.',
  'Saisissez votre mot de passe.': 'Enter your password.',
  'Saisissez un texte à rechercher.': 'Enter some text to search for.',
  'Utilisateur introuvable.': 'User not found.',
  'Destination de sauvegarde introuvable.': 'Backup destination not found.',
  'Une sauvegarde est déjà en cours vers cette destination.': 'A backup to this destination is already running.',
  'Deux destinations portent le même identifiant.': 'Two destinations have the same identifier.',
  'Choisissez un dossier en dehors du dossier des données de FastBoard.': 'Choose a folder outside the FastBoard data folder.',
  'Le chemin doit être absolu.': 'The path must be absolute.',
  'Dossier accessible en écriture.': 'Folder is writable.',
  'Interrompue par un arrêt du serveur.': 'Interrupted by a server shutdown.',
  "L'archive dépasse 4 Go : format non pris en charge.": 'The archive exceeds 4 GB: format not supported.',
  "L'installation en tant que service n'est pas prise en charge sur ce système.": 'Installing as a service is not supported on this system.',
  "Le service lancera Node avec les sources du projet : l'exécutable autonome (npm run build:exe) est recommandé.": 'The service will run Node with the project sources: the standalone executable (npm run build:exe) is recommended.',
  "L'interface n'est pas construite (dossier dist/ absent) : lancez « npm run build » avant de démarrer le service.": 'The interface is not built (no dist/ folder): run “npm run build” before starting the service.',
  'Règles invalides : « durée:intervalle » séparés par des virgules, ex. 7D:0s,4W:1D,12M:1W.': 'Invalid rules: “timeframe:interval” separated by commas, e.g. 7D:0s,4W:1D,12M:1W.',
  'Heure invalide (HH:MM).': 'Invalid time (HH:MM).',
  'Icône invalide (classe PrimeIcons, ex. « pi pi-flag »).': 'Invalid icon (PrimeIcons class, e.g. “pi pi-flag”).',
  'Adresse e-mail ou mot de passe incorrect.': 'Incorrect email address or password.',
  'Aucune image.': 'No image.',
  'Authentification requise.': 'Authentication required.',
  'Catégorie introuvable.': 'Category not found.',
  'Ce compte est désactivé. Contactez un administrateur.': 'This account is disabled. Contact an administrator.',
  "Ce jeton d'API est en lecture seule.": 'This API token is read-only.',
  'Ce jeton est limité à certains projets : il ne peut pas en créer de nouveau.': 'This token is limited to certain projects: it cannot create a new one.',
  'Ce projet est archivé : il est en lecture seule.': 'This project is archived: it is read-only.',
  'Ce rôle est encore attribué : réassignez ses utilisateurs avant de le supprimer.': 'This role is still assigned: reassign its users before deleting it.',
  'Ce rôle est verrouillé et ne peut pas être modifié.': 'This role is locked and cannot be modified.',
  'Cet utilisateur est déjà membre du projet.': 'This user is already a member of the project.',
  "Cette catégorie n'appartient pas au projet.": 'This category does not belong to the project.',
  "Cette livraison n'appartient pas au projet.": 'This delivery does not belong to the project.',
  "Cette opération n'est pas accessible avec un jeton d'API : utilisez l'interface.": 'This operation is not available with an API token: use the interface.',
  "Cette personne n'est pas assignée au ticket.": 'This person is not assigned to the ticket.',
  'Chaque statut doit apparaître une seule fois dans les colonnes.': 'Each status must appear exactly once in the columns.',
  'Commentaire introuvable.': 'Comment not found.',
  'Corps de requête JSON invalide.': 'Invalid JSON request body.',
  'Données invalides.': 'Invalid data.',
  'Erreur interne du serveur.': 'Internal server error.',
  'Guide introuvable.': 'Guide not found.',
  'Identifiant invalide.': 'Invalid identifier.',
  'Il doit rester au moins un super administrateur actif.': 'At least one active super administrator must remain.',
  'Image invalide (PNG, JPEG ou WebP, 512 Ko maximum).': 'Invalid image (PNG, JPEG or WebP, 512 KB maximum).',
  "Jeton d'API invalide, expiré ou révoqué.": 'API token invalid, expired or revoked.',
  'Jeton introuvable.': 'Token not found.',
  "L'envoi du fichier a été interrompu.": 'The file upload was interrupted.',
  'La clé contient 2 à 8 lettres ou chiffres.': 'The key contains 2 to 8 letters or digits.',
  'La colonne « Terminé » ne peut pas être masquée.': 'The “Done” column cannot be hidden.',
  'La date de début doit précéder la date de fin.': 'The start date must come before the end date.',
  'Le contenu envoyé est trop volumineux.': 'The submitted content is too large.',
  'Le fichier est introuvable sur le serveur.': 'The file could not be found on the server.',
  'Le fichier est vide.': 'The file is empty.',
  "Le fichier n'est pas une image PNG, JPEG ou WebP valide.": 'The file is not a valid PNG, JPEG or WebP image.',
  'Le message auquel vous répondez est introuvable.': 'The message you are replying to could not be found.',
  'Le mot de passe actuel est incorrect.': 'The current password is incorrect.',
  'Le mot de passe doit contenir au moins 8 caractères.': 'The password must contain at least 8 characters.',
  'Le projet doit conserver au moins un propriétaire.': 'The project must keep at least one owner.',
  'Le ticket de référence ne se trouve pas dans cette colonne.': 'The reference ticket is not in this column.',
  'Le titre est obligatoire.': 'The title is required.',
  'Le message est vide.': 'The message is empty.',
  'Donnez un nom au jeton.': 'Give the token a name.',
  'Livraison introuvable.': 'Delivery not found.',
  'Membre introuvable.': 'Member not found.',
  'Origine de la requête non autorisée.': 'Request origin not allowed.',
  'Pièce jointe introuvable.': 'Attachment not found.',
  'Projet introuvable.': 'Project not found.',
  'Ressource introuvable.': 'Resource not found.',
  'Route inconnue.': 'Unknown route.',
  'Rôle de projet invalide.': 'Invalid project role.',
  'Rôle global invalide.': 'Invalid global role.',
  'Rôle introuvable.': 'Role not found.',
  'Seule la personne assignée peut mettre à jour sa part.': 'Only the assigned person can update their part.',
  'Seuls les membres actifs du projet peuvent être assignés à un ticket.': 'Only active project members can be assigned to a ticket.',
  'Thème inconnu.': 'Unknown theme.',
  'Ticket introuvable.': 'Ticket not found.',
  "Trop de requêtes avec ce jeton d'API. Réessayez dans quelques instants.": 'Too many requests with this API token. Try again in a moment.',
  'Trop de tentatives de connexion. Réessayez dans quelques minutes.': 'Too many login attempts. Try again in a few minutes.',
  'Un compte utilise déjà cette adresse e-mail.': 'An account already uses this email address.',
  'Un rôle porte déjà ce nom.': 'A role already has this name.',
  'Un rôle système ne peut pas être renommé.': 'A system role cannot be renamed.',
  'Un rôle système ne peut pas être supprimé.': 'A system role cannot be deleted.',
  'Une catégorie porte déjà ce nom dans le projet.': 'A category with this name already exists in the project.',
  'Utilisateur introuvable ou désactivé.': 'User not found or disabled.',
  'Votre session a changé : vous êtes connecté avec un autre compte dans un autre onglet.': 'Your session has changed: you are signed in with another account in another tab.',
  "Vous n'avez pas la permission d'effectuer cette action.": 'You do not have permission to perform this action.',
  'Vous ne pouvez modifier que vos propres messages.': 'You can only edit your own messages.',
  'Vous ne pouvez pas accorder des permissions que vous ne possédez pas.': 'You cannot grant permissions you do not have.',
  'Vous ne pouvez pas attribuer un rôle plus privilégié que le vôtre.': 'You cannot assign a role more privileged than your own.',
  'Vous ne pouvez pas désactiver votre propre compte.': 'You cannot disable your own account.',
  'Vous ne pouvez pas modifier un compte plus privilégié que le vôtre.': 'You cannot modify an account more privileged than your own.',
  'Vous ne pouvez pas modifier un membre plus privilégié que vous.': 'You cannot modify a member more privileged than you.',
  'Vous ne pouvez pas modifier un rôle plus privilégié que le vôtre.': 'You cannot modify a role more privileged than your own.',
  'Vous ne pouvez pas modifier votre propre rôle.': 'You cannot change your own role.',
  'Vous ne pouvez pas retirer un membre plus privilégié que vous.': 'You cannot remove a member more privileged than you.',
  'Vous ne pouvez pas supprimer un compte plus privilégié que le vôtre.': 'You cannot delete an account more privileged than your own.',
  'Vous ne pouvez pas supprimer un rôle plus privilégié que le vôtre.': 'You cannot delete a role more privileged than your own.',
  'Vous ne pouvez pas supprimer votre propre compte.': 'You cannot delete your own account.',
  'Vous ne pouvez supprimer que vos propres messages.': 'You can only delete your own messages.',
  'Vous ne pouvez supprimer que vos propres pièces jointes.': 'You can only delete your own attachments.',
  "Envoyez le fichier en corps brut (curl --data-binary @fichier), pas en multipart/form-data.": 'Send the file as a raw body (curl --data-binary @file), not as multipart/form-data.',
  'Couleur invalide (format #RRGGBB).': 'Invalid colour (format #RRGGBB).',
  'Date invalide (AAAA-MM-JJ).': 'Invalid date (YYYY-MM-DD).',
  'adresse e-mail invalide': 'invalid email address',
  'date et heure ISO invalide': 'invalid ISO date and time',
};

EXACT['(route inconnue)'] = '(unknown route)';
EXACT['(non authentifié)'] = '(not authenticated)';
EXACT['(autre)'] = '(other)';
EXACT['(autres)'] = '(others)';

const TYPES: Record<string, string> = {
  'chaîne de caractères': 'string',
  nombre: 'number',
  entier: 'integer',
  booléen: 'boolean',
  tableau: 'array',
  objet: 'object',
  indéfini: 'undefined',
  nul: 'null',
};
const type = (word: string): string => TYPES[word] ?? word;

const FILE_KINDS: Record<string, string> = {
  'du certificat': 'certificate',
  'de la clé privée': 'private key',
  'des certificats intermédiaires': 'intermediate certificates',
  PFX: 'PFX',
};

const PATTERNS: Array<[RegExp, (match: RegExpExecArray) => string]> = [
  // 1.6
  [/^« (.+) » a déjà (\d+) choix\.$/, (m) => `“${m[1]}” already has ${m[2]} choices.`],
  // 1.5
  [/^Valeur invalide pour « (.+) » : (.+) attendu\.$/, (m) => `Invalid value for “${m[1]}”: expected ${m[2]}.`],
  [/^Champ personnalisé inconnu : (.+)\.$/, (m) => `Unknown custom field: ${m[1]}.`],
  // 1.4
  [/^Le fournisseur d'IA n'a pas répondu dans le délai \((\d+) s\)\.$/, (m) => `The AI provider did not answer in time (${m[1]} s).`],
  [/^Indiquez le chemin du fichier (.+)\.$/, (m) => `Enter the path of the ${FILE_KINDS[m[1]!] ?? m[1]} file.`],
  [/^Fichier (.+?) illisible \((.+)\) : introuvable$/, (m) => `Unreadable ${FILE_KINDS[m[1]!] ?? m[1]} file (${m[2]}): not found`],
  [/^Fichier (.+?) illisible \((.+)\) : (.+)$/, (m) => `Unreadable ${FILE_KINDS[m[1]!] ?? m[1]} file (${m[2]}): ${m[3]}`],
  [/^Certificat refusé : (.+)$/, (m) => `Certificate rejected: ${m[1]}`],
  [/^Le port (\d+) est déjà utilisé\.$/, (m) => `Port ${m[1]} is already in use.`],
  [/^Droits insuffisants pour écouter sur le port (\d+)\.$/, (m) => `Insufficient rights to listen on port ${m[1]}.`],
  [/^Le port HTTPS doit être différent du port HTTP \((\d+)\)\.$/, (m) => `The HTTPS port must differ from the HTTP port (${m[1]}).`],
  [/^Fournisseur d'IA injoignable \((.+?)\) : (.+)$/, (m) => `AI provider unreachable (${m[1]}): ${m[2]}`],
  [/^Le fournisseur d'IA a répondu (\d+) : (.*)$/, (m) => `The AI provider answered ${m[1]}: ${m[2]}`],
  [/^Connexion réussie \((.+?)\) : (.*)$/, (m) => `Connection succeeded (${m[1]}): ${m[2]}`],
  [/^Un ticket ne peut pas avoir plus de (\d+) sous-tâches\.$/, (m) => `A ticket cannot have more than ${m[1]} subtasks.`],
  [/^Un ticket ne peut pas avoir plus de (\d+) dépendances\.$/, (m) => `A ticket cannot have more than ${m[1]} dependencies.`],
  [/^Le dossier de « (.+) » doit être un chemin absolu\.$/, (m) => `The folder of “${m[1]}” must be an absolute path.`],
  [/^Dossier accessible en écriture \((.+) libres\)\.$/, (m) => `Folder is writable (${m[1]} free).`],
  [/^Dossier inaccessible : (.+)$/, (m) => `Folder not accessible: ${m[1]}`],
  [/^Le service utilisera le port (\d+), déjà utilisé par ce serveur : arrêtez cette instance avant de démarrer le service\.$/, (m) => `The service will use port ${m[1]}, already used by this server: stop this instance before starting the service.`],
  [/^Ce fichier dépasse la taille maximale autorisée \((.+) Mo\)\.$/, (m) => `This file exceeds the maximum allowed size (${m[1]} MB).`],
  [/^La colonne « (.+) » est masquée dans ce projet\.$/, (m) => `The “${m[1]}” column is hidden in this project.`],
  [/^La colonne « (.+) » contient (\d+) tickets? : déplacez-les avant de la masquer\.$/, (m) => `The “${m[1]}” column contains ${m[2]} ticket${m[2] === '1' ? '' : 's'}: move them before hiding it.`],
  [/^Le projet (\d+) est introuvable ou vous n'y avez pas accès\.$/, (m) => `Project ${m[1]} was not found or you do not have access to it.`],
  [/^Permission inconnue : (.+)\.$/, (m) => `Unknown permission: ${m[1]}.`],
  [/^Un ticket ne peut pas avoir plus de (\d+) pièces jointes\.$/, (m) => `A ticket cannot have more than ${m[1]} attachments.`],
  // Raisons de l'état de santé (page Performances).
  [/^(.+) % de réponses en erreur serveur$/, (m) => `${m[1]} % of responses are server errors`],
  [/^Latence p95 de ([0-9]+) ms$/, (m) => `p95 latency of ${m[1]} ms`],
  [/^Boucle d.évènements en retard de ([0-9]+) ms$/, (m) => `Event loop lagging by ${m[1]} ms`],
  [/^Mémoire de la machine utilisée à ([0-9]+) %$/, (m) => `Machine memory used at ${m[1]} %`],
  [/^Entrée invalide : (.+) attendu, (.+) reçu$/, (m) => `Invalid input: expected ${type(m[1]!)}, received ${type(m[2]!)}`],
  [/^Trop petit : (.+) doit avoir >=(\d+) caractères$/, (m) => `Too small: ${type(m[1]!)} must have at least ${m[2]} characters`],
  [/^Trop grand : (.+) doit avoir <=(\d+) caractères$/, (m) => `Too big: ${type(m[1]!)} must have at most ${m[2]} characters`],
  [/^Trop petit : (.+) doit avoir >=(\d+) éléments$/, (m) => `Too small: ${type(m[1]!)} must have at least ${m[2]} items`],
  [/^Trop grand : (.+) doit avoir <=(\d+) éléments$/, (m) => `Too big: ${type(m[1]!)} must have at most ${m[2]} items`],
  [/^Trop petit : (.+) doit être >=(.+)$/, (m) => `Too small: ${type(m[1]!)} must be at least ${m[2]}`],
  [/^Trop grand : (.+) doit être <=(.+)$/, (m) => `Too big: ${type(m[1]!)} must be at most ${m[2]}`],
  [/^Option invalide : une valeur parmi (.+) attendue$/, (m) => `Invalid option: expected one of ${m[1]}`],
  [/^Chaîne de caractères invalide : doit correspondre au motif (.+)$/, (m) => `Invalid string: must match pattern ${m[1]}`],
];

/** Traduit un message d'erreur du serveur dans la langue de l'interface (le français est renvoyé tel quel). */
export function translateServerMessage(message: string): string {
  if (currentLocale() === 'fr') {
    return message;
  }
  const exact = EXACT[message];
  if (exact) {
    return exact;
  }
  for (const [pattern, build] of PATTERNS) {
    const match = pattern.exec(message);
    if (match) {
      return build(match);
    }
  }
  // Messages de validation : « champ : message ».
  const field = /^([\w.[\]]+) : (.+)$/.exec(message);
  if (field) {
    return `${field[1]} : ${translateServerMessage(field[2]!)}`;
  }
  return message;
}
