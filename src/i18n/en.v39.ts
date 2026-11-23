/** Textes ajoutés en 2.16.1 : message de mise à jour qui ne boucle plus. */
export const enV39: Record<string, string> = {
  'Mise à jour incomplète sur le serveur': 'Incomplete update on the server',
  'Le serveur est en version {server}, mais l’interface qu’il sert est restée en {client} : recharger la page n’y change rien. Sur le serveur, reconstruisez l’interface (npm run build) puis redémarrez-le.':
    'The server runs version {server}, but the interface it serves is still {client}: reloading the page changes nothing. On the server, rebuild the interface (npm run build), then restart it.',
  'La page reste en cache': 'The page is still cached',
  'Le serveur sert bien la version {server}, mais votre navigateur reçoit encore la {client}. Forcez le rechargement (Ctrl Maj R) ou videz le cache du navigateur ; derrière un proxy, videz aussi le sien.':
    'The server does serve version {server}, but your browser still receives {client}. Force a reload (Ctrl Shift R) or clear the browser cache; behind a proxy, clear its cache too.',
  'Le serveur n’a pas redémarré': 'The server has not restarted',
  'L’interface est en version {client}, mais le serveur est resté en {server} : redémarrez-le pour terminer la mise à jour.':
    'The interface is version {client}, but the server is still {server}: restart it to finish the update.',
  'Vérifier à nouveau': 'Check again',
  'Le message « Mise à jour disponible » ne revient plus en boucle : quand recharger la page ne peut rien changer, il explique quoi faire (reconstruire l’interface sur le serveur, redémarrer le serveur ou vider le cache) au lieu de reproposer la mise à jour. L’exécutable refuse aussi d’embarquer une interface d’une autre version.':
    'The “Update available” message no longer comes back in a loop: when reloading the page cannot change anything, it explains what to do (rebuild the interface on the server, restart the server or clear the cache) instead of offering the update again. The executable also refuses to embed an interface from another version.',
};
