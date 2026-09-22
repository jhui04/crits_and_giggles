import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initMemoryDatabaseFromSeed } from './dbCloner.js';
import { BASE_EVAL_CASES, BONUS_EVAL_CASES, ALL_EVAL_CASES } from './eval_cases.js';
import { parseJudgeJson, judgeAnswer } from './judge.js';
import { runGenerationPhase, runJudgingPhase, runEvalSuite } from './run_evals.js';
import { seedEvalDatabase } from '../../tools/seed_eval_db.js';
import { db } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEST_SEED_PATH = path.resolve(ROOT_DIR, 'test_seed.sqlite');
const TEST_CACHE_PATH = path.resolve(ROOT_DIR, 'test_eval_cache.json');
const TEST_REPORT_PATH = path.resolve(ROOT_DIR, 'test_eval_report.json');

describe('Live-Data LLM Evaluation Implementation (plan.md)', () => {
  beforeAll(async () => {
    // Ensure test_seed.sqlite exists
    if (!fs.existsSync(TEST_SEED_PATH)) {
      await seedEvalDatabase(TEST_SEED_PATH);
    }
  });

  describe('Step 1: Database "Golden Image" Seeding & Instant Memory Cloning', () => {
    it('creates test_seed.sqlite containing campaigns, chapters, encounters, and units', () => {
      expect(fs.existsSync(TEST_SEED_PATH)).toBe(true);
      const stat = fs.statSync(TEST_SEED_PATH);
      expect(stat.size).toBeGreaterThan(100000); // multiple megabytes with vector chunks
    });

    it('instantaneously clones seed database into :memory: in milliseconds', () => {
      const { db: memDb, durationMs } = initMemoryDatabaseFromSeed(TEST_SEED_PATH);
      expect(durationMs).toBeLessThan(100); // Must be sub-100ms (typically ~10ms)

      // Verify canonical evaluation state in overridden db
      const campaign = db.prepare('SELECT id, name FROM campaigns WHERE id = ?').get('test-campaign');
      expect(campaign).toBeDefined();
      expect(campaign.name).toBe('Test Campaign');

      const encounter = db.prepare('SELECT id, name, running_state FROM encounters WHERE id = ?').get('enc-palma-flora');
      expect(encounter).toBeDefined();
      expect(encounter.name).toBe('Palma Flora Shoreline Ambush');

      const units = db.prepare('SELECT name, currentHp, maxHp, isPlayer FROM encounter_units WHERE encounter_id = ?').all('enc-palma-flora');
      expect(units.length).toBeGreaterThanOrEqual(2);
      expect(units.some((u) => u.name === 'Grog Strongjaw' && u.isPlayer === 1)).toBe(true);
      expect(units.some((u) => u.name === 'Sahuagin Raider' && u.isPlayer === 0)).toBe(true);
    });
  });

  describe('Step 2: Predefined Evaluation Test Cases (Base & Bonus Tools)', () => {
    it('defines base eval cases outlined in plan.md', () => {
      expect(BASE_EVAL_CASES).toHaveLength(2);
      const mapCase = BASE_EVAL_CASES.find((c) => c.id === 'eval-1-map');
      expect(mapCase).toBeDefined();
      expect(mapCase.expectedTool).toBe('get_current_map');
      expect(mapCase.expectedFact).toContain('Sahuagin Raider is closest to Grog');

      const spellCase = BASE_EVAL_CASES.find((c) => c.id === 'eval-2-spell');
      expect(spellCase).toBeDefined();
      expect(spellCase.expectedTool).toBe('lookup_spell');
      expect(spellCase.expectedFact).toContain('1 action');
    });

    it('defines bonus eval cases covering all core assistant tools', () => {
      expect(BONUS_EVAL_CASES.length).toBeGreaterThanOrEqual(6);
      const expectedTools = BONUS_EVAL_CASES.map((c) => c.expectedTool);
      expect(expectedTools).toContain('lookup_monster');
      expect(expectedTools).toContain('get_monster_hp');
      expect(expectedTools).toContain('get_character_hp');
      expect(expectedTools).toContain('get_initiative_order');
      expect(expectedTools).toContain('lookup_magic_item');
      expect(expectedTools).toContain('get_campaign_asset');
      expect(expectedTools).toContain('get_chapter_outline');
    });
  });

  describe('Step 3: Judge JSON Parser & LLM-as-a-judge Evaluation', () => {
    it('parses valid JSON judge output', () => {
      const raw = '{"grade": "PASS", "reason": "The assistant accurately specified 1 action."}';
      const parsed = parseJudgeJson(raw);
      expect(parsed.grade).toBe('PASS');
      expect(parsed.reason).toContain('1 action');
    });

    it('handles markdown fences and whitespace around JSON output', () => {
      const raw = '```json\n{"grade": "FAIL", "reason": "Did not state the casting time."}\n```';
      const parsed = parseJudgeJson(raw);
      expect(parsed.grade).toBe('FAIL');
      expect(parsed.reason).toContain('casting time');
    });

    it('recovers from extra commentary before or after JSON', () => {
      const raw = 'Here is the evaluation result:\n{"grade": "PASS", "reason": "Found Sahuagin Raider closest."}\nDone.';
      const parsed = parseJudgeJson(raw);
      expect(parsed.grade).toBe('PASS');
      expect(parsed.reason).toContain('Sahuagin Raider');
    });

    it('evaluates answers using deterministic mock judge in offline mode', async () => {
      const resPass = await judgeAnswer({
        query: 'What is the casting time for Fireball?',
        expectedFact: 'The casting time is 1 action.',
        actualAnswer: 'The casting time for Fireball is 1 action.',
        mock: true,
      });
      expect(resPass.grade).toBe('PASS');

      const resFail = await judgeAnswer({
        query: 'What is the casting time for Fireball?',
        expectedFact: 'The casting time is 1 action.',
        actualAnswer: 'Fireball is an evocation spell with a range of 150 feet.',
        mock: true,
      });
      expect(resFail.grade).toBe('FAIL');
    });
  });

  describe('Step 4: Two-Phase Batch Architecture Execution', () => {
    it('executes Phase 1 (Generation) and asserts deterministic tool execution', async () => {
      const genResults = await runGenerationPhase({
        cases: BASE_EVAL_CASES,
        modelA: 'qwen3.5:9b',
        mock: true,
        cachePath: TEST_CACHE_PATH,
        seedPath: TEST_SEED_PATH,
      });

      expect(genResults).toHaveLength(2);
      expect(genResults[0].toolPassed).toBe(true);
      expect(genResults[0].executedTools).toContain('get_current_map');
      expect(genResults[1].toolPassed).toBe(true);
      expect(genResults[1].executedTools).toContain('lookup_spell');
      expect(fs.existsSync(TEST_CACHE_PATH)).toBe(true);
    });

    it('executes Phase 2 (Judging) against cached results and produces report', async () => {
      const report = await runJudgingPhase({
        modelB: 'llama3',
        mock: true,
        cachePath: TEST_CACHE_PATH,
        reportPath: TEST_REPORT_PATH,
      });

      expect(report.totalCount).toBe(2);
      expect(report.passCount).toBe(2);
      expect(report.failCount).toBe(0);
      expect(fs.existsSync(TEST_REPORT_PATH)).toBe(true);
    });

    it('runs the complete evaluation suite with all base and bonus cases', async () => {
      const summary = await runEvalSuite({
        cases: ALL_EVAL_CASES,
        mock: true,
        cachePath: TEST_CACHE_PATH,
        reportPath: TEST_REPORT_PATH,
      });

      expect(summary.totalCount).toBe(ALL_EVAL_CASES.length);
      expect(summary.passCount).toBe(ALL_EVAL_CASES.length);
      expect(summary.failCount).toBe(0);
      expect(summary.results.every((r) => r.finalStatus === 'PASS')).toBe(true);

      // Clean up test temp files
      if (fs.existsSync(TEST_CACHE_PATH)) fs.unlinkSync(TEST_CACHE_PATH);
      if (fs.existsSync(TEST_REPORT_PATH)) fs.unlinkSync(TEST_REPORT_PATH);
    });
  });
});
