import express, { type Response, type Router } from 'express';
import { isInlineImage, sniffImageMime } from '../../shared/attachments.ts';
import { FILE_NAME_HEADER } from '../../shared/constants.ts';
import { docBaseName, DOC_LIMITS, docRoleAtLeast, type DocRole } from '../../shared/docs.ts';
import type { AppContext } from '../context.ts';
import { commentNode, createComment, deleteComment, listComments, resolveComment } from '../docs/comments.ts';
import { noteLinks } from '../docs/links.ts';
import { applyImport, exportFile, exportSpace, previewFileImport, previewImport } from '../docs/transfer.ts';
import {
  createNode,
  createSpace,
  deleteNode,
  deleteSpace,
  docsEnabled,
  findNodeByPath,
  getSpace,
  listMembers,
  listNodes,
  listSpaces,
  listTrash,
  listVersions,
  moveNode,
  readBytes,
  readText,
  removeMember,
  requireDocsEnabled,
  requireNode,
  requireSpace,
  requireVersion,
  restoreNode,
  searchNodes,
  setDocsEnabled,
  setMember,
  storeImage,
  updateSpace,
  writeContent,
  type NodeRow,
} from '../docs/store.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import { actorOf, csrfGuard, currentUser, requireAuth, sessionOnly } from '../http/middleware.ts';
import { docCommentResolveSchema, docCommentSchema, docContentSchema, docImportApplySchema, docMemberRoleSchema, docMemberSchema, docMoveSchema, docNodeSchema, docSearchSchema, docSettingsSchema, docSpaceSchema, docSpaceUpdateSchema } from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireGlobal } from '../services/access.ts';
import { appInfo } from '../services/appSettings.ts';
import { contentDisposition } from '../services/attachments.ts';

