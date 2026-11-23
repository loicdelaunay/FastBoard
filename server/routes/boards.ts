import express, { type Response, type Router } from 'express';
import { boardPreviewSvg } from '../../shared/boardPreview.ts';
import type { DocRole } from '../../shared/docs.ts';
import type { AppContext } from '../context.ts';
import {
  boardHistory,
  boardNodeDTO,
  boardVersion,
  boardsEnabled,
  createBoardNode,
  createBoardSpace,
  deleteBoardNode,
  deleteBoardSpace,
  duplicateBoard,
  forkBoardVersion,
  getBoardSpace,
  listBoardMembers,
  listBoardNodes,
  listBoardSpaces,
  listBoardTrash,
  moveBoardNode,
  patchBoardElements,
  readBoardElements,
  removeBoardMember,
  requireBoard,
  requireBoardNode,
  requireBoardSpace,
  requireBoardsEnabled,
  restoreBoardNode,
  restoreBoardVersion,
  searchBoards,
  setBoardMember,
  setBoardsEnabled,
  updateBoardSpace,
  writeBoardElements,
} from '../boards/store.ts';
import { addIcon, deleteAsset, deleteIcon, listAssets, listIcons, previewResources, requireAsset } from '../boards/assets.ts';
import { boardLinks } from '../boards/links.ts';
import { getBoardShare, removeBoardShare, saveBoardShare } from '../boards/shares.ts';
import { badRequest } from '../http/errors.ts';
import { actorOf, currentUser, sessionOnly } from '../http/middleware.ts';
import {
  boardElementsPatchSchema,
  boardElementsSchema,
  boardForkSchema,
  boardIconSchema,
  boardMemberRoleSchema,
  boardMemberSchema,
  boardMoveSchema,
  boardNodeSchema,
  boardSearchSchema,
  boardSettingsSchema,
  boardShareSchema,
  boardSpaceSchema,
  boardSpaceUpdateSchema,
} from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireGlobal } from '../services/access.ts';
import { appInfo } from '../services/appSettings.ts';

