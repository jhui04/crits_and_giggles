import { getConfig, validateModel } from '../assistant/config.js';
import { callOllamaNativeChat } from '../assistant/llmClient.js';

/**
 * Robustly parses and sanitizes the JSON output from the judge model.
 * Handles markdown code fences (```json ... ```) and loose syntax.
 */
export function parseJudgeJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { grade: 'FAIL', reason: 'Empty or invalid response from judge' };
  }

  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const grade = String(parsed.grade || '').toUpperCase().trim();
    if (grade === 'PASS' || grade === 'FAIL') {
      return { grade, reason: parsed.reason || '' };
    }
    if (/pass/i.test(grade)) {
      return { grade: 'PASS', reason: parsed.reason || '' };
    }
    return { grade: 'FAIL', reason: parsed.reason || `Invalid grade value: "${parsed.grade}"` };
  } catch (err) {
    // Attempt fallback extraction of {"grade": ...} from text
    const match = cleaned.match(/\{[\s\S]*?"grade"\s*:\s*"?(PASS|FAIL)"?[\s\S]*?\}/i);
    if (match) {
      try {
        const fallback = JSON.parse(match[0]);
        return {
          grade: String(fallback.grade || 'FAIL').toUpperCase().trim(),
          reason: fallback.reason || '',
        };
      } catch {}
    }
    return { grade: 'FAIL', reason: `Failed to parse judge JSON: ${err.message}` };
  }
}

/**
 * Evaluates an assistant answer against an expected fact using Model B as an LLM judge.
 * Enforces Ollama's format: 'json' parameter and structured schema.
 */
export async function judgeAnswer({
  model = 'llama3',
  query,
  expectedFact,
  actualAnswer,
  mock = false,
  baseURL = undefined,
}) {
  if (mock) {
    // Simulated judge for deterministic offline evaluation and CI
    const normalizedFact = expectedFact.toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const normalizedAnswer = actualAnswer.toLowerCase().replace(/[^a-z0-9]/g, ' ');

    const factKeywords = normalizedFact
      .split(/\s+/)
      .filter((w) => w.length > 2 && !['the', 'and', 'for', 'are', 'was', 'has'].includes(w));

    const matches = factKeywords.filter((kw) => normalizedAnswer.includes(kw));
    const matchRatio = factKeywords.length > 0 ? matches.length / factKeywords.length : 1;

    const isPass = matchRatio >= 0.5;
    return {
      grade: isPass ? 'PASS' : 'FAIL',
      reason: isPass
        ? `Mock Judge: Answer supplied key facts (${matches.join(', ')}).`
        : `Mock Judge: Missing expected facts from "${expectedFact}".`,
      rawOutput: JSON.stringify({
        grade: isPass ? 'PASS' : 'FAIL',
        reason: isPass ? 'Verified expected fact.' : 'Failed fact match.',
      }),
      modelUsed: model,
    };
  }

  validateModel(model);
  const config = getConfig();
  const effectiveBaseUrl = baseURL || config.baseURL;

  const judgePrompt = `You are an expert evaluator. Review the Answer provided by the AI Assistant.
Question: ${query}
Expected Fact: ${expectedFact}
Actual Answer: ${actualAnswer}

Did the Actual Answer accurately provide the Expected Fact?
Output strictly a JSON object adhering to this schema:
{"grade": "PASS" | "FAIL", "reason": "<brief explanation>"}`;

  const messages = [
    {
      role: 'system',
      content: 'You are a strict, objective evaluation judge. You only respond with JSON matching {"grade": "PASS" | "FAIL", "reason": "..."}.',
    },
    { role: 'user', content: judgePrompt },
  ];

  const response = await callOllamaNativeChat({
    baseURL: effectiveBaseUrl,
    model,
    messages,
    format: 'json',
    temperature: 0.1,
  });

  const rawText = response.choices[0]?.message?.content || '';
  const parsed = parseJudgeJson(rawText);

  return {
    grade: parsed.grade,
    reason: parsed.reason,
    rawOutput: rawText,
    modelUsed: model,
    metrics: response.metrics || null,
  };
}
