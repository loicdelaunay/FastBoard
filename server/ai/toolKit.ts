import { randomUUID } from 'node:crypto';
import type { AiChangeDTO, AiRenderRequest, AiSourceDTO } from '../../shared/ai.ts';
import type { Actor, AppContext } from '../context.ts';
import type { AuthUser } from '../services/access.ts';

/** Ce que partagent les outils de l'assistant, sur les projets comme sur la documentation. */

/** Ce que l'agent sait de la personne et de la page ouverte ; les droits sont revérifiés à chaque appel d'outil. */
export interface ToolContext {
  ctx: AppContext;
  user: AuthUser;
  actor: Actor;
  allowWrite: boolean;
  /** Mode « proposer » : les outils d'écriture vérifient les droits et préparent la modification sans l'appliquer. */
  propose: boolean;
  changes: number;
  proposals: number;
  onChange?: (change: AiChangeDTO) => void;
  /** Le modèle voit les images (réglage du modèle par l'administrateur). */
  vision: boolean;
  /** Demande une image au panneau (vue d'un tableau, image réduite) ; `null` : il ne sait pas en dessiner. */
  render: ((request: AiRenderRequest) => Promise<string>) | null;
  /** Montre une image au modèle : elle suit les résultats des outils, dans un message à part. */
  attach: (label: string, image: string) => void;
  /** Images regardées pendant cette réponse (bornées par `AI_LIMITS.viewsPerAnswer`). */
  views: number;
  /** Note un élément lu pour répondre : il apparaît dans les sources sous la réponse (une fois). */
  cite: (source: AiSourceDTO) => void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  write: boolean;
  /** Outil de la documentation : proposé seulement si elle est activée. */
  docs?: boolean;
  /** Outil des tableaux blancs : proposé seulement s'ils sont activés. */
  boards?: boolean;
  /** Outil qui montre des images : proposé seulement aux modèles avec vision. */
  vision?: boolean;
  /** Outil qui fait dessiner une image au panneau : proposé seulement s'il sait le faire. */
  render?: boolean;
  /** Libellé court affiché dans le panneau pendant l'exécution. */
  label: (args: Record<string, unknown>) => string;
  run: (tool: ToolContext, args: Record<string, unknown>) => unknown;
}

const MAX_TEXT = 1_500;

export function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export const PROPOSED = 'Proposition enregistrée : elle ne sera appliquée que si la personne la valide dans le panneau.';

export function record(tool: ToolContext, change: Omit<AiChangeDTO, 'id' | 'state'>): AiChangeDTO {
  const full: AiChangeDTO = { ...change, id: randomUUID(), state: tool.propose ? 'pending' : 'applied' };
  if (tool.propose) tool.proposals += 1;
  else tool.changes += 1;
  tool.onChange?.(full);
  return full;
}
