import type { DocRole } from '../../shared/docs.ts';

/**
 * Rôles dans un espace (documentation, tableaux blancs) quand une personne en a plusieurs : son rôle direct et ceux de
 * ses groupes. Le plus large l'emporte, d'après son rang : 1 lecteur, 2 éditeur, 3 propriétaire.
 */

export const roleOfRank = (rank: number | null | undefined): DocRole | null => (rank === 3 ? 'owner' : rank === 2 ? 'editor' : rank === 1 ? 'reader' : null);

/** Rang du rôle le plus large dans une requête SQL (\`role\` : colonne de doc_access ou board_access). */
export const ROLE_RANK_SQL = "MAX(CASE role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 WHEN 'reader' THEN 1 ELSE 0 END)";
