import { RAG_KINDS, RAG_LIMITS, type RagKind } from '../../shared/rag.ts';
import { ragSearch } from '../rag/search.ts';
import type { ToolDefinition } from './toolKit.ts';

/**
 * Recherche sémantique (RAG) pour l'assistant : proposée quand l'administrateur l'a activée. Elle ne fouille que les
 * projets et espaces où le RAG est activé et auxquels la personne a accès ; les passages trouvés se citent (lignes
 * d'une note, éléments d'un tableau) et rejoignent les sources de la réponse.
 */
/** Écart de similarité au meilleur passage au-delà duquel un passage ne rejoint pas les sources, et leur nombre maximal. */
const SOURCE_MARGIN = 0.08;
const SOURCES_MAX = 5;

export const RAG_TOOLS: ToolDefinition[] = [
  {
    name: 'search_knowledge',
    description:
      'Recherche par le sens (RAG) dans les tickets, notes de documentation et tableaux blancs indexés : pour une question ouverte, ou formulée autrement que les textes (synonymes, autre langue). Rend des passages avec leur score, les lignes d’une note (`lines`, à citer @[Titre](doc:ID#L12-18)) ou les éléments d’un tableau (`elements`, à citer @[Titre](board:ID#el:a,b)). L’index peut dater de quelques heures : relis l’élément (get_ticket, read_doc, read_board) avant d’affirmer un détail précis. Pour un mot ou un identifiant exact, préfère « search » ou « search_docs ».',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Question ou description de ce qui est cherché, en langage naturel.' },
        kinds: { type: 'array', items: { type: 'string', enum: [...RAG_KINDS] }, description: 'Limiter à des tickets, des notes (`doc`) ou des tableaux (`board`).' },
        limit: { type: 'integer', minimum: 1, maximum: RAG_LIMITS.resultsMax, description: `Nombre de passages (${RAG_LIMITS.resultsDefault} par défaut).` },
      },
      required: ['query'],
    },
    write: false,
    rag: true,
    label: (args) => `Recherche sémantique « ${String(args.query ?? '').slice(0, 40)} »`,
    run: async (tool, args) => {
      const kinds = Array.isArray(args.kinds) ? args.kinds.filter((kind): kind is RagKind => (RAG_KINDS as readonly string[]).includes(String(kind))) : [];
      const { hits, searched, indexedAt } = await ragSearch(tool.ctx, tool.user, String(args.query ?? ''), { kinds, limit: Number(args.limit) || undefined });
      // Sources de la réponse : les passages proches du meilleur, pas toute la liste (les derniers sont souvent sans rapport).
      const best = hits[0]?.score ?? 0;
      const cited = new Set<string>();
      for (const hit of hits) {
        if (hit.score < best - SOURCE_MARGIN || cited.size >= SOURCES_MAX) break;
        cited.add(`${hit.kind}:${hit.id}`);
        tool.cite({ kind: hit.kind, id: hit.id, label: hit.title, ...(hit.kind === 'ticket' ? { projectId: hit.containerId } : {}) });
      }
      if (!searched) return { results: [], note: 'Aucun projet ni espace indexé n’est accessible à cette personne : le RAG doit être activé dans les réglages d’un projet ou d’un espace.' };
      return {
        indexedAt,
        results: hits.map((hit) => ({
          kind: hit.kind,
          id: hit.id,
          title: hit.title,
          ...(hit.kind === 'ticket' ? { projectId: hit.containerId } : { spaceId: hit.containerId }),
          score: hit.score,
          ...(hit.lines ? { lines: hit.lines } : {}),
          ...(hit.elements ? { elements: hit.elements } : {}),
          excerpt: hit.excerpt,
        })),
      };
    },
  },
];
