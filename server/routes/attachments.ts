import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import express, { type Router } from 'express';
import { isInlineImage } from '../../shared/attachments.ts';
import { FILE_NAME_HEADER } from '../../shared/constants.ts';
import type { AppContext } from '../context.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { actorOf, csrfGuard, currentUser, requireAuth } from '../http/middleware.ts';
import { uploadQuerySchema } from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireProject } from '../services/access.ts';
import { attachmentFile, contentDisposition, deleteAttachment, listAttachments, requireAttachment, storeAttachment } from '../services/attachments.ts';
import { requireTicket } from '../services/tickets.ts';

/**
 * Envoi d'un fichier : le corps de la requête EST le fichier (octets bruts). Cette route est montée avant l'analyse JSON
 * pour que n'importe quel type de contenu (y compris `application/json`) soit accepté tel quel.
 */
export function attachmentUploadRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.post('/tickets/:id/attachments', csrfGuard(ctx), requireAuth(ctx), async (req, res) => {
    const ticketId = idParam(req.params.id);
    const ticket = requireTicket(ctx.db, ticketId);
    requireProject(ctx, currentUser(res), ticket.project_id, 'attachment.create');

    const contentType = req.get('content-type');
    if (contentType?.toLowerCase().startsWith('multipart/')) {
      throw new HttpError(
        415,
        "Envoyez le fichier en corps brut (curl --data-binary @fichier), pas en multipart/form-data.",
        'unsupported_media_type',
      );
    }
    const query = parse(uploadQuerySchema, req.query);
    const header = req.get(FILE_NAME_HEADER);
    let name = query.name ?? 'fichier';
    if (header) {
      try {
        name = decodeURIComponent(header);
      } catch {
        name = header;
      }
    }
    const length = Number(req.get('content-length'));
    const attachment = await storeAttachment(ctx, actorOf(req, res), ticket, {
      stream: req,
      name,
      declaredMime: contentType,
      contentLength: Number.isFinite(length) && req.get('content-length') ? length : null,
    });
    res.status(201).json({ attachment });
  });

  return router;
}

/** Liste, téléchargement et suppression des pièces jointes (authentification déjà exigée). */
export function attachmentsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get('/tickets/:id/attachments', (req, res) => {
    const ticket = requireTicket(ctx.db, idParam(req.params.id));
    requireProject(ctx, currentUser(res), ticket.project_id);
    res.json({ attachments: listAttachments(ctx.db, ticket.id) });
  });

  router.get('/attachments/:id/download', async (req, res) => {
    const row = requireAttachment(ctx.db, idParam(req.params.id));
    const ticket = requireTicket(ctx.db, row.ticket_id);
    requireProject(ctx, currentUser(res), ticket.project_id);

    const file = attachmentFile(ctx, row);
    if (!fs.existsSync(file)) {
      throw notFound('Le fichier est introuvable sur le serveur.');
    }
    // Seules les images raster vérifiées s'affichent dans la page ; tout le reste est téléchargé, isolé du site.
    const inline = req.query.inline === '1' && isInlineImage(row.mime);
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Length', String(row.size));
    res.setHeader('Content-Disposition', contentDisposition(row.name, inline));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    try {
      await pipeline(fs.createReadStream(file), res);
    } catch {
      // Le client a interrompu le téléchargement : rien à faire.
    }
  });

  router.delete('/attachments/:id', (req, res) => {
    const row = requireAttachment(ctx.db, idParam(req.params.id));
    const ticket = requireTicket(ctx.db, row.ticket_id);
    const access = requireProject(ctx, currentUser(res), ticket.project_id);
    if (access.project.archived === 1) {
      throw new HttpError(409, 'Ce projet est archivé : il est en lecture seule.', 'conflict');
    }
    deleteAttachment(ctx, actorOf(req, res), ticket, row, access.permissions.has('attachment.moderate'));
    res.json({ ok: true });
  });

  return router;
}
