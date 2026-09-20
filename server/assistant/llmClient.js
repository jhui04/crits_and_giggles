import OpenAI from 'openai';
import { getConfig, validateModel } from './config.js';

/**
 * Creates an OpenAI-compatible client configured for local Ollama / llama.cpp
 */
export function getOpenAIClient(overrides = {}) {
  const config = getConfig();
  const baseURL = overrides.baseURL || config.baseURL;
  const apiKey = overrides.apiKey || config.apiKey;

  return new OpenAI({
    baseURL,
    apiKey,
    dangerouslyAllowBrowser: false,
  });
}

import { getOllamaApiBase } from './telemetry.js';

/**
 * Calls Ollama's native /api/chat endpoint to retrieve raw timing metrics
 * (load_duration, total_duration, eval_count, eval_duration) with zero overhead.
 * Returns an OpenAI-compatible completion object with attached metrics.
 */
export async function callOllamaNativeChat({
  baseURL,
  model,
  messages,
  tools = undefined,
  temperature = 0.3,
}) {
  const ollamaBase = getOllamaApiBase(baseURL);
  const payload = {
    model,
    messages,
    stream: false,
    options: {
      temperature,
    },
  };

  if (tools && Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
  }

  const res = await fetch(`${ollamaBase}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Ollama /api/chat HTTP ${res.status}: ${errorText || res.statusText}`);
  }

  const data = await res.json();
  const finishReason = data.message?.tool_calls?.length
    ? 'tool_calls'
    : data.done_reason || 'stop';

  return {
    id: `ollama-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: [
      {
        index: 0,
        message: data.message || { role: 'assistant', content: '' },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: data.prompt_eval_count || 0,
      completion_tokens: data.eval_count || 0,
      total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
    },
    metrics: {
      load_duration: data.load_duration || 0,
      total_duration: data.total_duration || 0,
      eval_count: data.eval_count || 0,
      eval_duration: data.eval_duration || 0,
      prompt_eval_count: data.prompt_eval_count || 0,
      prompt_eval_duration: data.prompt_eval_duration || 0,
    },
  };
}

async function dispatchChatCall({ requestPayload, client, baseURL, clientOverride }) {
  // If clientOverride is passed (e.g. mock test client), always use standard client.chat.completions.create
  if (clientOverride) {
    return await client.chat.completions.create(requestPayload);
  }

  // If targeting Ollama (default or 11434 port), use native /api/chat to capture zero-overhead metrics
  const isOllamaTarget = baseURL.includes('11434') || baseURL.includes('ollama');
  if (isOllamaTarget) {
    try {
      return await callOllamaNativeChat({
        baseURL,
        model: requestPayload.model,
        messages: requestPayload.messages,
        tools: requestPayload.tools,
        temperature: requestPayload.temperature,
      });
    } catch (ollamaErr) {
      console.warn(`[LLMClient] Ollama /api/chat failed (${ollamaErr.message}), falling back to OpenAI client...`);
    }
  }

  return await client.chat.completions.create(requestPayload);
}

/**
 * Executes a chat completion with support for tool calls and automatic fallback
 * from 9B to 4B if primary fails.
 */
export async function executeChatCompletion({
  messages,
  tools = undefined,
  model = undefined,
  clientOverride = undefined,
  temperature = 0.3,
}) {
  const config = getConfig();
  const client = clientOverride || getOpenAIClient();

  // Model selection: explicit requested model or config activeModel
  const chosenModel = model || config.activeModel;
  validateModel(chosenModel);

  const requestPayload = {
    model: chosenModel,
    messages,
    temperature,
  };

  if (tools && Array.isArray(tools) && tools.length > 0) {
    requestPayload.tools = tools;
    requestPayload.tool_choice = 'auto';
  }

  try {
    const response = await dispatchChatCall({
      requestPayload,
      client,
      baseURL: config.baseURL,
      clientOverride,
    });
    return {
      response,
      modelUsed: chosenModel,
      isFallback: false,
      metrics: response.metrics || null,
    };
  } catch (primaryErr) {
    // If we're not already on the fallback model, attempt graceful fallback to 4B model
    if (chosenModel !== config.fallbackModel && config.fallbackModel) {
      console.warn(
        `[LLMClient] Primary model "${chosenModel}" failed: ${primaryErr.message}. Attempting graceful fallback to "${config.fallbackModel}"...`
      );
      try {
        const fallbackPayload = {
          ...requestPayload,
          model: config.fallbackModel,
        };
        const fallbackResponse = await dispatchChatCall({
          requestPayload: fallbackPayload,
          client,
          baseURL: config.baseURL,
          clientOverride,
        });
        return {
          response: fallbackResponse,
          modelUsed: config.fallbackModel,
          isFallback: true,
          metrics: fallbackResponse.metrics || null,
          primaryError: primaryErr.message,
        };
      } catch (fallbackErr) {
        console.error(`[LLMClient] Fallback model "${config.fallbackModel}" also failed: ${fallbackErr.message}`);
        throw new Error(`LLM call failed on both "${chosenModel}" (${primaryErr.message}) and fallback "${config.fallbackModel}" (${fallbackErr.message})`);
      }
    }

    throw primaryErr;
  }
}

/**
 * Generates dense vector embeddings using Ollama's /v1/embeddings endpoint
 */
export async function createEmbedding({
  input,
  model = undefined,
  clientOverride = undefined,
}) {
  const config = getConfig();
  const client = clientOverride || getOpenAIClient();
  const embeddingModel = model || config.embeddingModel || 'nomic-embed-text';

  const response = await client.embeddings.create({
    model: embeddingModel,
    input,
  });

  if (Array.isArray(input)) {
    return response.data.map((d) => d.embedding);
  }
  return response.data[0]?.embedding;
}
