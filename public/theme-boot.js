// Applique le mode clair/sombre mémorisé avant le premier rendu (évite un flash au chargement).
try {
  if (localStorage.getItem('fb.mode') === 'dark') document.documentElement.classList.add('app-dark');
} catch (e) {}
