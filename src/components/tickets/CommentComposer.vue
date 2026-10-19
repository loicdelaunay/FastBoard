<script setup lang="ts">
import { ref } from 'vue';
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const props = withDefaults(
  defineProps<{ ticketId: number; parentId?: number | null; placeholder?: string; autofocus?: boolean }>(),
  { parentId: null, placeholder: t('Écrire un commentaire…'), autofocus: false },
);
const emit = defineEmits<{ sent: []; cancel: [] }>();

const auth = useAuthStore();
const project = useProjectStore();
const body = ref('');
const sending = ref(false);

async function send(): Promise<void> {
  const text = body.value.trim();
  if (!text || sending.value) {
    return;
  }
  sending.value = true;
  try {
    await project.addComment(props.ticketId, text, props.parentId);
    body.value = '';
    emit('sent');
  } catch (error) {
    notifyError(error, t('Message non envoyé'));
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <form class="composer" @submit.prevent="send">
    <UserAvatar :user="auth.user" />
    <div class="box">
      <Textarea
        v-model="body"
        :placeholder="placeholder"
        :autofocus="autofocus"
        rows="2"
        auto-resize
        maxlength="5000"
        fluid
        :aria-label="$t('Votre message')"
        @keydown.ctrl.enter.prevent="send"
        @keydown.meta.enter.prevent="send"
      />
      <div class="row">
        <Button type="submit" :label="$t('Envoyer')" icon="pi pi-send" size="small" :disabled="!body.trim()" :loading="sending" />
        <Button v-if="parentId !== null" type="button" :label="$t('Annuler')" size="small" severity="secondary" text @click="emit('cancel')" />
        <span class="muted small hint">{{ $t('Ctrl + Entrée pour envoyer') }}</span>
      </div>
    </div>
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  gap: 0.7rem;
}
.box {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
.hint {
  margin-left: auto;
}
@media (max-width: 600px) {
  .hint {
    display: none;
  }
}
</style>
