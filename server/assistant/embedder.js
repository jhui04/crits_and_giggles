import { createEmbedding } from './llmClient.js';

/**
 * Local Semantic Embedder & Similarity Engine
 * Provides real dense embeddings via Ollama /v1/embeddings (e.g. nomic-embed-text)
 * with a deterministic offline fallback and true vector cosine similarity.
 */

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
 * Gracefully falls back to deterministic local embedding if Ollama is unreachable.
 */
export async function computeSemanticEmbedding(text, title = '', options = {}) {
  if (!text && !title) {
    return computeLocalEmbedding(text, title);
  }

  const combined = title ? `${title}\n\n${text}` : text;

  try {
    const rawEmbedding = await createEmbedding({
      input: combined,
      model: options.model,
    });
    if (rawEmbedding && Array.isArray(rawEmbedding) && rawEmbedding.length > 0) {
      return normalizeVector(rawEmbedding);
    }
  } catch (err) {
    // Offline or test environment fallback
    if (!options.silent) {
      console.info(`[Embedder] Ollama embedding service unavailable (${err.message}). Using local embedding engine.`);
    }
  }

  return computeLocalEmbedding(text, title);
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
      if (!options.silent && i === 0) {
        console.info(`[Embedder] Batch Ollama embedding unavailable (${err.message}). Using local embedding engine.`);
      }
    }

    // Fallback for this batch if Ollama is unavailable
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
