import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AiStreamEvent } from '../../shared/ai.ts';

/**
 * Faux fournisseur d'IA compatible OpenAI pour les essais : embeddings déterministes (« sac de mots »), modèles, et une
 * discussion qui appelle l'outil écrit dans le message (« outil:nom {json} ») puis recopie sa sortie.
 */

export const DIMENSIONS = 64;

/** Vecteur « sac de mots » : des textes qui partagent des mots se ressemblent (assez pour des essais déterministes). */
export function bagOfWords(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\d]{4,}/gu) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
    vector[hash % DIMENSIONS]! += 1;
  }
  return vector;
}

export interface EmbeddingCall {
  authorization: string | undefined;
  model: string;
  input: string[];
}

/**
 * Faux fournisseur compatible OpenAI : embeddings (`/v1/embeddings`, « sac de mots » ; le modèle `en-panne` échoue),
 * modèles, et discussion qui appelle l'outil écrit dans le message (« outil:nom {json} ») puis recopie sa sortie.
 */
export function startFakeProvider(): Promise<{ url: string; embeddings: EmbeddingCall[]; chats: Array<{ tools: string[]; messages: Array<{ role: string; content: unknown }> }>; close: () => Promise<void> }> {
  const embeddings: EmbeddingCall[] = [];
  const chats: Array<{ tools: string[]; messages: Array<{ role: string; content: unknown }> }> = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (req.method === 'GET' && req.url === '/v1/models') return json(200, { data: [{ id: 'embeddinggemma:300m' }, { id: 'nomic-embed-text' }, { id: 'qwen3-embedding:0.6b' }] });
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === '/v1/embeddings') {
        const input = Array.isArray(body.input) ? body.input : [body.input];
        embeddings.push({ authorization: req.headers.authorization, model: body.model, input });
        if (body.model === 'en-panne') return json(500, { error: { message: 'modèle introuvable' } });
        return json(200, { object: 'list', data: input.map((text: string, index: number) => ({ object: 'embedding', index, embedding: bagOfWords(text) })) });
      }
      if (req.url !== '/v1/chat/completions') return json(404, {});
      chats.push({ tools: (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name), messages: body.messages });
      const last = body.messages.at(-1);
      const reply = (message: Record<string, unknown>) => json(200, { choices: [{ message: { role: 'assistant', ...message }, finish_reason: 'stop' }] });
      if (last.role === 'tool') return reply({ content: `Résultat : ${last.content}` });
      const match = /outil:(\w+) (\{.*\})/.exec(String(last.content));
      if (match && body.tools?.some((tool: { function: { name: string } }) => tool.function.name === match[1])) {
        return reply({ content: null, tool_calls: [{ id: `call_${chats.length}`, type: 'function', function: { name: match[1], arguments: match[2] } }] });
      }
      return reply({ content: 'OK' });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/v1`, embeddings, chats, close: () => new Promise((done) => server.close(() => done())) });
    }),
  );
}

export function events(text: unknown): AiStreamEvent[] {
  return String(text)
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as AiStreamEvent);
}
