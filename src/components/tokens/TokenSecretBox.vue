<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Message from 'primevue/message';
import { copyText } from '@/utils/clipboard';
import { notify } from '@/utils/notify';
import { apiBaseUrl } from '@/utils/tokens';

import { t } from '@/i18n';
const props = defineProps<{ secret: string; name: string; revealed?: boolean }>();
const emit = defineEmits<{ done: [] }>();

const example = computed(() => `curl -s ${apiBaseUrl()}/me \\\n  -H "Authorization: Bearer ${props.secret}"`);

async function copy(text: string, what: string): Promise<void> {
  const copied = await copyText(text);
  notify(copied ? 'success' : 'warn', copied ? t('{what} copié', { what }) : t('Copie impossible'), copied ? undefined : t('Sélectionnez le texte et copiez-le à la main.'));
}
</script>

<template>
  <section class="secret-box" aria-live="polite">
    <Message v-if="!revealed" severity="warn" :closable="false" class="warning">
      <strong>{{ $t('Copiez ce jeton maintenant.') }}</strong> {{ $t('Vous pourrez le réafficher plus tard avec votre mot de passe (« Voir la clé »). Ne le partagez qu\'avec le script ou l\'agent qui doit l\'utiliser.') }} </Message>
    <p class="muted small">{{ $t('Jeton « {name} »', { name }) }}</p>
    <div class="row-secret">
      <input class="secret" :value="secret" readonly :aria-label="$t('Jeton d\'API')" @focus="($event.target as HTMLInputElement).select()" />
      <Button icon="pi pi-copy" :label="$t('Copier')" @click="copy(secret, 'Jeton')" />
    </div>

    <details class="how">
      <summary>{{ $t('Comment l\'utiliser') }}</summary>
      <pre class="code">{{ example }}</pre>
      <div class="actions">
        <Button :label="$t('Copier l\'exemple')" icon="pi pi-copy" size="small" severity="secondary" outlined @click="copy(example, 'Exemple')" />
        <a href="/api/docs" target="_blank" rel="noopener" class="link"><i class="pi pi-external-link"></i> {{ $t('Documentation Swagger') }}</a>
        <a href="/api/docs/guide.md" target="_blank" rel="noopener" class="link"><i class="pi pi-book"></i> {{ $t('Guide pour les IA') }}</a>
      </div>
    </details>

    <Button :label="$t('J\'ai copié mon jeton')" icon="pi pi-check" severity="secondary" @click="emit('done')" />
  </section>
</template>

<style scoped>
.secret-box {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 2px solid var(--fb-accent);
  border-radius: var(--fb-radius);
  background: var(--fb-accent-soft);
}
.warning :deep(.p-message-content) {
  padding: 0.5rem 0.75rem;
}
.row-secret {
  display: flex;
  gap: 0.5rem;
}
.secret {
  flex: 1;
  min-width: 0;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel);
  color: var(--fb-text);
  font: 0.85rem ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
.how summary {
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
}
.code {
  margin: 0.6rem 0;
  padding: 0.75rem;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--fb-panel);
  border: 1px solid var(--fb-border);
  font: 0.78rem ui-monospace, 'Cascadia Mono', Consolas, monospace;
  white-space: pre;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.25rem;
}
.link {
  font-size: 0.85rem;
  font-weight: 600;
}
</style>