/** Tableaux blancs : espaces, membres, arbre de dossiers et de tableaux, éléments et aperçus. */
export function boardsRouter(ctx: AppContext): Router {
  const router = express.Router();

  const spaceAccess = (res: Response, spaceId: number, minimum: DocRole = 'reader') => requireBoardSpace(ctx, currentUser(res), spaceId, minimum);
  const nodeAccess = (res: Response, nodeId: number, minimum: DocRole = 'reader') => {
    const node = requireBoardNode(ctx.db, nodeId);
    const role = requireBoardSpace(ctx, currentUser(res), node.space_id, minimum);
    return { node, role };
  };

  // --- Images des espaces et icônes ------------------------------------------------------------------------------------

  router.get('/boards/spaces/:id/assets', (req, res) => {
    requireBoardsEnabled(ctx.db);
    const spaceId = idParam(req.params.id);
    spaceAccess(res, spaceId);
    res.json({ assets: listAssets(ctx.db, spaceId) });
  });

  router.delete('/boards/assets/:id', (req, res) => {
    const asset = requireAsset(ctx.db, idParam(req.params.id));
    spaceAccess(res, asset.spaceId, 'editor');
    deleteAsset(ctx, asset);
    res.json({ ok: true });
  });

  router.get('/boards/icons', (_req, res) => {
    requireBoardsEnabled(ctx.db);
    res.json({ icons: listIcons(ctx.db) });
  });

  router.post('/admin/board-icons', (req, res) => {
    requireGlobal(currentUser(res), 'boards.manage');
    const input = parse(boardIconSchema, req.body);
    res.status(201).json({ icon: addIcon(ctx, actorOf(req, res), input.name, input.svg) });
  });

  router.delete('/admin/board-icons/:id', (req, res) => {
    requireGlobal(currentUser(res), 'boards.manage');
    deleteIcon(ctx.db, idParam(req.params.id));
    res.json({ ok: true });
  });

  // --- Administration ------------------------------------------------------------------------------------------------

  router.get('/admin/boards', sessionOnly(), (_req, res) => {
    requireGlobal(currentUser(res), 'boards.manage');
    const stats = ctx.db.get<{ spaces: number; boards: number }>("SELECT (SELECT COUNT(*) FROM board_spaces) AS spaces, COUNT(*) AS boards FROM board_nodes WHERE kind = 'board' AND deleted_at IS NULL");
    res.json({ enabled: boardsEnabled(ctx.db), spaces: stats?.spaces ?? 0, boards: stats?.boards ?? 0 });
  });

  router.put('/admin/boards', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'boards.manage');
    const { enabled } = parse(boardSettingsSchema, req.body);
    setBoardsEnabled(ctx.db, enabled);
    if (!enabled) ctx.boardRooms.closeAllSpaces();
    ctx.logger.info('admin', `Tableaux blancs ${enabled ? 'activés' : 'désactivés'}`, undefined, user.id, res.locals.requestId as string);
    const app = appInfo(ctx.db);
    ctx.hub.broadcast({ t: 'app', app });
    res.json({ enabled, app });
  });

  // --- Espaces -------------------------------------------------------------------------------------------------------

  router.get('/boards/spaces', (_req, res) => {
    requireBoardsEnabled(ctx.db);
    res.json({ spaces: listBoardSpaces(ctx, currentUser(res)) });
  });

  router.post('/boards/spaces', (req, res) => {
    requireBoardsEnabled(ctx.db);
    const user = currentUser(res);
    requireGlobal(user, 'boards.create');
    res.status(201).json({ space: createBoardSpace(ctx, user, parse(boardSpaceSchema, req.body)) });
  });

  router.get('/boards/spaces/:id', (req, res) => {
    const spaceId = idParam(req.params.id);
    const role = spaceAccess(res, spaceId);
    res.json({ space: getBoardSpace(ctx, currentUser(res), spaceId), role, nodes: listBoardNodes(ctx.db, spaceId), members: listBoardMembers(ctx.db, spaceId) });
  });

  router.patch('/boards/spaces/:id', (req, res) => {
    const spaceId = idParam(req.params.id);
    spaceAccess(res, spaceId, 'owner');
    res.json({ space: updateBoardSpace(ctx, currentUser(res), spaceId, parse(boardSpaceUpdateSchema, req.body)) });
  });

  router.delete('/boards/spaces/:id', (req, res) => {
    const spaceId = idParam(req.params.id);
    spaceAccess(res, spaceId, 'owner');
    deleteBoardSpace(ctx, currentUser(res), spaceId);
    res.json({ ok: true });
  });

  // --- Membres -------------------------------------------------------------------------------------------------------

  router.get('/boards/spaces/:id/members', (req, res) => {
    const spaceId = idParam(req.params.id);
    spaceAccess(res, spaceId);
    res.json({ members: listBoardMembers(ctx.db, spaceId) });
  });

  router.post('/boards/spaces/:id/members', (req, res) => {
    const spaceId = idParam(req.params.id);
    spaceAccess(res, spaceId, 'owner');
    const { userId, role } = parse(boardMemberSchema, req.body);
    res.json({ members: setBoardMember(ctx, spaceId, userId, role) });
  });

  router.put('/boards/spaces/:id/members/:userId', (req, res) => {
    const spaceId = idParam(req.params.id);
    spaceAccess(res, spaceId, 'owner');
    res.json({ members: setBoardMember(ctx, spaceId, idParam(req.params.userId), parse(boardMemberRoleSchema, req.body).role) });
  });

  router.delete('/boards/spaces/:id/members/:userId', (req, res) => {
    const spaceId = idParam(req.params.id);
    const userId = idParam(req.params.userId);
    // Chacun peut quitter un espace ; retirer quelqu'un d'autre est réservé aux propriétaires.
    spaceAccess(res, spaceId, userId === currentUser(res).id ? 'reader' : 'owner');
    res.json({ members: removeBoardMember(ctx, spaceId, userId) });
  });

  // --- Arbre ---------------------------------------------------------------------------------------------------------

  router.post('/boards/spaces/:id/nodes', (req, res) => {
    const spaceId = idParam(req.params.id);
    spaceAccess(res, spaceId, 'editor');
    const input = parse(boardNodeSchema, req.body);
    res.status(201).json({ node: createBoardNode(ctx, actorOf(req, res), spaceId, input) });
  });

  router.get('/boards/spaces/:id/trash', (req, res) => {
    const spaceId = idParam(req.params.id);
    spaceAccess(res, spaceId);
    res.json({ nodes: listBoardTrash(ctx.db, spaceId) });
  });

  router.patch('/boards/nodes/:id', (req, res) => {
    const nodeId = idParam(req.params.id);
    nodeAccess(res, nodeId, 'editor');
    res.json({ node: moveBoardNode(ctx, actorOf(req, res), nodeId, parse(boardMoveSchema, req.body).path) });
  });

  router.delete('/boards/nodes/:id', (req, res) => {
    const nodeId = idParam(req.params.id);
    nodeAccess(res, nodeId, 'editor');
    deleteBoardNode(ctx, actorOf(req, res), nodeId);
    res.json({ ok: true });
  });

  router.post('/boards/nodes/:id/restore', (req, res) => {
    const nodeId = idParam(req.params.id);
    nodeAccess(res, nodeId, 'editor');
    res.json({ node: restoreBoardNode(ctx, actorOf(req, res), nodeId) });
  });

  router.post('/boards/nodes/:id/duplicate', (req, res) => {
    const nodeId = idParam(req.params.id);
    const { node } = nodeAccess(res, nodeId, 'editor');
    if (node.kind !== 'board' || node.deleted_at) throw badRequest('Seul un tableau se duplique.');
    res.status(201).json({ node: duplicateBoard(ctx, actorOf(req, res), nodeId) });
  });

  // --- Contenu -------------------------------------------------------------------------------------------------------

  router.get('/boards/search', (req, res) => {
    const { q, limit } = parse(boardSearchSchema, req.query);
    res.json({ boards: searchBoards(ctx, currentUser(res), q, limit) });
  });

  router.get('/boards/nodes/:id', (req, res) => {
    const { node, role } = requireBoard(ctx, currentUser(res), idParam(req.params.id));
    const space = getBoardSpace(ctx, currentUser(res), node.space_id);
    res.json({ node: boardNodeDTO(node), space: { id: space.id, name: space.name }, role, elements: readBoardElements(ctx, node) });
  });

  router.put('/boards/nodes/:id/elements', (req, res) => {
    const { node } = requireBoard(ctx, currentUser(res), idParam(req.params.id), 'editor');
    const elements = writeBoardElements(ctx, actorOf(req, res), node, parse(boardElementsSchema, req.body).elements);
    res.json({ count: elements.length });
  });

  // --- Historique d'un tableau ---------------------------------------------------------------------------------------

  router.get('/boards/nodes/:id/versions', (req, res) => {
    const { node } = requireBoard(ctx, currentUser(res), idParam(req.params.id));
    res.json(boardHistory(ctx, node));
  });

  router.get('/boards/nodes/:id/versions/:versionId', (req, res) => {
    const { node } = requireBoard(ctx, currentUser(res), idParam(req.params.id));
    res.json(boardVersion(ctx, node, idParam(req.params.versionId)));
  });

  router.post('/boards/nodes/:id/versions/:versionId/restore', (req, res) => {
    const { node } = requireBoard(ctx, currentUser(res), idParam(req.params.id), 'editor');
    const elements = restoreBoardVersion(ctx, actorOf(req, res), node, idParam(req.params.versionId));
    res.json({ count: elements.length });
  });

  router.post('/boards/nodes/:id/versions/:versionId/fork', (req, res) => {
    const { node } = requireBoard(ctx, currentUser(res), idParam(req.params.id), 'editor');
    res.status(201).json({ node: forkBoardVersion(ctx, actorOf(req, res), node, idParam(req.params.versionId), parse(boardForkSchema, req.body ?? {}).name) });
  });

  // --- Partage d'un tableau (propriétaires de l'espace) -------------------------------------------------------------

  /** Un modèle ne se partage pas : on partage les tableaux qui l'utilisent. */
  const shareable = (node: { kind: string }) => {
    if (node.kind !== 'board') throw badRequest('Seul un tableau se partage.');
  };

  router.get('/boards/nodes/:id/share', (req, res) => {
    const { node } = requireBoard(ctx, currentUser(res), idParam(req.params.id), 'owner');
    shareable(node);
    res.json({ share: getBoardShare(ctx.db, node.id) });
  });

  router.put('/boards/nodes/:id/share', async (req, res) => {
    const user = currentUser(res);
    const { node } = requireBoard(ctx, user, idParam(req.params.id), 'owner');
    shareable(node);
    res.json({ share: await saveBoardShare(ctx, user.id, node.id, parse(boardShareSchema, req.body)) });
    ctx.boardRooms.publishTree(node.space_id);
  });

  router.delete('/boards/nodes/:id/share', (req, res) => {
    const user = currentUser(res);
    const { node } = requireBoard(ctx, user, idParam(req.params.id), 'owner');
    removeBoardShare(ctx, user.id, node.id);
    ctx.boardRooms.publishTree(node.space_id);
    res.json({ ok: true });
  });

  /** Ajoute, remplace ou retire des éléments sans toucher aux autres. */
  router.patch('/boards/nodes/:id/elements', (req, res) => {
    const { node } = requireBoard(ctx, currentUser(res), idParam(req.params.id), 'editor');
    const input = parse(boardElementsPatchSchema, req.body);
    res.json({ count: patchBoardElements(ctx, actorOf(req, res), node, input.upsert, input.remove).length });
  });

  /** Ce qui cite le tableau, et ce qu'il montre. */
  router.get('/boards/nodes/:id/links', (req, res) => {
    const user = currentUser(res);
    const { node } = requireBoard(ctx, user, idParam(req.params.id));
    res.json(boardLinks(ctx, user, node));
  });

  router.get('/boards/nodes/:id/preview', (req, res) => {
    const { node } = requireBoard(ctx, currentUser(res), idParam(req.params.id));
    const width = Math.min(1600, Math.max(120, Number(req.query.width) || 640));
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    // Une image, rien d'autre : pas de script, pas de ressource externe.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(boardPreviewSvg(readBoardElements(ctx, node), { maxWidth: width, dark: req.query.theme === 'dark', ...previewResources(ctx) }));
  });

  return router;
}
