import { changedPassage } from '../../shared/docDiff.ts';
import { docTitle, DOC_LIMITS, normalizeDocPath, withMarkdownExtension, type DocRole } from '../../shared/docs.ts';
import { docOutline } from '../../shared/docOutline.ts';
import { listComments } from '../docs/comments.ts';
import { createNode, findNodeByPath, listNodes, listSpaces, readText, requireNode, requireSpace, writeContent, type NodeRow } from '../docs/store.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import { globalSearch } from '../services/search.ts';
import { clip, PROPOSED, record, type ToolContext, type ToolDefinition } from './toolKit.ts';

/** Outils de l'assistant sur la documentation : les droits sont ceux de la personne dans l'espace, revérifiés à chaque appel. */

/** Texte renvoyé en une lecture ; au-delà, l'assistant demande la suite. */
const READ_CHARS = 20_000;
/** Passage retenu pour annuler ou valider une modification : il voyage avec la conversation. */
const CHANGE_CHARS = 300_000;
const FILES_LISTED = 500;

const NOTE_PROPERTIES = {
  note: { oneOf: [{ type: 'integer' }, { type: 'string' }], description: 'Identifiant de la note, ou son chemin dans l’espace (avec spaceId).' },
  spaceId: { type: 'integer', description: 'Espace de la note, si elle est donnée par son chemin.' },
};

function findNote(tool: ToolContext, args: Record<string, unknown>, minimum: DocRole = 'reader'): NodeRow {
  const { db } = tool.ctx;
  const ref = args.note;
  let node: NodeRow | undefined;
  if (typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref.trim()))) {
    node = requireNode(db, Number(ref));
  } else if (typeof ref === 'string' && args.spaceId) {
    const spaceId = Number(args.spaceId);
    requireSpace(tool.ctx, tool.user, spaceId);
    node = findNodeByPath(db, spaceId, withMarkdownExtension(ref.trim()));
  } else {
    throw badRequest('Indiquez l’identifiant de la note, ou son chemin avec spaceId.');
  }
  if (!node) throw notFound('Note introuvable.');
  requireSpace(tool.ctx, tool.user, node.space_id, minimum);
  if (node.deleted_at || node.kind !== 'markdown') throw notFound('Note introuvable.');
  return node;
}

function requireWrite(tool: ToolContext): void {
  if (!tool.allowWrite) throw forbidden("Modifications désactivées : la personne doit cocher « Autoriser les modifications » dans le panneau de l'assistant.");
}

const noteText = (tool: ToolContext, node: NodeRow): string => tool.ctx.docRooms.currentText(node.id) ?? readText(tool.ctx, node);

/** Modifie (ou propose de modifier) une note, en gardant le passage touché pour pouvoir annuler. */
function changeNote(tool: ToolContext, node: NodeRow, next: string) {
  const current = noteText(tool, node);
  if (next === current) return { unchanged: true };
  if (next.length > DOC_LIMITS.fileChars) throw badRequest(`Un fichier ne peut pas dépasser ${DOC_LIMITS.fileChars} caractères.`);
  const passage = changedPassage(current, next);
  if (passage.before.length + passage.after.length > CHANGE_CHARS) throw badRequest('Modification trop étendue : découpez-la en passages plus courts avec edit_doc.');
  const change = {
    label: `Modification de ${docTitle(node.path)}`,
    projectId: null,
    ticketKey: null,
    diff: [{ field: 'doc', from: clip(passage.before, 400), to: clip(passage.after, 400) }],
    action: { kind: 'doc.edit' as const, nodeId: node.id, before: passage.before, after: passage.after },
  };
  if (tool.propose) {
    record(tool, change);
    return { proposed: true, message: PROPOSED };
  }
  writeContent(tool.ctx, tool.actor, node, next, 'ai');
  record(tool, change);
  return { updated: node.path, chars: next.length };
}

