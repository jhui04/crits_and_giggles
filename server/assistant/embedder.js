import { createEmbedding } from './llmClient.js';
import { getConfig } from './config.js';

/**
 * Local Semantic Embedder & Similarity Engine
 * Provides real dense embeddings via Ollama /v1/embeddings (e.g. nomic-embed-text) and true vector
 * cosine similarity. If the embedding model is unavailable the embedding calls throw
 * EmbeddingUnavailableError rather than silently degrading to the (much weaker) hashed-TF vectors.
 * The local fallback is only used when explicitly requested (forceLocal) or in test mode.
 */

export class EmbeddingUnavailableError extends Error {
  constructor(model, cause) {
    const reason = cause?.message || String(cause || 'no embedding returned');
    super(
      `The embedding model "${model}" is not available (${reason}). ` +
      `Make sure Ollama is running and that the model is installed: run "ollama list" to check, ` +
      `and "ollama pull ${model}" to install it.`
    );
    this.name = 'EmbeddingUnavailableError';
    this.model = model;
  }
}

/**
 * Whether the deterministic local embedding may stand in for a failed model call.
 * Off by default; on under NODE_ENV=test (no Ollama in CI). ALLOW_LOCAL_EMBEDDING_FALLBACK=1/0 overrides.
 */
export function localFallbackAllowed() {
  const flag = process.env.ALLOW_LOCAL_EMBEDDING_FALLBACK;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return process.env.NODE_ENV === 'test';
}

// Under NODE_ENV=test (flag unset) the embedding model is not contacted at all, so unit tests are
// deterministic and fast whether or not a local Ollama happens to be running.
function localOnly() {
  return process.env.ALLOW_LOCAL_EMBEDDING_FALLBACK === undefined && process.env.NODE_ENV === 'test';
}

function resolveEmbeddingModel(options) {
  return options.model || getConfig().embeddingModel || 'nomic-embed-text';
}

const VECTOR_DIMENSIONS = 1024;

// Common stop words to de-emphasize for fallback
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with'
]);

/**
 * Deterministic hash function for a string token
 */
function hashToken(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0x7fffffff;
  }
  return hash % VECTOR_DIMENSIONS;
}

/**
 * Computes a normalized vector embedding for text using deterministic sublinear TF-IDF.
 * Used as high-speed offline fallback when local Ollama embedding model is not yet loaded.
 */
export function computeLocalEmbedding(text, title = '') {
  return markLocal(buildLocalEmbedding(text, title));
}

// Vectors produced by the local fallback are tracked by identity so callers can tag them when
// persisting; local (hashed TF) and dense (neural) vectors live in unrelated spaces even when
// their lengths happen to match.
const localVectors = new WeakSet();
function markLocal(vec) {
  localVectors.add(vec);
  return vec;
}

/** 'local' for the deterministic fallback, otherwise 'dense:<dimensions>'. */
export function embeddingKind(vec) {
  return localVectors.has(vec) ? 'local' : `dense:${vec.length}`;
}

/** Best-effort kind for rows stored before kinds were tracked (local vectors are non-negative, 1024-d). */
export function inferEmbeddingKind(vec) {
  if (vec.length === VECTOR_DIMENSIONS && !vec.some((v) => v < 0)) return 'local';
  return `dense:${vec.length}`;
}

function buildLocalEmbedding(text, title) {
  if (!text || typeof text !== 'string') {
    return new Array(VECTOR_DIMENSIONS).fill(0);
  }

  const rawCounts = new Array(VECTOR_DIMENSIONS).fill(0);
  const clean = text.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);

  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    const bucket = hashToken(word);
    rawCounts[bucket] += 2.0;

    // Sub-word 3-grams for partial matching
    if (word.length >= 4) {
      for (let i = 0; i <= word.length - 3; i++) {
        const trigram = word.slice(i, i + 3);
        const triBucket = hashToken(trigram);
        rawCounts[triBucket] += 0.5;
      }
    }
  }

  // Extra boost for words in title
  if (title && typeof title === 'string') {
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ');
    const titleWords = cleanTitle.split(/\s+/).filter(Boolean);
    for (const tw of titleWords) {
      if (STOP_WORDS.has(tw)) continue;
      const bucket = hashToken(tw);
      rawCounts[bucket] += 6.0;
    }
  }

  // Standard sublinear TF scaling: log(1 + tf)
  const vector = new Array(VECTOR_DIMENSIONS).fill(0);
  let sumSq = 0;

  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    if (rawCounts[i] > 0) {
      const val = Math.log1p(rawCounts[i]);
      vector[i] = val;
      sumSq += val * val;
    }
  }

  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
      if (vector[i] > 0) {
        vector[i] = Number((vector[i] / norm).toFixed(6));
      }
    }
  }

  return vector;
}

/**
 * Normalizes any vector to unit length (L2 norm = 1.0)
 */
export function normalizeVector(vec) {
  if (!vec || !Array.isArray(vec) || vec.length === 0) return vec;
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

/**
 * Computes semantic dense embedding using Ollama's /v1/embeddings endpoint.
 * Throws EmbeddingUnavailableError if the model can't produce an embedding (see localFallbackAllowed).
 */
export async function computeSemanticEmbedding(text, title = '', options = {}) {
  if (!text && !title) {
    return computeLocalEmbedding(text, title);
  }

  const combined = title ? `${title}\n\n${text}` : text;

  if (localOnly()) return computeLocalEmbedding(text, title);

  let failure;
  try {
    const rawEmbedding = await createEmbedding({
      input: combined,
      model: options.model,
    });
    if (rawEmbedding && Array.isArray(rawEmbedding) && rawEmbedding.length > 0) {
      return normalizeVector(rawEmbedding);
    }
  } catch (err) {
    failure = err;
  }

  if (localFallbackAllowed()) return computeLocalEmbedding(text, title);
  throw new EmbeddingUnavailableError(resolveEmbeddingModel(options), failure);
}

/**
 * Batch computes semantic embeddings for multiple texts.
 */
export async function computeSemanticEmbeddingsBatch(items, options = {}) {
  if (!items || items.length === 0) return [];

  const BATCH_SIZE = 50;
  const results = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const inputs = chunk.map((item) => (item.title ? `${item.title}\n\n${item.content}` : item.content));

    if (localOnly()) {
      for (const item of chunk) results.push(computeLocalEmbedding(item.content, item.title));
      continue;
    }

    let failure;
    try {
      const rawEmbeddings = await createEmbedding({
        input: inputs,
        model: options.model,
      });
      if (Array.isArray(rawEmbeddings) && rawEmbeddings.length === chunk.length) {
        for (const emb of rawEmbeddings) {
          results.push(normalizeVector(emb));
        }
        continue;
      }
    } catch (err) {
      failure = err;
    }

    if (!localFallbackAllowed()) {
      throw new EmbeddingUnavailableError(resolveEmbeddingModel(options), failure);
    }
    for (const item of chunk) {
      results.push(computeLocalEmbedding(item.content, item.title));
    }
  }

  return results;
}

/**
 * Calculates true cosine similarity between two vectors.
 * Handles both dense (positive/negative) neural embeddings and sparse vectors.
 * Returns a score between 0.0 and 1.0.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1.0, dotProduct));
}
