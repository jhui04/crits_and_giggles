import { describe, it, expect, afterEach, vi } from 'vitest';
import * as llm from './llmClient.js';
import { handleAssistantChat } from './orchestrator.js';

const reply = (message) => ({
  response: { choices: [{ message }] },
  modelUsed: 'qwen3.5:9b',
});

describe('empty final answer from a reasoning model', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-asks for a direct answer instead of surfacing the thought-process placeholder', async () => {
    const chat = vi
      .spyOn(llm, 'executeChatCompletion')
      .mockResolvedValueOnce(reply({ role: 'assistant', content: '', thinking: 'long deliberation' }))
      .mockResolvedValueOnce(reply({ role: 'assistant', content: 'Fireball takes 1 action to cast.' }));

    const result = await handleAssistantChat({ query: 'What is the casting time for Fireball?', mockResponse: false });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].messages.at(-1).role).toBe('user');
    expect(result.answer).toBe('Fireball takes 1 action to cast.');
    expect(result.thinking).toContain('long deliberation');
  });

  it('gives up after a bounded number of retries and falls back to the placeholder', async () => {
    const chat = vi
      .spyOn(llm, 'executeChatCompletion')
      .mockResolvedValue(reply({ role: 'assistant', content: '', thinking: 'still thinking' }));

    const result = await handleAssistantChat({ query: 'What is the casting time for Fireball?', mockResponse: false });

    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.answer).toMatch(/completed its thought process/);
  });
});
