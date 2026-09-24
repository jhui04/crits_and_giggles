#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initMemoryDatabaseFromSeed } from './dbCloner.js';
import { BASE_EVAL_CASES, BONUS_EVAL_CASES, ALL_EVAL_CASES } from './eval_cases.js';
import { handleAssistantChat } from '../assistant/orchestrator.js';
import { setConfig, getConfig } from '../assistant/config.js';
import { judgeAnswer } from './judge.js';
import { seedEvalDatabase } from '../../tools/seed_eval_db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_CACHE_PATH = path.resolve(ROOT_DIR, 'eval_results_cache.json');
const DEFAULT_REPORT_PATH = path.resolve(ROOT_DIR, 'eval_report.json');
const DEFAULT_SEED_PATH = path.resolve(ROOT_DIR, 'test_seed.sqlite');

/**
 * Phase 1: Generation Phase (Model A)
 * Executes assistant chat for each eval case against in-memory SQLite clone.
 * Performs deterministic tool selection assertion and caches outputs.
 */
export async function runGenerationPhase({
  cases = BASE_EVAL_CASES,
  modelA = 'qwen3.5:9b',
  mock = false,
  cachePath = DEFAULT_CACHE_PATH,
  seedPath = DEFAULT_SEED_PATH,
} = {}) {
  console.log(`\n======================================================`);
  console.log(`PHASE 1: Generation (Model A: ${modelA}${mock ? ' [MOCK]' : ''})`);
  console.log(`======================================================`);

  if (!fs.existsSync(seedPath)) {
    console.log(`[EvalRunner] Seed file not found at ${seedPath}. Generating golden image...`);
    await seedEvalDatabase(seedPath);
  }

  // Instant in-memory clone of golden database
  const { durationMs: cloneMs } = initMemoryDatabaseFromSeed(seedPath);
  console.log(`[EvalRunner] Cloned golden database into :memory: in ${cloneMs}ms.`);

  // Set active model for generation
  if (!mock) {
    setConfig({ activeModel: modelA });
  }

  const generationResults = [];

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    console.log(`\n[${i + 1}/${cases.length}] Running Case: ${testCase.id}`);
    console.log(`  Query: "${testCase.query}"`);
    console.log(`  Expected Tool: "${testCase.expectedTool}"`);

    const start = performance.now();
    try {
      let response;
      if (mock) {
        // Deterministic mock generation supplying toolCalls and expected facts
        response = {
          answer: `The expected answer for "${testCase.query}" is that ${testCase.expectedFact}`,
          toolCalls: [{ toolName: testCase.expectedTool, args: {}, result: { success: true } }],
          executedTools: [testCase.expectedTool],
          modelUsed: modelA,
          metrics: { eval_count: 35, total_duration: 50000000 },
        };
      } else {
        response = await handleAssistantChat({
          query: testCase.query,
          campaignId: testCase.campaignId,
          encounterId: testCase.encounterId,
          model: modelA,
        });
      }

      const durationMs = Math.round(performance.now() - start);
      const executedTools = response.executedTools || (response.toolCalls || []).map((t) => t.toolName);
      // Some tools overlap by design; a case may list equivalent alternatives that return the
      // same authoritative data. The judge phase still verifies the final answer's facts.
      const acceptedTools = [testCase.expectedTool, ...(testCase.acceptableTools || [])];
      const toolPassed = acceptedTools.some((t) => executedTools.includes(t));

      console.log(`  Executed Tools: [${executedTools.join(', ') || 'None'}]`);
      console.log(`  Tool Assertion: ${toolPassed ? 'PASS' : 'FAIL (Tool Selection)'}`);

      generationResults.push({
        id: testCase.id,
        query: testCase.query,
        campaignId: testCase.campaignId || null,
        encounterId: testCase.encounterId || null,
        expectedTool: testCase.expectedTool,
        expectedFact: testCase.expectedFact,
        category: testCase.category || 'core',
        modelUsed: response.modelUsed || modelA,
        executedTools,
        toolPassed,
        toolStatus: toolPassed ? 'PASS' : 'FAIL',
        errorReason: toolPassed ? null : `Expected tool "${testCase.expectedTool}" was not called. Got [${executedTools.join(', ')}].`,
        finalAnswer: response.answer,
        generationDurationMs: durationMs,
        metrics: response.metrics || null,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      console.error(`  Generation Error: ${err.message}`);
      generationResults.push({
        id: testCase.id,
        query: testCase.query,
        expectedTool: testCase.expectedTool,
        expectedFact: testCase.expectedFact,
        category: testCase.category || 'core',
        modelUsed: modelA,
        executedTools: [],
        toolPassed: false,
        toolStatus: 'FAIL',
        errorReason: `Orchestrator threw error: ${err.message}`,
        finalAnswer: '',
        generationDurationMs: durationMs,
      });
    }
  }

  // Cache results to file for Phase 2
  fs.writeFileSync(cachePath, JSON.stringify(generationResults, null, 2), 'utf-8');
  console.log(`\n[EvalRunner] Generation phase complete. Cached ${generationResults.length} results to: ${cachePath}`);
  return generationResults;
}

/**
 * Phase 2: Evaluation / Judging Phase (Model B)
 * Evaluates cached Model A answers using Model B as an LLM judge.
 * Respects strict single-model VRAM constraints by switching model in batch.
 */
export async function runJudgingPhase({
  modelB = 'llama3',
  mock = false,
  cachePath = DEFAULT_CACHE_PATH,
  reportPath = DEFAULT_REPORT_PATH,
} = {}) {
  console.log(`\n======================================================`);
  console.log(`PHASE 2: Evaluation / Judging (Model B: ${modelB}${mock ? ' [MOCK]' : ''})`);
  console.log(`======================================================`);

  if (!fs.existsSync(cachePath)) {
    throw new Error(`Cache file not found at ${cachePath}. Run Phase 1 first.`);
  }

  const cachedResults = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  console.log(`[EvalRunner] Loaded ${cachedResults.length} test generations from cache.`);

  // Switch active model to Model B
  if (!mock) {
    setConfig({ activeModel: modelB });
  }

  const evaluationResults = [];

  for (let i = 0; i < cachedResults.length; i++) {
    const item = cachedResults[i];
    console.log(`\n[${i + 1}/${cachedResults.length}] Judging Case: ${item.id}`);

    // If tool assertion failed in Phase 1, fail immediately without wasting tokens on judge
    if (!item.toolPassed) {
      console.log(`  Skipping LLM Judge: Tool selection failed in Phase 1.`);
      evaluationResults.push({
        ...item,
        judgeGrade: 'SKIP',
        judgeReason: item.errorReason,
        finalStatus: 'FAIL (Tool Selection)',
      });
      continue;
    }

    console.log(`  Expected Fact: "${item.expectedFact}"`);
    console.log(`  Answer Preview: "${item.finalAnswer.slice(0, 100).replace(/\n/g, ' ')}..."`);

    const start = performance.now();
    try {
      const judgment = await judgeAnswer({
        model: modelB,
        query: item.query,
        expectedFact: item.expectedFact,
        actualAnswer: item.finalAnswer,
        mock,
      });

      const judgeDurationMs = Math.round(performance.now() - start);
      const isPass = judgment.grade === 'PASS';
      console.log(`  Judge Grade: ${judgment.grade} in ${judgeDurationMs}ms`);
      console.log(`  Judge Reason: ${judgment.reason}`);

      evaluationResults.push({
        ...item,
        judgeModel: judgment.modelUsed || modelB,
        judgeGrade: judgment.grade,
        judgeReason: judgment.reason,
        judgeDurationMs,
        finalStatus: isPass ? 'PASS' : 'FAIL (Fact Verification)',
      });
    } catch (err) {
      console.error(`  Judge Error: ${err.message}`);
      evaluationResults.push({
        ...item,
        judgeModel: modelB,
        judgeGrade: 'FAIL',
        judgeReason: `Judge call failed: ${err.message}`,
        finalStatus: 'FAIL (Judge Error)',
      });
    }
  }

  // Write final evaluation report
  const passCount = evaluationResults.filter((r) => r.finalStatus === 'PASS').length;
  const failCount = evaluationResults.length - passCount;

  const report = {
    timestamp: new Date().toISOString(),
    passCount,
    failCount,
    totalCount: evaluationResults.length,
    successRate: `${((passCount / evaluationResults.length) * 100).toFixed(1)}%`,
    results: evaluationResults,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n[EvalRunner] Final evaluation report written to: ${reportPath}`);

  return report;
}

/**
 * Executes the complete Two-Phase Batch Evaluation Suite.
 */
export async function runEvalSuite({
  cases = BASE_EVAL_CASES,
  modelA = 'qwen3.5:9b',
  modelB = 'llama3',
  mock = false,
  cachePath = DEFAULT_CACHE_PATH,
  reportPath = DEFAULT_REPORT_PATH,
  seedPath = DEFAULT_SEED_PATH,
} = {}) {
  const overallStart = performance.now();

  console.log(`\n======================================================`);
  console.log(`Crits & Giggles - Live-Data LLM Evaluation Suite`);
  console.log(`======================================================`);
  console.log(`Test Cases: ${cases.length}`);
  console.log(`Model A (Generator): ${modelA}`);
  console.log(`Model B (Judge):     ${modelB}`);
  console.log(`Execution Mode:      ${mock ? 'MOCK / SIMULATED' : 'LIVE OLLAMA'}`);
  console.log(`VRAM Constraint:     Two-Phase Batch (Strict 1-model-in-memory)`);
  console.log(`======================================================\n`);

  // Phase 1: Generation
  await runGenerationPhase({
    cases,
    modelA,
    mock,
    cachePath,
    seedPath,
  });

  // Phase 2: Judging
  const report = await runJudgingPhase({
    modelB,
    mock,
    cachePath,
    reportPath,
  });

  const totalDurationMs = Math.round(performance.now() - overallStart);

  // Print Formatted Console Summary Table
  console.log(`\n======================================================`);
  console.log(`EVALUATION SUITE SUMMARY REPORT`);
  console.log(`======================================================`);

  console.table(
    report.results.map((r) => ({
      ID: r.id,
      Tool: `${r.expectedTool} (${r.toolStatus})`,
      'Judge Grade': r.judgeGrade,
      'Final Status': r.finalStatus,
      'Gen Time': `${r.generationDurationMs || 0}ms`,
      Reason: (r.judgeReason || r.errorReason || '').slice(0, 40) + '...',
    }))
  );

  console.log(`\nTotal Test Cases: ${report.totalCount}`);
  console.log(`Passed:           ${report.passCount} (${report.successRate})`);
  console.log(`Failed:           ${report.failCount}`);
  console.log(`Total Duration:   ${(totalDurationMs / 1000).toFixed(2)}s\n`);

  return {
    ...report,
    totalDurationMs,
  };
}

// CLI Execution
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const isMock = process.argv.includes('--mock');
  const isBonus = process.argv.includes('--bonus') || process.argv.includes('--all');
  const isQuick = process.argv.includes('--quick') || process.argv.includes('--core');

  let casesToRun = BASE_EVAL_CASES;
  if (isBonus || (!isQuick && process.argv.includes('--full'))) {
    casesToRun = ALL_EVAL_CASES;
  } else if (process.argv.includes('--bonus-only')) {
    casesToRun = BONUS_EVAL_CASES;
  }

  const modelAArgIndex = process.argv.indexOf('--model-a');
  const modelBArgIndex = process.argv.indexOf('--model-b');

  const modelA = modelAArgIndex !== -1 ? process.argv[modelAArgIndex + 1] : 'qwen3.5:9b';
  const modelB = modelBArgIndex !== -1 ? process.argv[modelBArgIndex + 1] : 'llama3';

  runEvalSuite({
    cases: casesToRun,
    modelA,
    modelB,
    mock: isMock,
  })
    .then((summary) => {
      if (summary.failCount > 0) {
        console.error(`❌ Evaluation suite failed with ${summary.failCount} failure(s).`);
        process.exit(1);
      } else {
        console.log(`✅ All ${summary.passCount} evaluation tests passed successfully!`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running evaluation suite:', err);
      process.exit(1);
    });
}
