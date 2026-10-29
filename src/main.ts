import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import Aura from '@primeuix/themes/aura';
import 'primeicons/primeicons.css';

import App from './App.vue';
import { onSessionChanged, onUnauthorized } from './api/http';
import { currentLocale, t } from './i18n';
import { primevueEn } from './i18n/primevueEn';
import { primevueFr } from './i18n/primevueFr';
import router from './router';
import { useAppStore } from './stores/app';
import { useAuthStore } from './stores/auth';
import { applyFonts, applyTheme, cachedFonts, cachedThemeId } from './theme/themeManager';
import { notify } from './utils/notify';
import './styles/global.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.config.globalProperties.$t = t;

app.use(PrimeVue, {
  theme: { preset: Aura, options: { darkModeSelector: '.app-dark', cssLayer: false } },
  locale: currentLocale() === 'en' ? primevueEn : primevueFr,
  // Fenêtres modales sous le panneau de l'assistant IA (1150), listes et infobulles au-dessus de tout.
  zIndex: { modal: 1100, overlay: 1200, menu: 1200, tooltip: 1300 },
});
app.use(ToastService);
app.use(ConfirmationService);
app.directive('tooltip', Tooltip);

// Thème mémorisé appliqué avant le premier rendu ; celui du compte le remplace après la connexion.
applyTheme(cachedThemeId());
applyFonts(cachedFonts(), false);

const auth = useAuthStore();
onUnauthorized(() => {
  if (auth.isAuthenticated) {
    auth.expire();
    const current = router.currentRoute.value;
    void router.replace({ name: 'login', query: { redirect: current.fullPath, expired: '1' } });
  }
});

let reloading = false;
onSessionChanged(() => {
  if (reloading) {
    return;
  }
  reloading = true;
  notify('warn', t('Compte modifié'), t('Vous vous êtes connecté avec un autre compte dans un autre onglet : la page va se recharger.'), 5000);
  window.setTimeout(() => window.location.reload(), 1500);
});

await Promise.all([auth.init(), useAppStore().load()]);
app.use(router);
app.mount('#app');
