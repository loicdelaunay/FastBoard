import express, { type Router } from 'express';
import { snapshotArchiveName, type SnapshotKind } from '../../shared/snapshots.ts';
import type { AppContext } from '../context.ts';
import { badRequest } from '../http/errors.ts';
import { actorOf, currentUser } from '../http/middleware.ts';
import { snapshotListSchema, snapshotRestoreSchema, snapshotSchema } from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';
import { contentDisposition } from '../services/attachments.ts';
import { createSnapshot, deleteSnapshot, listSnapshots, restoreSnapshot, snapshotArchive, snapshotContent, snapshotFile } from '../services/snapshots.ts';

/**
 * Étiquettes d'espace : l'état complet d'un espace de documentation, d'un espace de tableaux blancs ou d'un projet,
 * figé sous un nom. Lecture : membres de l'espace ; pose : éditeurs (« Configurer le projet ») ; retrait : propriétaires
 * de l'espace, ou qui l'a posée.
 */
export function snapshotsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get('/snapshots', (req, res) => {
    const query = parse(snapshotListSchema, req.query);
    res.json({ snapshots: listSnapshots(ctx, currentUser(res), query.kind as SnapshotKind, query.spaceId) });
  });

  router.post('/snapshots', (req, res) => {
    const input = parse(snapshotSchema, req.body);
    res.status(201).json({ snapshot: createSnapshot(ctx, actorOf(req, res), currentUser(res), input.kind as SnapshotKind, input.spaceId, input) });
  });

  router.get('/snapshots/:id', (req, res) => {
    res.json(snapshotContent(ctx, currentUser(res), idParam(req.params.id)));
  });

  router.delete('/snapshots/:id', (req, res) => {
    deleteSnapshot(ctx, actorOf(req, res), currentUser(res), idParam(req.params.id));
    res.json({ ok: true });
  });

  router.get('/snapshots/:id/files/:hash', (req, res) => {
    const file = snapshotFile(ctx, currentUser(res), idParam(req.params.id), String(req.params.hash));
    // Texte d'une note en JSON (`?as=json`) : l'interface le lit comme ses autres données, et le garde pour la lecture hors ligne.
    if (req.query.as === 'json') {
      if (!file.mime.startsWith('text/')) throw badRequest('Ce fichier n’est pas un texte.');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.json({ text: file.data.toString('utf8') });
      return;
    }
    const name = typeof req.query.name === 'string' ? req.query.name.slice(0, 200) : '';
    // Images montrées dans la page ; tout autre fichier (pièce jointe) se télécharge, sans jamais s'exécuter.
    const inline = file.mime.startsWith('image/') || file.mime.startsWith('text/markdown') || file.mime === 'application/json';
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (name || !inline) res.setHeader('Content-Disposition', contentDisposition(name || 'fichier', inline && !name));
    res.send(file.data);
  });

  router.get('/snapshots/:id/download', (req, res) => {
    const archive = snapshotArchive(ctx, currentUser(res), idParam(req.params.id));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition(snapshotArchiveName(archive.spaceName, archive.name), false));
    res.send(archive.data);
  });

  router.post('/snapshots/:id/restore', (req, res) => {
    const input = parse(snapshotRestoreSchema, req.body ?? {});
    res.status(201).json(restoreSnapshot(ctx, actorOf(req, res), currentUser(res), idParam(req.params.id), input.name));
  });

  return router;
}
