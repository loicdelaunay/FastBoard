import { RAG_LIMITS } from '../../shared/rag.ts';
import { describeNetworkError, outboundRequest, type OutboundResponse } from '../system/outbound.ts';
import type { RagEndpoint } from './settings.ts';

/**
 * Client d'embeddings compatible OpenAI : `POST {baseUrl}/embeddings` avec `{ model, input: [...] }`. Ollama, LM Studio,
 * vLLM, llama.cpp, Text Embeddings Inference, OpenAI, Mistral… répondent tous ce format (`data[].embedding`).
 * Les vecteurs rendus sont normés (la similarité cosinus devient un produit scalaire) et, si une taille est réglée,
 * tronqués à cette taille (modèles « Matryoshka » : EmbeddingGemma, Nomic v1.5, Qwen3 Embedding).
 */

interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] | string; index?: number }>;
  /** Ollama natif (`/api/embed`), au cas où l'adresse y mène. */
  embeddings?: number[][];
  error?: { message?: string } | string;
}

export class EmbeddingError extends Error {}

/** Vecteur normé (longueur 1), tronqué à `dimensions` au besoin. */
export function normalize(values: ArrayLike<number>, dimensions: number | null = null): Float32Array {
  const size = dimensions && dimensions < values.length ? dimensions : values.length;
  const vector = new Float32Array(size);
  let norm = 0;
  for (let index = 0; index < size; index += 1) {
    const value = Number(values[index]);
    vector[index] = Number.isFinite(value) ? value : 0;
    norm += vector[index]! * vector[index]!;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let index = 0; index < size; index += 1) vector[index]! /= norm;
  return vector;
}

/** Produit scalaire de deux vecteurs normés (similarité cosinus). */
export function similarity(a: Float32Array, b: Float32Array): number {
  const size = Math.min(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < size; index += 1) sum += a[index]! * b[index]!;
  return sum;
}

function decode(embedding: number[] | string): ArrayLike<number> {
  if (Array.isArray(embedding)) return embedding;
  // `encoding_format: base64` : des flottants 32 bits petit-boutistes.
  const bytes = Buffer.from(embedding, 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** Vecteurs de `inputs` (dans l'ordre), par lots de `RAG_LIMITS.batch`. */
export async function embed(endpoint: RagEndpoint, inputs: readonly string[], signal?: AbortSignal): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let start = 0; start < inputs.length; start += RAG_LIMITS.batch) {
    vectors.push(...(await embedBatch(endpoint, inputs.slice(start, start + RAG_LIMITS.batch), signal)));
  }
  return vectors;
}

async function embedBatch(endpoint: RagEndpoint, inputs: readonly string[], signal?: AbortSignal): Promise<Float32Array[]> {
  const url = `${endpoint.baseUrl.replace(/\/+$/, '')}/embeddings`;
  const timeout = AbortSignal.timeout(endpoint.timeoutMs);
  let response: OutboundResponse;
  try {
    response = await outboundRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}) },
      body: JSON.stringify({ model: endpoint.model, input: inputs }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      verifyCertificate: endpoint.verifyCertificate,
    });
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') throw new EmbeddingError(`Le serveur d'embeddings n'a pas répondu dans le délai (${Math.round(endpoint.timeoutMs / 1000)} s).`);
    if ((error as Error).name === 'AbortError') throw error;
    throw new EmbeddingError(`Serveur d'embeddings injoignable (${endpoint.baseUrl}) : ${describeNetworkError(error)}`);
  }
  let payload: EmbeddingsResponse | null = null;
  try {
    payload = JSON.parse(response.text) as EmbeddingsResponse;
  } catch {
    // Réponse non JSON : décrite plus bas.
  }
  if (!response.ok) {
    const detail = typeof payload?.error === 'string' ? payload.error : (payload?.error?.message ?? response.text.slice(0, 200));
    throw new EmbeddingError(`Le serveur d'embeddings a répondu ${response.status} : ${detail}`);
  }
  const raw = payload?.data
    ? [...payload.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((entry) => entry.embedding)
    : (payload?.embeddings ?? []);
  if (raw.length !== inputs.length || raw.some((entry) => !entry || (Array.isArray(entry) && !entry.length))) {
    throw new EmbeddingError(`Réponse inattendue du serveur d'embeddings : ${raw.length} vecteur(s) pour ${inputs.length} texte(s). Ce modèle calcule-t-il des embeddings ?`);
  }
  return raw.map((entry) => normalize(decode(entry!), endpoint.dimensions));
}
