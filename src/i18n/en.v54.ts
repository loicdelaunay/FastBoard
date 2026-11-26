/** Textes ajoutés en 2.30.0 : lecture seule hors ligne. */
export const enV54: Record<string, string> = {
  'Serveur injoignable : lecture seule. La modification n’a pas été enregistrée.':
    'Server unreachable: read-only. The change was not saved.',
  'Serveur injoignable : lecture seule':
    'Server unreachable: read-only',
  'Vous consultez ce qui a été gardé sur cet appareil ; rien ne peut être modifié tant que le serveur ne répond pas.':
    'You are viewing what was kept on this device; nothing can be changed until the server responds.',
  'Données les plus anciennes affichées : {when}.':
    'Oldest data shown: {when}.',
  'Le serveur répond de nouveau':
    'The server is responding again',
  'Les modifications sont de nouveau possibles ; les pages se mettent à jour.':
    'Changes are possible again; pages are being updated.',
  'Hors ligne : ce tableau n’a pas été ouvert sur cet appareil avant la coupure, il n’est pas disponible.':
    'Offline: this board was not opened on this device before the outage, so it is not available.',
  'Hors ligne : cette note n’a pas été ouverte sur cet appareil avant la coupure, elle n’est pas disponible.':
    'Offline: this note was not opened on this device before the outage, so it is not available.',
  'Cet écran n’a pas encore été ouvert sur cet appareil : il s’ouvrira au retour du serveur.':
    'This screen has not been opened on this device yet: it will open when the server is back.',
  // Journal des modifications.
  'Lecture seule hors ligne : si le serveur ne répond plus, l’application continue avec ce qu’elle a gardé sur l’appareil (projets, tickets, notes et tableaux déjà ouverts, leurs images). Un bandeau le signale, toute modification est bloquée, et tout reprend seul dès que le serveur répond.':
    'Offline read-only mode: if the server stops responding, the app carries on with what it kept on the device (projects, tickets, notes and boards already opened, and their images). A banner says so, every change is blocked, and everything resumes on its own as soon as the server responds.',
  'Les données gardées pour la lecture hors ligne appartiennent au compte connecté et s’effacent à la déconnexion ; l’administration, l’assistant IA et les jetons ne sont jamais gardés.':
    'Data kept for offline reading belongs to the signed-in account and is erased on sign-out; administration, the AI assistant and tokens are never kept.',
};