function decodedName(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Envois de fichiers : le corps EST le fichier, ces routes passent donc avant l'analyse JSON. */
export function documentationUploadRouter(ctx: AppContext): Router {
  const router = express.Router();
  const raw = (limit: number) => express.raw({ type: () => true, limit });

  router.post('/documentation/spaces/:id/images', csrfGuard(ctx), requireAuth(ctx), raw(DOC_LIMITS.imageBytes), (req, res) => {
    const spaceId = idParam(req.params.id);
    requireSpace(ctx, currentUser(res), spaceId, 'editor');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Image vide.');
    const mime = sniffImageMime(body.subarray(0, 16));
    if (!mime || !isInlineImage(mime)) throw badRequest('Image invalide (PNG, JPEG, WebP ou GIF).');
    const folder = typeof req.query.folder === 'string' ? req.query.folder : '';
    res.status(201).json({ node: storeImage(ctx, actorOf(req, res), spaceId, folder, decodedName(req.get(FILE_NAME_HEADER)) || 'image.png', body) });
  });

  router.post('/documentation/spaces/:id/import', csrfGuard(ctx), requireAuth(ctx), raw(DOC_LIMITS.zipBytes), (req, res) => {
    const spaceId = idParam(req.params.id);
    const user = currentUser(res);
    requireSpace(ctx, user, spaceId, 'editor');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Archive vide.');
    const folder = typeof req.query.folder === 'string' ? req.query.folder : '';
    if (folder && findNodeByPath(ctx.db, spaceId, folder)?.kind !== 'folder') throw notFound('Dossier introuvable.');
    res.json(previewImport(ctx, user.id, spaceId, body, folder));
  });

  router.post('/documentation/nodes/:id/import', csrfGuard(ctx), requireAuth(ctx), raw(DOC_LIMITS.imageBytes), (req, res) => {
    const node = requireNode(ctx.db, idParam(req.params.id));
    const user = currentUser(res);
    requireSpace(ctx, user, node.space_id, 'editor');
    if (node.deleted_at || node.kind === 'folder') throw badRequest('Choisissez une note ou une image.');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Fichier vide.');
    res.json(previewFileImport(ctx, user.id, node, body));
  });

  return router;
}

/** Documentation : espaces, arbre de fichiers, historique, export et import. */
export function documentationRouter(ctx: AppContext): Router {
  const router = express.Router();

  const nodeAccess = (res: Response, nodeId: number, minimum: DocRole = 'reader'): { node: NodeRow; role: DocRole } => {
    const node = requireNode(ctx.db, nodeId);
    return { node, role: requireSpace(ctx, currentUser(res), node.space_id, minimum) };
  };
  const sendZip = (res: Response, name: string, zip: Buffer): void => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition(`${name}.zip`, false));
    res.send(zip);
  };
  const activeNote = (res: Response, nodeId: number, minimum: DocRole = 'reader'): NodeRow => {
    const { node } = nodeAccess(res, nodeId, minimum);
    if (node.deleted_at) throw conflict('Ce fichier est dans la corbeille.');
    if (node.kind !== 'markdown') throw badRequest('Ce fichier n’est pas une note Markdown.');
    return node;
  };

  // --- Administration ------------------------------------------------------------------------------------------------

  router.get('/admin/documentation', sessionOnly(), (_req, res) => {
    requireGlobal(currentUser(res), 'docs.manage');
    const stats = ctx.db.get<{ spaces: number; files: number; bytes: number | null }>(
      "SELECT (SELECT COUNT(*) FROM doc_spaces) AS spaces, COUNT(*) AS files, SUM(size) AS bytes FROM doc_nodes WHERE kind != 'folder' AND deleted_at IS NULL",
    );
    res.json({ enabled: docsEnabled(ctx.db), spaces: stats?.spaces ?? 0, files: stats?.files ?? 0, bytes: stats?.bytes ?? 0, retentionDays: DOC_LIMITS.retentionDays });
  });

  router.put('/admin/documentation', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'docs.manage');
    const { enabled } = parse(docSettingsSchema, req.body);
    setDocsEnabled(ctx.db, enabled);
    if (!enabled) ctx.docRooms.closeAllSpaces();
    ctx.logger.info('admin', `Documentation ${enabled ? 'activée' : 'désactivée'}`, undefined, user.id, res.locals.requestId as string);
    const app = appInfo(ctx.db);
    ctx.hub.broadcast({ t: 'app', app });
    res.json({ enabled, app });
  });

  // --- Espaces -------------------------------------------------------------------------------------------------------

  router.get('/documentation/spaces', (_req, res) => {
    requireDocsEnabled(ctx.db);
    res.json({ spaces: listSpaces(ctx, currentUser(res)) });
  });

  router.post('/documentation/spaces', (req, res) => {
    requireDocsEnabled(ctx.db);
    const user = currentUser(res);
    requireGlobal(user, 'docs.create');
    res.status(201).json({ space: createSpace(ctx, user, parse(docSpaceSchema, req.body)) });
  });

  router.get('/documentation/spaces/:id', (req, res) => {
    const spaceId = idParam(req.params.id);
    const user = currentUser(res);
    requireSpace(ctx, user, spaceId);
    res.json({ space: getSpace(ctx, user, spaceId), nodes: listNodes(ctx.db, spaceId), members: listMembers(ctx.db, spaceId) });
  });

  router.patch('/documentation/spaces/:id', (req, res) => {
    const spaceId = idParam(req.params.id);
    const user = currentUser(res);
    requireSpace(ctx, user, spaceId, 'owner');
    res.json({ space: updateSpace(ctx, user, spaceId, parse(docSpaceUpdateSchema, req.body)) });
  });

  router.delete('/documentation/spaces/:id', (req, res) => {
    const spaceId = idParam(req.params.id);
    const user = currentUser(res);
    requireSpace(ctx, user, spaceId, 'owner');
    deleteSpace(ctx, user, spaceId);
    res.json({ ok: true });
  });

  router.post('/documentation/spaces/:id/members', (req, res) => {
    const spaceId = idParam(req.params.id);
    requireSpace(ctx, currentUser(res), spaceId, 'owner');
    const { userId, role } = parse(docMemberSchema, req.body);
    res.status(201).json({ members: setMember(ctx, spaceId, userId, role) });
  });

  router.patch('/documentation/spaces/:id/members/:userId', (req, res) => {
    const spaceId = idParam(req.params.id);
    requireSpace(ctx, currentUser(res), spaceId, 'owner');
    res.json({ members: setMember(ctx, spaceId, idParam(req.params.userId), parse(docMemberRoleSchema, req.body).role) });
  });

  router.delete('/documentation/spaces/:id/members/:userId', (req, res) => {
    const spaceId = idParam(req.params.id);
    requireSpace(ctx, currentUser(res), spaceId, 'owner');
    res.json({ members: removeMember(ctx, spaceId, idParam(req.params.userId)) });
  });

  router.get('/documentation/spaces/:id/trash', (req, res) => {
    const spaceId = idParam(req.params.id);
    requireSpace(ctx, currentUser(res), spaceId);
    res.json({ nodes: listTrash(ctx.db, spaceId) });
  });

  router.get('/documentation/spaces/:id/export', (req, res) => {
    const spaceId = idParam(req.params.id);
    const user = currentUser(res);
    const role = requireSpace(ctx, user, spaceId);
    sendZip(res, getSpace(ctx, user, spaceId).name, exportSpace(ctx, user.id, spaceId, { remember: docRoleAtLeast(role, 'editor') }));
  });

  router.post('/documentation/spaces/:id/import/:importId/apply', (req, res) => {
    const spaceId = idParam(req.params.id);
    requireSpace(ctx, currentUser(res), spaceId, 'editor');
    res.json(applyImport(ctx, actorOf(req, res), spaceId, String(req.params.importId), parse(docImportApplySchema, req.body).decisions));
  });

  // --- Fichiers et dossiers ------------------------------------------------------------------------------------------

  router.post('/documentation/spaces/:id/nodes', (req, res) => {
    const spaceId = idParam(req.params.id);
    requireSpace(ctx, currentUser(res), spaceId, 'editor');
    res.status(201).json({ node: createNode(ctx, actorOf(req, res), spaceId, parse(docNodeSchema, req.body)) });
  });

  router.get('/documentation/nodes/:id', (req, res) => {
    const { node, role } = nodeAccess(res, idParam(req.params.id));
    res.json({ node: { id: node.id, spaceId: node.space_id, path: node.path, kind: node.kind, size: node.size, updatedAt: node.updated_at, updatedBy: node.updated_by, deletedAt: node.deleted_at }, role, content: node.kind === 'markdown' && !node.deleted_at ? (ctx.docRooms.currentText(node.id) ?? readText(ctx, node)) : null });
  });

  router.put('/documentation/nodes/:id/content', (req, res) => {
    const node = activeNote(res, idParam(req.params.id), 'editor');
    writeContent(ctx, actorOf(req, res), node, parse(docContentSchema, req.body).content, 'api');
    res.json({ ok: true });
  });

  router.get('/documentation/nodes/:id/raw', (req, res) => {
    const { node } = nodeAccess(res, idParam(req.params.id));
    if (node.kind !== 'image' || node.deleted_at) throw notFound('Image introuvable.');
    const data = readBytes(ctx, node);
    const mime = data ? sniffImageMime(data.subarray(0, 16)) : null;
    if (!data || !mime) throw notFound('Image introuvable.');
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(data);
  });

  router.get('/documentation/nodes/:id/export', (req, res) => {
    const { node, role } = nodeAccess(res, idParam(req.params.id));
    if (node.deleted_at) throw conflict('Ce fichier est dans la corbeille.');
    const user = currentUser(res);
    const remember = docRoleAtLeast(role, 'editor');
    if (node.kind === 'folder') {
      sendZip(res, docBaseName(node.path), exportSpace(ctx, user.id, node.space_id, { folder: node.path, remember }));
      return;
    }
    const data = exportFile(ctx, user.id, node, remember);
    if (!data) throw notFound('Fichier introuvable.');
    res.setHeader('Content-Type', node.kind === 'markdown' ? 'text/markdown; charset=utf-8' : (sniffImageMime(data.subarray(0, 16)) ?? 'application/octet-stream'));
    res.setHeader('Content-Disposition', contentDisposition(docBaseName(node.path), false));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  });

  router.get('/documentation/nodes/:id/links', (req, res) => {
    const { node } = nodeAccess(res, idParam(req.params.id));
    res.json(noteLinks(ctx, currentUser(res), node));
  });

  router.patch('/documentation/nodes/:id', (req, res) => {
    const { node } = nodeAccess(res, idParam(req.params.id), 'editor');
    res.json({ node: moveNode(ctx, actorOf(req, res), node.id, parse(docMoveSchema, req.body).path) });
  });

  router.delete('/documentation/nodes/:id', (req, res) => {
    const { node } = nodeAccess(res, idParam(req.params.id), 'editor');
    deleteNode(ctx, actorOf(req, res), node.id);
    res.json({ ok: true });
  });

  router.post('/documentation/nodes/:id/restore', (req, res) => {
    const { node } = nodeAccess(res, idParam(req.params.id), 'editor');
    res.json({ node: restoreNode(ctx, actorOf(req, res), node.id) });
  });

  // --- Commentaires --------------------------------------------------------------------------------------------------

  router.get('/documentation/nodes/:id/comments', (req, res) => {
    const { node } = nodeAccess(res, idParam(req.params.id));
    res.json({ comments: listComments(ctx.db, node.id) });
  });

  router.post('/documentation/nodes/:id/comments', (req, res) => {
    const node = activeNote(res, idParam(req.params.id));
    res.status(201).json({ comment: createComment(ctx, actorOf(req, res), node, parse(docCommentSchema, req.body)) });
  });

  router.patch('/documentation/comments/:id', (req, res) => {
    const commentId = idParam(req.params.id);
    nodeAccess(res, commentNode(ctx.db, commentId).id);
    res.json({ comment: resolveComment(ctx, actorOf(req, res), commentId, parse(docCommentResolveSchema, req.body).resolved) });
  });

  router.delete('/documentation/comments/:id', (req, res) => {
    const commentId = idParam(req.params.id);
    const { role } = nodeAccess(res, commentNode(ctx.db, commentId).id);
    deleteComment(ctx, actorOf(req, res), commentId, role);
    res.json({ ok: true });
  });

  // --- Historique ----------------------------------------------------------------------------------------------------

  router.get('/documentation/nodes/:id/versions', (req, res) => {
    const { node } = nodeAccess(res, idParam(req.params.id));
    res.json({ versions: listVersions(ctx.db, node.id), retentionDays: DOC_LIMITS.retentionDays });
  });

  router.get('/documentation/versions/:id', (req, res) => {
    const version = requireVersion(ctx.db, idParam(req.params.id));
    nodeAccess(res, version.node_id);
    res.json({ content: version.content, createdAt: version.created_at });
  });

  router.post('/documentation/versions/:id/restore', (req, res) => {
    const version = requireVersion(ctx.db, idParam(req.params.id));
    const node = activeNote(res, version.node_id, 'editor');
    writeContent(ctx, actorOf(req, res), node, version.content, 'restore');
    res.json({ ok: true });
  });

  // --- Recherche -----------------------------------------------------------------------------------------------------

  router.get('/documentation/search', (req, res) => {
    requireDocsEnabled(ctx.db);
    res.json({ files: searchNodes(ctx, currentUser(res), parse(docSearchSchema, req.query).q) });
  });

  return router;
}
