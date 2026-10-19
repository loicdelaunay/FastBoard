import { currentLocale } from './index';

/**
 * Les messages d'erreur du serveur sont en français. Dans une autre langue, on les traduit ici : texte exact d'abord,
 * puis modèles à variables (noms, nombres), puis messages de validation (« champ : message »).
 */
const EXACT: Record<string, string> = {
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
  'Utilisateur introuvable.': 'User not found.',
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

const PATTERNS: Array<[RegExp, (match: RegExpExecArray) => string]> = [
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
