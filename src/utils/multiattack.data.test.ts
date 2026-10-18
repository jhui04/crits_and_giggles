/**
 * Runs the Multiattack parser over EVERY Multiattack in public/data/monsters.json
 * and guards a coverage floor. Set MULTIATTACK_REPORT=<file> to write a full
 * report (unparsed, partial, unresolved segments, and a sample of parses) for
 * manual review while iterating on the parser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMultiattack, isMultiattackAction } from './multiattack';
import type { MultiattackActionLike } from './multiattack';

interface DataMonster {
  name: string;
  actions?: (MultiattackActionLike & { content: string })[];
  traits?: MultiattackActionLike[];
}

const monsters: DataMonster[] = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/monsters.json'), 'utf8'));

interface Row { monster: string; text: string; parse: ReturnType<typeof parseMultiattack> }

function collect(): Row[] {
  const rows: Row[] = [];
  for (const m of monsters) {
    for (const a of m.actions ?? []) {
      if (!isMultiattackAction(a)) continue;
      rows.push({ monster: m.name, text: a.content, parse: parseMultiattack(a.content, m.actions ?? [], m.traits ?? []) });
    }
  }
  return rows;
}

/** Floors recorded after iterating against the real data (see docs). */
export const COVERAGE_FLOOR = { total: 330, parsedPct: 96, unparsedMax: 4 };

describe('Multiattack parser against public/data/monsters.json', () => {
  const rows = collect();
  const parsed = rows.filter(r => r.parse.status === 'parsed');
  const partial = rows.filter(r => r.parse.status === 'partial');
  const unparsed = rows.filter(r => r.parse.status === 'unparsed');

  if (process.env.MULTIATTACK_REPORT) {
    const lines: string[] = [];
    lines.push(`TOTAL ${rows.length} parsed ${parsed.length} partial ${partial.length} unparsed ${unparsed.length}`);
    for (const [title, list] of [['UNPARSED', unparsed], ['PARTIAL', partial]] as const) {
      lines.push(`\n=== ${title} ===`);
      for (const r of list) lines.push(`${r.monster}: ${r.text}\n   -> unresolved=${JSON.stringify(r.parse.unresolved)} options=${JSON.stringify(r.parse.options.map(o => o.label))} notes=${JSON.stringify(r.parse.notes)}`);
    }
    lines.push('\n=== PARSED (all) ===');
    for (const r of parsed) lines.push(`${r.monster}: ${r.text}\n   -> ${r.parse.options.map(o => (o.condition ? `[${o.condition}] ` : '') + o.label).join('  ||  ')}${r.parse.notes.length ? '   NOTES: ' + r.parse.notes.join(' / ') : ''}`);
    writeFileSync(process.env.MULTIATTACK_REPORT, lines.join('\n'));
  }

  it('finds every Multiattack in the data', () => {
    expect(rows.length).toBeGreaterThanOrEqual(COVERAGE_FLOOR.total);
  });

  it('never throws and every parse has a consistent shape', () => {
    for (const r of rows) {
      expect(['parsed', 'partial', 'unparsed']).toContain(r.parse.status);
      if (r.parse.status !== 'unparsed') expect(r.parse.options.length).toBeGreaterThan(0);
      for (const o of r.parse.options) {
        expect(o.segments.length).toBeGreaterThan(0);
        for (const s of o.segments) expect(s.count).toBeGreaterThan(0);
      }
    }
  });

  it('meets the coverage floor', () => {
    const pct = (parsed.length / rows.length) * 100;
    expect(pct).toBeGreaterThanOrEqual(COVERAGE_FLOOR.parsedPct);
    expect(unparsed.length).toBeLessThanOrEqual(COVERAGE_FLOOR.unparsedMax);
  });

  it('every resolved segment names a real action on its monster', () => {
    for (const m of monsters) {
      const names = new Set((m.actions ?? []).concat((m.traits ?? []) as never).map(a => a.name.replace(/\([^)]*\)/g, ' ').replace(/[.:]+\s*$/, '').replace(/\s+/g, ' ').trim()));
      for (const a of m.actions ?? []) {
        if (!isMultiattackAction(a)) continue;
        const p = parseMultiattack(a.content, m.actions ?? [], m.traits ?? []);
        for (const o of p.options) for (const s of o.segments) {
          if (s.actionName) expect(names.has(s.actionName), `${m.name}: ${s.actionName}`).toBe(true);
        }
      }
    }
  });
});
