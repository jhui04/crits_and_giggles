import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

// Plain-text summary for a screen reader user: one PASS / FAIL / SKIP line per
// test, the first error line for failures, the captured NVDA speech log for
// every test (attached by tests/helpers.ts), and a totals line. Written to
// stdout and to `outputFile`.
class TextSummaryReporter implements Reporter {
  private lines: string[] = [];
  private counts = { passed: 0, failed: 0, skipped: 0 };
  private outputFile: string;

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile = options.outputFile ?? path.join(process.cwd(), 'summary.txt');
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const title = test.titlePath().filter(Boolean).slice(1).join(' > ');
    const secs = (result.duration / 1000).toFixed(1);
    let status: string;
    if (result.status === 'passed') {
      status = 'PASS';
      this.counts.passed++;
    } else if (result.status === 'skipped') {
      status = 'SKIP';
      this.counts.skipped++;
    } else {
      status = 'FAIL';
      this.counts.failed++;
    }
    this.lines.push(`${status}: ${title} (${secs} s)`);
    if (status === 'FAIL') {
      const message = (result.error?.message ?? result.status).replace(/\u001b\[[0-9;]*m/g, '');
      for (const line of message.split('\n').slice(0, 12)) this.lines.push(`  error: ${line}`);
    }
    const speech = result.attachments.find((a) => a.name === 'nvda-spoken-log');
    if (speech?.body) {
      this.lines.push('  NVDA spoken log:');
      for (const line of speech.body.toString('utf8').split('\n')) {
        if (line.trim()) this.lines.push(`    ${line}`);
      }
    }
  }

  onEnd(result: FullResult) {
    this.lines.push(
      `SUMMARY: ${this.counts.passed} passed, ${this.counts.failed} failed, ${this.counts.skipped} skipped; overall ${result.status.toUpperCase()}`,
    );
    const text = this.lines.join('\n') + '\n';
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, text, 'utf8');
    process.stdout.write('\n' + text);
  }

  printsToStdio() {
    return true;
  }
}

export default TextSummaryReporter;
