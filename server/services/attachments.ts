import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { isInlineImage, sanitizeFileName, sniffImageMime } from '../../shared/attachments.ts';
import { LIMITS } from '../../shared/constants.ts';
import type { ProjectEvent } from '../../shared/realtime.ts';
import type { AttachmentDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, forbidden, HttpError, notFound } from '../http/errors.ts';
import { logActivity } from './activity.ts';
import { addHistory } from './history.ts';
import { toAttachmentDTO, type AttachmentRow, type TicketRow } from './rows.ts';
import { ticketKeyOf } from './tickets.ts';

export function listAttachments(db: Db, ticketId: number): AttachmentDTO[] {
  return db.all<AttachmentRow>('SELECT * FROM ticket_attachments WHERE ticket_id = ? ORDER BY id', ticketId).map(toAttachmentDTO);
}

export function requireAttachment(db: Db, attachmentId: number): AttachmentRow {
  const row = db.get<AttachmentRow>('SELECT * FROM ticket_attachments WHERE id = ?', attachmentId);
  if (!row) {
    throw notFound('Pièce jointe introuvable.');
  }
  return row;
}

function countAttachments(db: Db, ticketId: number): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_id = ?', ticketId)?.n ?? 0;
}

export function attachmentFile(ctx: AppContext, row: Pick<AttachmentRow, 'storage'>): string {
  return path.join(ctx.uploadsDir, row.storage);
}

/** Supprime des fichiers du disque (sans échouer si l'un a déjà disparu). */
export function removeStoredFiles(ctx: AppContext, storages: string[]): void {
  for (const storage of storages) {
    try {
      fs.rmSync(path.join(ctx.uploadsDir, storage), { force: true });
    } catch (error) {
      ctx.logger.warn('storage', `Suppression impossible du fichier ${storage}`, { error: String(error) });
    }
  }
}

/** Noms de fichiers des pièces jointes d'un ticket / d'un projet, à relever AVANT la suppression en cascade des lignes. */
export function storagesOfTicket(db: Db, ticketId: number): string[] {
  return db.all<{ storage: string }>('SELECT storage FROM ticket_attachments WHERE ticket_id = ?', ticketId).map((row) => row.storage);
}

export function storagesOfProject(db: Db, projectId: number): string[] {
  return db
    .all<{ storage: string }>(
      'SELECT a.storage FROM ticket_attachments a JOIN tickets t ON t.id = a.ticket_id WHERE t.project_id = ?',
      projectId,
    )
    .map((row) => row.storage);
}

/** Interrompt le flux (413) dès que la taille autorisée est dépassée. */
function sizeGuard(max: number, counter: { bytes: number }): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      counter.bytes += chunk.length;
      if (counter.bytes > max) {
        callback(tooLarge(max));
        return;
      }
      callback(null, chunk);
    },
  });
}

function tooLarge(max: number): HttpError {
  const mb = Math.round((max / (1024 * 1024)) * 10) / 10;
  return new HttpError(413, `Ce fichier dépasse la taille maximale autorisée (${mb} Mo).`, 'too_large');
}

