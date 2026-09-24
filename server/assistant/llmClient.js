import OpenAI from 'openai';
import { getConfig, validateModel } from './config.js';

/**
 * Creates an OpenAI-compatible client configured for local Ollama / llama.cpp
 */
// The OpenAI client holds an HTTP agent/connection pool, so reuse one per
// (baseURL, apiKey, timeout) instead of rebuilding it on every call.
let cachedClient = null;
let cachedClientKey = null;

export function getOpenAIClient(overrides = {}) {
  const config = getConfig();
  const baseURL = overrides.baseURL || config.baseURL;
  const apiKey = overrides.apiKey || config.apiKey;
  const timeout = config.requestTimeoutMs;
  const key = JSON.stringify([baseURL, apiKey, timeout]);

  if (cachedClient && cachedClientKey === key) return cachedClient;

  cachedClient = new OpenAI({
    baseURL,
    apiKey,
    timeout,
    dangerouslyAllowBrowser: false,
  });
  cachedClientKey = key;
  return cachedClient;
}

import { getOllamaApiBase } from './telemetry.js';

/**
 * Robustly separates internal model reasoning (thoughts) from final response content.
 * Handles:
 * 1. Native Ollama `message.thinking` field
 * 2. `<think>...</think>` tags inside `message.content`
 * 3. Unclosed `<think>...` blocks if output was truncated
 */
export function separateThinkingAndContent(rawContent = '', rawThinking = '') {
  let thinking = (rawThinking || '').trim();
  let content = (rawContent || '').trim();

  if (content.includes('<think>')) {
    const closedMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
    if (closedMatch) {
      const extracted = closedMatch[1].trim();
      thinking = thinking ? `${thinking}\n\n${extracted}` : extracted;
      content = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    } else {
      const unclosedMatch = content.match(/<think>([\s\S]*)$/i);
      if (unclosedMatch) {
        const extracted = unclosedMatch[1].trim();
        thinking = thinking ? `${thinking}\n\n${extracted}` : extracted;
        content = content.replace(/<think>[\s\S]*$/i, '').trim();
      }
    }
  }

  return { thinking, content };
}

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
  format = undefined,
  temperature = 0.3,
  keepAlive,
}) {
  const ollamaBase = getOllamaApiBase(baseURL);
  const config = getConfig();
  const effectiveKeepAlive = keepAlive || config.keepAlive || '30m';
  const maxTokens = config.maxTokens || 4096;
  const numCtx = config.numCtx || 16384;
  const timeoutMs = config.requestTimeoutMs || 300000;

  // Normalize messages for Ollama native /api/chat:
  // Ollama requires `content` to be a string and image attachments in `images: [base64_string]`
  const normalizedMessages = (messages || []).map((m) => {
    const msg = { role: m.role };
    if (typeof m.content === 'string') {
      msg.content = m.content;
    } else if (Array.isArray(m.content)) {
      const textParts = m.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      msg.content = textParts;

      if (!m.images) {
        const imageParts = m.content
          .filter((p) => p.type === 'image_url' && p.image_url?.url)
          .map((p) => p.image_url.url.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ''));
        if (imageParts.length > 0) {
          msg.images = imageParts;
        }
      }
    } else {
      msg.content = String(m.content || '');
    }

    if (m.images && Array.isArray(m.images) && m.images.length > 0) {
      msg.images = m.images.map((img) => img.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ''));
    }

    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;

    return msg;
  });

  const payload = {
    model,
    messages: normalizedMessages,
    stream: false,
    keep_alive: effectiveKeepAlive,
    options: {
      temperature,
      num_predict: maxTokens,
      num_ctx: numCtx,
    },
  };

  if (tools && Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
  }

  if (format) {
    payload.format = format;
  }

  // Bound every request so a hung Ollama server can't stall a chat turn forever.
  const timedFetch = async (body) => {
    try {
      return await fetch(`${ollamaBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error(`Ollama /api/chat request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  };

  let res = await timedFetch(JSON.stringify(payload));

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    // If the model does not support multimodal images, retry text-only
    const isImageUnsupported = /image|vision|multimodal/i.test(errorText);
    const hasImages = normalizedMessages.some((m) => m.images && m.images.length > 0);
    if (isImageUnsupported && hasImages) {
      console.warn(`[LLMClient] Model "${model}" does not support images. Retrying text-only...`);
      const strippedMessages = normalizedMessages.map(({ images, ...m }) => m);
      const retryPayload = { ...payload, messages: strippedMessages };
      res = await timedFetch(JSON.stringify(retryPayload));
    }

    if (!res.ok) {
      const retryError = await res.text().catch(() => '');
      throw new Error(`Ollama /api/chat HTTP ${res.status}: ${retryError || errorText || res.statusText}`);
    }
  }

  const data = await res.json();
  const finishReason = data.message?.tool_calls?.length
    ? 'tool_calls'
    : data.done_reason || 'stop';

  const rawMsg = data.message || { role: 'assistant', content: '' };
  const { thinking, content } = separateThinkingAndContent(rawMsg.content, rawMsg.thinking);

  const messageObj = {
    role: rawMsg.role || 'assistant',
    content,
    thinking,
    ...(rawMsg.tool_calls ? { tool_calls: rawMsg.tool_calls } : {}),
  };

  return {
    id: `ollama-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: [
      {
        index: 0,
        message: messageObj,
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
  // Normalize messages for OpenAI client so any messages with `images` array are formatted as image_url content parts,
  // and strictly omit the unknown `images` key to satisfy strict schema validation
  const openAiMessages = (requestPayload.messages || []).map((m) => {
    const { images, ...rest } = m;
    if (images && Array.isArray(images) && images.length > 0) {
      if (typeof m.content === 'string') {
        return {
          ...rest,
          content: [
            { type: 'text', text: m.content },
            ...images.map((b64) => ({
              type: 'image_url',
              image_url: {
                url: b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`,
              },
            })),
          ],
        };
      }
    }
    return rest;
  });

  const config = getConfig();
  const maxTokens = requestPayload.max_tokens || config.maxTokens || 4096;

  const openAiPayload = {
    ...requestPayload,
    max_tokens: maxTokens,
    messages: openAiMessages,
  };

  // If clientOverride is passed (e.g. mock test client), always use standard client.chat.completions.create
  if (clientOverride) {
    const comp = await client.chat.completions.create(openAiPayload);
    if (comp?.choices?.[0]?.message) {
      const msg = comp.choices[0].message;
      const { thinking, content } = separateThinkingAndContent(msg.content, msg.thinking);
      msg.content = content;
      msg.thinking = thinking;
    }
    return comp;
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
        keepAlive: requestPayload.keep_alive || requestPayload.keepAlive,
      });
    } catch (ollamaErr) {
      console.warn(`[LLMClient] Ollama /api/chat failed (${ollamaErr.message}), falling back to OpenAI client...`);
    }
  }

  const completion = await client.chat.completions.create(openAiPayload);
  if (completion?.choices?.[0]?.message) {
    const msg = completion.choices[0].message;
    const { thinking, content } = separateThinkingAndContent(msg.content, msg.thinking);
    msg.content = content;
    msg.thinking = thinking;
  }
  return completion;
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
