import { applyRagTemplate, detectRagPreset, ragTemplates, type RagFormat, type RagTestResultDTO } from '../../shared/rag.ts';
import { embed, similarity } from './embeddings.ts';

/**
 * Essai d'un modèle d'embeddings (bouton « Tester » de l'administration) : une question, un passage qui y répond et un
 * passage sans rapport. Le modèle répond-il, quelle taille ont ses vecteurs, et la question est-elle bien plus proche du
 * bon passage ? (Un format de requête mal choisi peut tout rendre semblable sans la moindre erreur.)
 */
const QUESTION = 'Comment installer le serveur de l’application ?';
const RELATED = { title: 'Guide d’installation', text: 'Pour installer le serveur, lancez npm install puis npm run build, et démarrez-le avec npm start sur le port 3000.' };
const UNRELATED = { title: 'Tarte aux pommes', text: 'Épluchez quatre pommes, étalez la pâte dans le moule et faites cuire quarante minutes à 180 degrés.' };

export interface RagProbe {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  format: RagFormat;
  queryTemplate: string;
  documentTemplate: string;
  dimensions: number | null;
  timeoutMs: number;
  verifyCertificate: boolean;
}

export async function testRag(probe: RagProbe): Promise<RagTestResultDTO> {
  const templates = ragTemplates(probe);
  const format: RagTestResultDTO['format'] = probe.format === 'custom' ? 'custom' : probe.format === 'auto' ? detectRagPreset(probe.model) : probe.format;
  const base = { model: probe.model, format, dimensions: null, ms: null, related: null, unrelated: null };
  if (!probe.model.trim()) return { ok: false, message: 'Indiquez le modèle d’embeddings.', ...base };
  const document = (entry: { title: string; text: string }) =>
    templates.document.includes('{title}') ? applyRagTemplate(templates.document, entry.text, entry.title) : applyRagTemplate(templates.document, `${entry.title}\n\n${entry.text}`);
  const started = Date.now();
  try {
    const [question, related, unrelated] = await embed({ ...probe, model: probe.model.trim(), templates }, [applyRagTemplate(templates.query, QUESTION), document(RELATED), document(UNRELATED)]);
    const scores = { related: Math.round(similarity(question!, related!) * 1000) / 1000, unrelated: Math.round(similarity(question!, unrelated!) * 1000) / 1000 };
    return { ...base, ok: scores.related > scores.unrelated, message: '', dimensions: question!.length, ms: Date.now() - started, ...scores };
  } catch (error) {
    return { ...base, ok: false, message: (error as Error).message, ms: Date.now() - started };
  }
}
