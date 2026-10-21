<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Image from 'primevue/image';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import { ApiError } from '@/api/http';
import { api } from '@/api';
import { copyText } from '@/utils/clipboard';
import AttachmentLinkDialog from './AttachmentLinkDialog.vue';
import { LIMITS } from '@shared/constants';
import type { AttachmentDTO, TicketDTO } from '@shared/types';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { attachmentUrl, fileIcon, formatBytes, isImageAttachment } from '@/utils/files';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const props = defineProps<{ ticket: TicketDTO; dragging?: boolean }>();

interface PendingUpload {
  key: number;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  started: boolean;
  /** Un nouvel essai n'a de sens que pour une erreur d'envoi (pas pour un fichier refusé d'avance). */
  retryable: boolean;
  file: File;
}

const MAX_PARALLEL = 3;
const MAX_MB = Math.round(LIMITS.attachmentMaxBytes / (1024 * 1024));

const auth = useAuthStore();
const project = useProjectStore();
const confirm = useConfirm();

const input = ref<HTMLInputElement | null>(null);
const uploads = ref<PendingUpload[]>([]);
const loadError = ref(false);
const linkKind = ref<'url' | 'path' | null>(null);
const addMenu = ref<InstanceType<typeof Menu> | null>(null);
const addItems: MenuItem[] = [
  { label: t('Lien web (URL)…'), icon: 'pi pi-globe', command: () => (linkKind.value = 'url') },
  { label: t('Lien vers un fichier ou un dossier…'), icon: 'pi pi-folder-open', command: () => (linkKind.value = 'path') },
];

/** Ouvre un chemin sur le poste (si FastBoard y tourne), sinon copie le chemin pour l'explorateur. */
async function openPath(attachment: AttachmentDTO): Promise<void> {
  try {
    const result = await api.openAttachment(attachment.id);
    if (result.revealed) notify('info', t('Fichier exécutable : son dossier a été ouvert.'));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_local' && attachment.url) {
      const copied = await copyText(attachment.url);
      notify(copied ? 'info' : 'warn', copied ? t('Chemin copié') : t('Copie impossible'), t('Collez-le dans l’explorateur de fichiers : {path}', { path: attachment.url }));
    } else {
      notifyError(error, t('Ouverture impossible'));
    }
  }
}

function linkIcon(attachment: AttachmentDTO): string {
  return attachment.kind === 'url' ? 'pi pi-globe' : 'pi pi-folder-open';
}
let nextKey = 1;
let running = 0;

const canAdd = computed(() => project.can('attachment.create') && !project.archived);
const items = computed<AttachmentDTO[]>(() => project.attachments[props.ticket.id] ?? []);
const loaded = computed(() => project.attachments[props.ticket.id] !== undefined);
const visible = computed(() => canAdd.value || items.value.length > 0 || uploads.value.length > 0 || props.ticket.attachmentCount > 0);

async function load(): Promise<void> {
  loadError.value = false;
  try {
    await project.loadAttachments(props.ticket.id);
  } catch (error) {
    loadError.value = true;
    notifyError(error, t('Pièces jointes indisponibles'));
  }
}
onMounted(load);
watch(() => props.ticket.id, () => {
  uploads.value = [];
  void load();
});

function canRemove(attachment: AttachmentDTO): boolean {
  return !project.archived && (attachment.userId === auth.user?.id || project.can('attachment.moderate'));
}

function author(attachment: AttachmentDTO) {
  return attachment.userId ? project.usersById.get(attachment.userId) : undefined;
}

/** Met en file les fichiers choisis, déposés ou collés ; les envois partent par groupes de trois. */
function addFiles(files: File[]): void {
  if (!canAdd.value) {
    return;
  }
  const room = LIMITS.attachmentsPerTicket - items.value.length - uploads.value.filter((upload) => upload.error === null).length;
  files.forEach((file, index) => {
    const entry: PendingUpload = { key: nextKey++, name: file.name, size: file.size, progress: 0, error: null, started: false, retryable: false, file };
    if (file.size === 0) {
      entry.error = t('Le fichier est vide.');
    } else if (file.size > LIMITS.attachmentMaxBytes) {
      entry.error = t('Trop volumineux ({n} Mo maximum).', { n: MAX_MB });
    } else if (index >= room) {
      entry.error = t('Un ticket accepte {n} pièces jointes au plus.', { n: LIMITS.attachmentsPerTicket });
    }
    uploads.value.push(entry);
  });
  pump();
}

