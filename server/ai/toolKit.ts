import { randomUUID } from 'node:crypto';
import type { AiChangeDTO } from '../../shared/ai.ts';
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
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  write: boolean;
  /** Outil de la documentation : proposé seulement si elle est activée. */
  docs?: boolean;
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
