import type { Cell } from './types.ts';

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnIndexToLabel(index: number): string {
  if (index < 0 || typeof index !== 'number' || !Number.isFinite(index)) return '';
  let label = '';
  let num = index;
  while (num >= 0) {
    label = String.fromCharCode((num % 26) + 65) + label;
    num = Math.floor(num / 26) - 1;
  }
  return label;
}

/** (0, 0) -> "A1". */
export function cellLabel(c: Cell): string {
  return `${columnIndexToLabel(c.x)}${c.y + 1}`;
}

export function columnLabelToIndex(label: string): number {
  const upper = (label || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) return -1;
  let index = 0;
  for (let i = 0; i < upper.length; i++) index = index * 26 + (upper.charCodeAt(i) - 64);
  return index - 1;
}

/** "K20" -> {x: 10, y: 19}; also accepts "x,y". Returns null when unparseable. */
export function parseCellLabel(label: string): Cell | null {
  const t = (label || '').trim();
  const comma = t.match(/^(\d+)\s*,\s*(\d+)$/);
  if (comma) return { x: parseInt(comma[1], 10), y: parseInt(comma[2], 10) };
  const alpha = t.match(/^([A-Za-z]+)\s*[-_]?\s*(\d+)$/);
  if (!alpha) return null;
  const row = parseInt(alpha[2], 10);
  if (row < 1) return null;
  const x = columnLabelToIndex(alpha[1]);
  return x < 0 ? null : { x, y: row - 1 };
}

export function cellKey(c: Cell): string {
  return `${c.x},${c.y}`;
}

export function parseCellKey(k: string): Cell {
  const [x, y] = k.split(',');
  return { x: parseInt(x, 10), y: parseInt(y, 10) };
}