function readHead(file: string): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const read = fs.readSync(fd, buffer, 0, 16, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/** Type retenu : les images sont reconnues d'après leur contenu, tout le reste est servi en téléchargement. */
function resolveMime(declared: string | undefined, head: Buffer): string {
  const sniffed = sniffImageMime(head);
  if (sniffed) {
    return sniffed;
  }
  const base = (declared ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(base) || isInlineImage(base)) {
    return 'application/octet-stream';
  }
  return base;
}

export interface UploadInput {
  stream: Readable;
  name: string;
  declaredMime: string | undefined;
  contentLength: number | null;
}

/** Enregistre un fichier envoyé en corps brut, le rattache au ticket et diffuse l'évènement. */
export async function storeAttachment(ctx: AppContext, actor: Actor, ticket: TicketRow, input: UploadInput): Promise<AttachmentDTO> {
  const { db } = ctx;
  const max = ctx.config.maxUploadBytes;
  if (input.contentLength !== null && input.contentLength > max) {
    throw tooLarge(max);
  }
  if (countAttachments(db, ticket.id) >= LIMITS.attachmentsPerTicket) {
    throw badRequest(`Un ticket ne peut pas avoir plus de ${LIMITS.attachmentsPerTicket} pièces jointes.`);
  }

  const storage = randomUUID();
  const partial = path.join(ctx.uploadsDir, `${storage}.part`);
  const final = path.join(ctx.uploadsDir, storage);
  const counter = { bytes: 0 };
  try {
    await pipeline(input.stream, sizeGuard(max, counter), fs.createWriteStream(partial, { flags: 'wx' }));
    if (counter.bytes === 0) {
      throw badRequest('Le fichier est vide.');
    }
    fs.renameSync(partial, final);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    fs.rmSync(final, { force: true });
    if (error instanceof HttpError) {
      throw error;
    }
    // Connexion coupée par le client pendant l'envoi : rien à enregistrer.
    throw badRequest("L'envoi du fichier a été interrompu.");
  }

  const name = sanitizeFileName(input.name, LIMITS.attachmentNameMax);
  const mime = resolveMime(input.declaredMime, readHead(final));
  let row: AttachmentRow;
  try {
    const historyEntry = db.transaction(() => {
      const { lastInsertRowid } = db.run(
        'INSERT INTO ticket_attachments (ticket_id, user_id, name, mime, size, storage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ticket.id,
        actor.userId,
        name,
        mime,
        counter.bytes,
        storage,
        nowIso(),
      );
      row = requireAttachment(db, lastInsertRowid);
      return addHistory(db, ticket.id, actor, { kind: 'attachment', action: 'added', name, size: counter.bytes });
    });
    publish(ctx, actor, ticket, [{ type: 'attachment.created', attachment: toAttachmentDTO(row!), attachmentCount: countAttachments(db, ticket.id) }], historyEntry);
  } catch (error) {
    fs.rmSync(final, { force: true });
    throw error;
  }
  ctx.logger.info('storage', `Pièce jointe ajoutée : ${name} (${counter.bytes} octets)`, { ticketId: ticket.id, mime }, actor.userId);
  return toAttachmentDTO(row!);
}

function publish(ctx: AppContext, actor: Actor, ticket: TicketRow, events: ProjectEvent[], history: ReturnType<typeof addHistory>): void {
  ctx.hub.publish(ticket.project_id, [...events, { type: 'history.created', entry: history }], actor);
  logActivity(ctx, actor, ticket.project_id, {
    kind: 'ticket',
    ticketId: ticket.id,
    ticketKey: ticketKeyOf(ctx.db, ticket),
    ticketTitle: ticket.title,
    entry: history.data,
  });
}

/** L'auteur de l'envoi peut supprimer sa pièce jointe ; les autres ont besoin de `attachment.moderate`. */
export function deleteAttachment(ctx: AppContext, actor: Actor, ticket: TicketRow, row: AttachmentRow, canModerate: boolean): void {
  if (row.user_id !== actor.userId && !canModerate) {
    throw forbidden('Vous ne pouvez supprimer que vos propres pièces jointes.');
  }
  const { db } = ctx;
  const historyEntry = db.transaction(() => {
    db.run('DELETE FROM ticket_attachments WHERE id = ?', row.id);
    return addHistory(db, ticket.id, actor, { kind: 'attachment', action: 'removed', name: row.name, size: row.size });
  });
  removeStoredFiles(ctx, [row.storage]);
  publish(ctx, actor, ticket, [{ type: 'attachment.deleted', attachment: toAttachmentDTO(row), attachmentCount: countAttachments(db, ticket.id) }], historyEntry);
  ctx.logger.info('storage', `Pièce jointe supprimée : ${row.name}`, { ticketId: ticket.id }, actor.userId);
}

/** En-tête `Content-Disposition` avec repli ASCII et nom UTF-8 (RFC 6266 / 5987). */
export function contentDisposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