function pump(): void {
  for (const entry of uploads.value) {
    if (running >= MAX_PARALLEL) {
      return;
    }
    if (entry.error !== null || entry.started) {
      continue;
    }
    entry.started = true;
    running += 1;
    void send(entry);
  }
}

async function send(entry: PendingUpload): Promise<void> {
  try {
    await project.addAttachment(props.ticket.id, entry.file, (ratio) => {
      entry.progress = Math.round(ratio * 100);
    });
    uploads.value = uploads.value.filter((upload) => upload.key !== entry.key);
  } catch (error) {
    entry.error = error instanceof Error ? error.message : t("L'envoi a échoué.");
    entry.retryable = true;
  } finally {
    running -= 1;
    pump();
  }
}

function retry(entry: PendingUpload): void {
  entry.error = null;
  entry.progress = 0;
  entry.started = false;
  pump();
}

function dismiss(entry: PendingUpload): void {
  uploads.value = uploads.value.filter((upload) => upload.key !== entry.key);
}

function onPick(event: Event): void {
  const element = event.target as HTMLInputElement;
  addFiles(Array.from(element.files ?? []));
  element.value = '';
}

function askRemove(attachment: AttachmentDTO): void {
  confirm.require({
    header: t('Supprimer cette pièce jointe ?'),
    message: t('« {name} » sera définitivement supprimée.', { name: attachment.name }),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await project.removeAttachment(attachment);
      } catch (error) {
        notifyError(error, t('Suppression impossible'));
      }
    },
  });
}

defineExpose({ addFiles });
</script>

<template>
  <section v-if="visible" class="attachments" :class="{ dragging: dragging && canAdd }" aria-labelledby="attachments-title">
    <header class="head">
      <h3 id="attachments-title" class="title">{{ $t('Pièces jointes') }}<span v-if="items.length" class="count">{{ items.length }}</span></h3>
      <div v-if="canAdd" class="add-group">
        <Button :label="$t('Ajouter')" icon="pi pi-paperclip" size="small" text severity="secondary" @click="input?.click()" />
        <Button icon="pi pi-chevron-down" size="small" text severity="secondary" class="add-more" aria-haspopup="menu" :aria-label="$t('Ajouter un lien')" @click="addMenu?.toggle($event)" />
        <Menu ref="addMenu" :model="addItems" popup />
      </div>
      <input ref="input" class="file-input" type="file" multiple tabindex="-1" aria-hidden="true" @change="onPick" />
    </header>

    <div v-if="canAdd && !items.length && !uploads.length && loaded" class="empty" role="button" tabindex="0" @click="input?.click()" @keydown.enter.prevent="input?.click()" @keydown.space.prevent="input?.click()">
      <i class="pi pi-cloud-upload"></i>
      <span>{{ $t('Glissez des fichiers ici, collez une capture d\'écran ou') }} <u>{{ $t('parcourez') }}</u> {{ $t('({MAX_MB} Mo maximum par fichier)', { MAX_MB }) }}</span>
    </div>

    <ul v-if="uploads.length" class="uploads" aria-live="polite">
      <li v-for="entry in uploads" :key="entry.key" class="upload" :class="{ failed: entry.error }">
        <i class="pi" :class="entry.error ? 'pi-exclamation-circle' : 'pi-spin pi-spinner'"></i>
        <div class="upload-body">
          <span class="name truncate">{{ entry.name }}</span>
          <span v-if="entry.error" class="error small">{{ entry.error }}</span>
          <span v-else class="bar" role="progressbar" :aria-valuenow="entry.progress" aria-valuemin="0" aria-valuemax="100" :aria-label="$t('Envoi de {name}', { name: entry.name })"><span :style="{ width: `${entry.progress}%` }"></span></span>
        </div>
        <span v-if="!entry.error" class="muted small">{{ entry.progress }} %</span>
        <Button v-if="entry.error && entry.size > 0 && entry.retryable" icon="pi pi-refresh" text rounded size="small" severity="secondary" :aria-label="$t('Réessayer')" @click="retry(entry)" />
        <Button v-if="entry.error" icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="$t('Fermer')" @click="dismiss(entry)" />
      </li>
    </ul>

    <ul v-if="items.length" class="list">
      <li v-for="attachment in items" :key="attachment.id" class="item">
        <template v-if="attachment.kind !== 'file'">
          <div class="preview">
            <a v-if="attachment.kind === 'url'" class="icon" :href="attachment.url ?? '#'" target="_blank" rel="noopener noreferrer" :aria-label="$t('Ouvrir {name}', { name: attachment.name })"><i :class="linkIcon(attachment)"></i></a>
            <button v-else type="button" class="icon plain" :aria-label="$t('Ouvrir {name}', { name: attachment.name })" @click="openPath(attachment)"><i :class="linkIcon(attachment)"></i></button>
          </div>
          <div class="meta">
            <a v-if="attachment.kind === 'url'" class="name truncate" :href="attachment.url ?? '#'" target="_blank" rel="noopener noreferrer" :title="attachment.url ?? ''">{{ attachment.name }}</a>
            <button v-else type="button" class="name truncate plain link-name" :title="attachment.url ?? ''" @click="openPath(attachment)">{{ attachment.name }}</button>
            <span class="muted small info truncate" :title="attachment.url ?? ''">
              {{ attachment.kind === 'url' ? $t('Lien web') : $t('Fichier local') }} ·
              <UserAvatar v-if="author(attachment)" :user="author(attachment)" size="small" class="by" />
              <time :datetime="attachment.createdAt" :title="formatDateTime(attachment.createdAt)">{{ formatRelative(attachment.createdAt) }}</time>
            </span>
          </div>
        </template>
        <template v-else>
        <div class="preview">
          <Image v-if="isImageAttachment(attachment)" :src="attachmentUrl(attachment, true)" :alt="attachment.name" preview image-class="thumb" />
          <a v-else class="icon" :href="attachmentUrl(attachment)" :download="attachment.name" :aria-label="$t('Télécharger {name}', { name: attachment.name })"><i :class="fileIcon(attachment)"></i></a>
        </div>
        <div class="meta">
          <a class="name truncate" :href="attachmentUrl(attachment)" :download="attachment.name" :title="$t('Télécharger {name}', { name: attachment.name })">{{ attachment.name }}</a>
          <span class="muted small info">
            {{ formatBytes(attachment.size) }} ·
            <UserAvatar v-if="author(attachment)" :user="author(attachment)" size="small" class="by" />
            <time :datetime="attachment.createdAt" :title="formatDateTime(attachment.createdAt)">{{ formatRelative(attachment.createdAt) }}</time>
          </span>
        </div>
        </template>
        <Button v-if="canRemove(attachment)" icon="pi pi-trash" text rounded size="small" severity="danger" class="remove" :aria-label="$t('Supprimer {name}', { name: attachment.name })" @click="askRemove(attachment)" />
      </li>
    </ul>
    <p v-else-if="loadError" class="muted small">{{ $t('Impossible de charger les pièces jointes.') }} <a href="#" @click.prevent="load">{{ $t('Réessayer') }}</a></p>

    <AttachmentLinkDialog :ticket-id="ticket.id" :kind="linkKind" @close="linkKind = null" />
  </section>
