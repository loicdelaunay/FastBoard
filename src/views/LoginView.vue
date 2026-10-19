<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import LanguageSwitch from '@/components/common/LanguageSwitch.vue';
import { errorMessage } from '@/api/http';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

async function submit(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(email.value.trim(), password.value);
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <form class="login-card card" @submit.prevent="submit">
      <div class="logo">
        <img src="/favicon.svg" alt="" width="44" height="44" />
        <div>
          <h1>{{ $t('FastBoard') }}</h1>
          <p class="muted small">{{ $t('Suivi de projet collaboratif en temps réel') }}</p>
        </div>
      </div>

      <Message v-if="route.query.expired" severity="warn" :closable="false">{{ $t('Votre session a expiré, veuillez vous reconnecter.') }}</Message>
      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <div class="field">
        <label for="email">{{ $t('Adresse e-mail') }}</label>
        <InputText id="email" v-model="email" type="email" autocomplete="username" autofocus required :placeholder="$t('vous@exemple.fr')" />
      </div>
      <div class="field">
        <label for="password">{{ $t('Mot de passe') }}</label>
        <Password id="password" v-model="password" :feedback="false" toggle-mask autocomplete="current-password" required fluid />
      </div>

      <Button type="submit" :label="$t('Se connecter')" icon="pi pi-sign-in" :loading="loading" fluid />
      <p class="muted small hint">{{ $t('Les comptes sont créés par un administrateur.') }}</p>
      <div class="lang-row"><LanguageSwitch compact /></div>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 1.5rem 1rem;
  background:
    radial-gradient(60rem 30rem at 15% -10%, var(--fb-accent-soft), transparent 60%),
    radial-gradient(50rem 28rem at 100% 110%, var(--fb-accent-soft), transparent 60%),
    var(--fb-bg);
}
.login-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: min(26rem, 100%);
  padding: 1.75rem;
  box-shadow: var(--fb-shadow-lg);
}
.logo {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 0.5rem;
}
.logo h1 {
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}
.hint {
  text-align: center;
}
.lang-row {
  display: flex;
  justify-content: center;
}
</style>
