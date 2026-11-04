import { diffIndices, merge } from 'node-diff3';

/** Fusion ligne à ligne des fichiers réimportés : à trois versions quand l'export d'origine est connu, sinon à deux. */

const LABELS = { a: 'Serveur', b: 'Import' };

export interface MergeResult {
  text: string;
  conflict: boolean;
}

/** Fusion à trois versions : les changements des deux côtés se combinent, sauf s'ils touchent les mêmes lignes. */
export function mergeThreeWay(server: string, base: string, incoming: string): MergeResult {
  const { conflict, result } = merge(server, base, incoming, { stringSeparator: '\n', label: LABELS });
  return { text: result.join('\n'), conflict };
}

/** Sans version d'origine, impossible de savoir qui a changé quoi : chaque écart devient un conflit à trancher. */
export function markDifferences(server: string, incoming: string): string {
  const left = server.split('\n');
  const right = incoming.split('\n');
  const lines: string[] = [];
  let position = 0;
  for (const hunk of diffIndices(left, right)) {
    lines.push(...left.slice(position, hunk.buffer1[0]));
    lines.push(`<<<<<<< ${LABELS.a}`, ...hunk.buffer1Content, '=======', ...hunk.buffer2Content, `>>>>>>> ${LABELS.b}`);
    position = hunk.buffer1[0] + hunk.buffer1[1];
  }
  lines.push(...left.slice(position));
  return lines.join('\n');
}
