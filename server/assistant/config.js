/**
 * LLM Configuration & Model Selection
 * Manages model choices, fallbacks, and strict VRAM hardware guards (<8GB VRAM).
 */

// Upper bounds keep a bad setting from requesting an absurd generation length or
// context window that would blow past the 8GB VRAM budget.
export const MAX_TOKENS_LIMIT = 16384;
export const NUM_CTX_LIMIT = 32768;

export const DEFAULT_CONFIG = {
  baseURL: process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY || 'ollama',
  primaryModel: 'qwen3.5:9b',
  fallbackModel: 'qwen3.5:4b',
  activeModel: 'qwen3.5:9b',
  embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
  maxContextTokens: 8192,
  topKPassages: 3,
  maxToolIterations: 20,
  keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
  maxTokens: Math.min(parseInt(process.env.LLM_MAX_TOKENS, 10) || 4096, MAX_TOKENS_LIMIT),
  numCtx: Math.min(parseInt(process.env.LLM_NUM_CTX, 10) || 16384, NUM_CTX_LIMIT),
  requestTimeoutMs: parseInt(process.env.LLM_REQUEST_TIMEOUT_MS, 10) || 300000,
};

/**
 * Coerces a numeric setting with Number() and rejects NaN/Infinity instead of
 * silently ignoring or storing it.
 */
function toFiniteNumber(name, value) {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Config "${name}" must be a finite number (received ${JSON.stringify(value)}).`);
  }
  return n;
}

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// Disallowed models: explicitly exclude 26B, 32B, 35B, 70B models which exceed 8GB VRAM budget
const EXCLUDED_MODEL_PATTERNS = [
  /26b/i,
  /32b/i,
  /35b/i,
  /70b/i,
  /command-r\+/i,
  /deepseek.*33b/i,
  /llama.*70b/i
];

const ALLOWED_MODELS = [
  'qwen3.5:9b',
  'qwen3.5-9b',
  'qwen3.5:4b',
  'qwen3.5-4b',
  'qwen2.5:7b',
  'qwen2.5:3b',
  'llama3',
  'llama3:latest',
  'llama3:8b',
  'llama3.1:8b',
  'llama3.2:3b',
  'llama3.2:1b',
  'mock-test-model'
];

let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Validates whether a model is permissible under the 8GB VRAM budget.
 * Throws or returns an error if a 26B/35B or oversized model is requested.
 */
export function validateModel(modelName) {
  if (!modelName || typeof modelName !== 'string') {
    throw new Error('Model name must be a non-empty string');
  }

  const trimmed = modelName.trim();

  for (const pattern of EXCLUDED_MODEL_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(
        `Model "${trimmed}" is explicitly excluded: Exceeds 8GB VRAM budget. Models with 26B+ or 35B parameters cannot run on target hardware.`
      );
    }
  }

  return true;
}

export function getConfig() {
  return { ...currentConfig, allowedModels: [...ALLOWED_MODELS] };
}

export function setConfig(newConfig = {}) {
  if (newConfig.activeModel) {
    validateModel(newConfig.activeModel);
    currentConfig.activeModel = newConfig.activeModel.trim();
  }
  if (newConfig.primaryModel) {
    validateModel(newConfig.primaryModel);
    currentConfig.primaryModel = newConfig.primaryModel.trim();
  }
  if (newConfig.fallbackModel) {
    validateModel(newConfig.fallbackModel);
    currentConfig.fallbackModel = newConfig.fallbackModel.trim();
  }
  if (newConfig.baseURL) {
    currentConfig.baseURL = newConfig.baseURL.trim();
  }
  if (newConfig.apiKey) {
    currentConfig.apiKey = newConfig.apiKey.trim();
  }
  if (newConfig.embeddingModel) {
    currentConfig.embeddingModel = newConfig.embeddingModel.trim();
  }
  if (newConfig.maxContextTokens !== undefined && newConfig.maxContextTokens !== null) {
    currentConfig.maxContextTokens = clamp(toFiniteNumber('maxContextTokens', newConfig.maxContextTokens), 2048, 16384);
  }
  if (newConfig.topKPassages !== undefined && newConfig.topKPassages !== null) {
    currentConfig.topKPassages = clamp(Math.floor(toFiniteNumber('topKPassages', newConfig.topKPassages)), 1, 10);
  }
  if (newConfig.maxToolIterations !== undefined && newConfig.maxToolIterations !== null) {
    currentConfig.maxToolIterations = clamp(Math.floor(toFiniteNumber('maxToolIterations', newConfig.maxToolIterations)), 1, 50);
  }
  if (newConfig.keepAlive !== undefined) {
    currentConfig.keepAlive = String(newConfig.keepAlive).trim();
  }
  if (newConfig.maxTokens !== undefined && newConfig.maxTokens !== null) {
    currentConfig.maxTokens = clamp(Math.floor(toFiniteNumber('maxTokens', newConfig.maxTokens)), 512, MAX_TOKENS_LIMIT);
  }
  if (newConfig.numCtx !== undefined && newConfig.numCtx !== null) {
    currentConfig.numCtx = clamp(Math.floor(toFiniteNumber('numCtx', newConfig.numCtx)), 2048, NUM_CTX_LIMIT);
  }
  if (newConfig.requestTimeoutMs !== undefined && newConfig.requestTimeoutMs !== null) {
    currentConfig.requestTimeoutMs = clamp(Math.floor(toFiniteNumber('requestTimeoutMs', newConfig.requestTimeoutMs)), 1000, 1800000);
  }

  return getConfig();
}

export function resetConfig() {
  currentConfig = { ...DEFAULT_CONFIG };
  return getConfig();
}