export const DOC_TOOLS: ToolDefinition[] = [
  {
    name: 'list_doc_spaces',
    description: 'Liste les espaces de documentation accessibles à la personne, avec son rôle et leur nombre de notes.',
    parameters: { type: 'object', properties: {} },
    write: false,
    docs: true,
    label: () => 'Liste des espaces de documentation',
    run: (tool) => listSpaces(tool.ctx, tool.user).map((space) => ({ id: space.id, name: space.name, description: clip(space.description, 300), role: space.role, notes: space.fileCount })),
  },
  {
    name: 'list_doc_files',
    description: 'Arbre d’un espace de documentation : dossiers, notes et images, avec leur chemin et leur identifiant.',
    parameters: { type: 'object', properties: { spaceId: { type: 'integer' } }, required: ['spaceId'] },
    write: false,
    docs: true,
    label: () => 'Arbre de l’espace',
    run: (tool, args) => {
      const spaceId = Number(args.spaceId);
      requireSpace(tool.ctx, tool.user, spaceId);
      const nodes = listNodes(tool.ctx.db, spaceId);
      return { total: nodes.length, files: nodes.slice(0, FILES_LISTED).map((node) => ({ id: node.id, path: node.path, kind: node.kind, updatedAt: node.updatedAt })) };
    },
  },
  {
    name: 'read_doc',
    description: 'Lit une note Markdown : son plan, son texte (par tranches pour une longue note, voir nextOffset) et ses commentaires ouverts.',
    parameters: { type: 'object', properties: { ...NOTE_PROPERTIES, offset: { type: 'integer', minimum: 0, description: 'Position de départ, pour lire la suite.' } }, required: ['note'] },
    write: false,
    docs: true,
    label: (args) => `Lecture de ${String(args.note)}`,
    run: (tool, args) => {
      const node = findNote(tool, args);
      const text = noteText(tool, node);
      const offset = Math.max(0, Number(args.offset) || 0);
      const end = offset + READ_CHARS;
      return {
        id: node.id,
        spaceId: node.space_id,
        path: node.path,
        chars: text.length,
        updatedAt: node.updated_at,
        outline: docOutline(text).slice(0, 200).map((heading) => `${'#'.repeat(heading.level)} ${heading.title}`),
        content: text.slice(offset, end),
        nextOffset: end < text.length ? end : undefined,
        comments: listComments(tool.ctx.db, node.id)
          .filter((comment) => !comment.resolvedAt)
          .slice(-20)
          .map((comment) => ({ quote: comment.quote || undefined, body: clip(comment.body, 500) })),
      };
    },
  },
  {
    name: 'search_docs',
    description: 'Cherche dans la documentation accessible, par titre ou par contenu. La recherche porte sur l’expression entière. Sans spaceId, cherche dans tous les espaces.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, spaceId: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['query'] },
    write: false,
    docs: true,
    label: (args) => `Recherche « ${clip(String(args.query ?? ''), 40)} » dans la documentation`,
    run: (tool, args) => {
      const query = String(args.query ?? '').trim();
      if (!query) throw badRequest('Indiquez des mots à rechercher.');
      const limit = Math.min(30, Math.max(1, Number(args.limit) || 12));
      const spaceId = args.spaceId ? Number(args.spaceId) : null;
      const { docs } = globalSearch(tool.ctx, tool.user, query, { limit: spaceId ? 200 : limit, kinds: ['docs'] });
      const notes = docs.items.filter((note) => spaceId === null || note.spaceId === spaceId);
      return { total: spaceId ? notes.length : docs.total, notes: notes.slice(0, limit).map((note) => ({ id: note.id, spaceId: note.spaceId, space: note.spaceName, path: note.path, excerpt: note.excerpt || undefined })) };
    },
  },
  {
    name: 'create_doc',
    description: 'Crée une note Markdown dans un espace, avec son texte. Les dossiers du chemin sont créés au besoin.',
    parameters: { type: 'object', properties: { spaceId: { type: 'integer' }, path: { type: 'string', description: 'Chemin dans l’espace, ex. « Guides/Installation ».' }, content: { type: 'string', description: 'Texte en Markdown.' } }, required: ['spaceId', 'path', 'content'] },
    write: true,
    docs: true,
    label: (args) => `Création de « ${clip(String(args.path ?? ''), 40)} »`,
    run: (tool, args) => {
      requireWrite(tool);
      const spaceId = Number(args.spaceId);
      requireSpace(tool.ctx, tool.user, spaceId, 'editor');
      const path = normalizeDocPath(withMarkdownExtension(String(args.path ?? '').trim()));
      if (!path) throw badRequest('Nom invalide : évitez les caractères spéciaux et les noms commençant par un point.');
      if (findNodeByPath(tool.ctx.db, spaceId, path)) throw conflict('Un élément porte déjà ce nom.');
      const content = String(args.content ?? '');
      if (content.length > CHANGE_CHARS) throw badRequest('Texte trop long pour être créé d’un coup.');
      const change = { label: `Création de ${docTitle(path)}`, projectId: null, ticketKey: null, diff: [{ field: 'docPath', from: null, to: path }] };
      if (tool.propose) {
        record(tool, { ...change, action: { kind: 'doc.create', spaceId, path, content, nodeId: null } });
        return { proposed: true, message: PROPOSED };
      }
      const node = createNode(tool.ctx, tool.actor, spaceId, { path, kind: 'markdown', content });
      record(tool, { ...change, action: { kind: 'doc.create', spaceId, path, content, nodeId: node.id } });
      return { created: { id: node.id, path: node.path } };
    },
  },
  {
    name: 'edit_doc',
    description: 'Remplace un passage exact d’une note. À préférer pour toute retouche : le reste du texte ne bouge pas. Le passage doit être recopié à l’identique et n’apparaître qu’une fois.',
    parameters: { type: 'object', properties: { ...NOTE_PROPERTIES, old: { type: 'string', description: 'Passage à remplacer, recopié de read_doc.' }, new: { type: 'string', description: 'Nouveau texte (vide pour retirer le passage).' } }, required: ['note', 'old', 'new'] },
    write: true,
    docs: true,
    label: (args) => `Modification de ${String(args.note)}`,
    run: (tool, args) => {
      requireWrite(tool);
      const node = findNote(tool, args, 'editor');
      const old = String(args.old ?? '');
      if (!old) throw badRequest('old est vide.');
      const text = noteText(tool, node);
      const index = text.indexOf(old);
      if (index < 0) throw badRequest('Passage introuvable : recopiez-le exactement depuis read_doc.');
      if (text.indexOf(old, index + 1) >= 0) throw badRequest('Passage présent plusieurs fois : ajoutez du contexte pour qu’il soit unique.');
      return changeNote(tool, node, `${text.slice(0, index)}${String(args.new ?? '')}${text.slice(index + old.length)}`);
    },
  },
  {
    name: 'rewrite_doc',
    description: 'Remplace tout le texte d’une note. Réservé aux réécritures complètes : pour une retouche, utilisez edit_doc.',
    parameters: { type: 'object', properties: { ...NOTE_PROPERTIES, content: { type: 'string', description: 'Nouveau texte complet, en Markdown.' } }, required: ['note', 'content'] },
    write: true,
    docs: true,
    label: (args) => `Réécriture de ${String(args.note)}`,
    run: (tool, args) => {
      requireWrite(tool);
      const node = findNote(tool, args, 'editor');
      if (typeof args.content !== 'string') throw badRequest('content est obligatoire.');
      return changeNote(tool, node, args.content);
    },
  },
];