</template>

<style scoped>
.attachments {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0.9rem;
  border: 1px dashed transparent;
  border-radius: var(--fb-radius);
  transition: border-color 0.15s, background 0.15s;
}
.attachments.dragging {
  border-color: var(--fb-accent);
  background: var(--fb-accent-soft);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
}
.count {
  margin-left: 0.4rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.72rem;
}
.file-input {
  display: none;
}
.add-group {
  display: flex;
  align-items: center;
}
.add-more {
  width: 2rem;
  margin-left: -0.35rem;
}
.plain {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.link-name:hover {
  color: var(--fb-accent);
  text-decoration: underline;
}
.empty {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border: 1px dashed var(--fb-border);
  border-radius: var(--fb-radius);
  color: var(--fb-muted);
  font-size: 0.88rem;
  cursor: pointer;
}
.empty:hover,
.empty:focus-visible {
  border-color: var(--fb-accent);
  color: var(--fb-text);
  outline: none;
}
.empty i {
  font-size: 1.4rem;
  color: var(--fb-accent);
}
.uploads,
.list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.list {
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
}
.upload,
.item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
}
.upload.failed {
  border-color: var(--fb-danger);
}
.upload-body,
.meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--fb-text);
}
a.name:hover {
  color: var(--fb-accent);
  text-decoration: underline;
}
.error {
  color: var(--fb-danger);
}
.bar {
  display: block;
  height: 5px;
  border-radius: 999px;
  background: var(--fb-border);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--fb-accent);
  transition: width 0.15s;
}
.preview {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
  overflow: hidden;
}
.preview :deep(.p-image),
.preview :deep(.thumb) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.icon {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--fb-accent);
  font-size: 1.3rem;
}
.info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.by {
  flex: none;
}
.remove {
  flex: none;
}
</style>
