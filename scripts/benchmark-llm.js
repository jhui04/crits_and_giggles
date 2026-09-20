#!/usr/bin/env node
import { runFullBenchmark } from '../server/assistant/benchmark.js';

const isMock = process.argv.includes('--mock');
let models = ['qwen3.5:9b', 'qwen3.5:4b', 'llama3'];

if (process.argv.includes('--quick')) {
  models = ['qwen3.5:4b'];
} else if (process.argv.includes('--llama') || process.argv.includes('--llama3')) {
  models = ['llama3'];
} else if (process.argv.includes('--qwen')) {
  models = ['qwen3.5:9b', 'qwen3.5:4b'];
}

console.log('Running LLM Benchmark & Telemetry for Crits & Giggles Oracle...');
if (isMock) {
  console.log('(Running in simulated mock mode for deterministic verification)');
}

runFullBenchmark({ models, mock: isMock })
  .then((results) => {
    console.log('\n=== Benchmark & Telemetry Summary ===');
    console.table(
      results.map((r) => {
        const vramMb = r.vramBytes ? `${(r.vramBytes / (1024 * 1024)).toFixed(1)} MB` : 'N/A';
        const totalMb = r.totalBytes ? `${(r.totalBytes / (1024 * 1024)).toFixed(1)} MB` : 'N/A';
        return {
          Model: r.model,
          Query: r.query.length > 25 ? r.query.slice(0, 22) + '...' : r.query,
          'Cold Start / TTFT (ms)': r.ttftMs ?? 'N/A',
          'TPS (tok/s)': r.tps ?? 'N/A',
          'VRAM Footprint': vramMb,
          'Total Memory': totalMb,
          Tokens: r.totalTokens ?? 'N/A',
          Status: r.error ? `Error: ${r.error}` : 'Success',
        };
      })
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
