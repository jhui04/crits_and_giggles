import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as llm from './llmClient.js';
import {
  computeSemanticEmbedding,
  computeSemanticEmbeddingsBatch,
  EmbeddingUnavailableError,
  localFallbackAllowed,
} from './embedder.js';
import { searchVectorStore, invalidateVectorCache } from './vectorStore.js';
import { handleAssistantChat } from './orchestrator.js';

describe('embedding model unavailable (no silent fallback)', () => {
  beforeEach(() => {
    process.env.ALLOW_LOCAL_EMBEDDING_FALLBACK = '0';
    vi.spyOn(llm, 'createEmbedding').mockRejectedValue(new Error('model "nomic-embed-text" not found'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.ALLOW_LOCAL_EMBEDDING_FALLBACK;
    vi.restoreAllMocks();
    invalidateVectorCache();
  });

  it('defaults the fallback on only under test mode, with an env override', () => {
    delete process.env.ALLOW_LOCAL_EMBEDDING_FALLBACK;
    expect(localFallbackAllowed()).toBe(true); // vitest sets NODE_ENV=test
    process.env.ALLOW_LOCAL_EMBEDDING_FALLBACK = '0';
    expect(localFallbackAllowed()).toBe(false);
  });

  it('single and batch embeddings throw with install instructions', async () => {
    await expect(computeSemanticEmbedding('goblin')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    await expect(computeSemanticEmbedding('goblin')).rejects.toThrow(/ollama pull nomic-embed-text/);
    await expect(computeSemanticEmbeddingsBatch([{ title: 't', content: 'c' }])).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('search rejects rather than degrading to keyword vectors', async () => {
    await expect(searchVectorStore('fireball')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('chat short-circuits with an explanatory message and never calls the chat model', async () => {
    const chat = vi.spyOn(llm, 'executeChatCompletion');
    const result = await handleAssistantChat({ query: 'What does fireball do?', mockResponse: false });
    expect(chat).not.toHaveBeenCalled();
    expect(result.embeddingUnavailable).toBe(true);
    expect(result.answer).toMatch(/nomic-embed-text/);
    expect(result.answer).toMatch(/ollama list/);
    expect(result.answer).toMatch(/ollama pull nomic-embed-text/);
  });
});
