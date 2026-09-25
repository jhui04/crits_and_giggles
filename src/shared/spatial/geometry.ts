import type { Cell } from './types.ts';

export interface Point2D {
  x: number;
  y: number;
}

/** Strict-interior intersection test of segment PQ against segment AB (touching endpoints of PQ do not count). */
export function segmentsIntersect(p: Point2D, q: Point2D, a: Point2D, b: Point2D, epsilon = 0.001): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const daX = b.x - a.x;
  const daY = b.y - a.y;
  const denom = dx * daY - dy * daX;
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((a.x - p.x) * daY - (a.y - p.y) * daX) / denom;
  const u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / denom;
  return t > epsilon && t < 1 - epsilon && u >= -epsilon && u <= 1 + epsilon;
}

/** Signed side of point p relative to the directed line a -> b (screen coordinates, y down). */
export function sideOf(a: Point2D, b: Point2D, p: Point2D): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

export function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function cellCenter(c: Cell): Point2D {
  return { x: c.x + 0.5, y: c.y + 0.5 };
}

/** Compass direction from `from` to `to`; north is up (y decreases). */
export function direction(from: Cell, to: Cell): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 'Self';
  const angle = Math.atan2(-dy, dx) * (180 / Math.PI);
  const n = (angle + 360) % 360;
  if (n >= 22.5 && n < 67.5) return 'North-East';
  if (n >= 67.5 && n < 112.5) return 'North';
  if (n >= 112.5 && n < 157.5) return 'North-West';
  if (n >= 157.5 && n < 202.5) return 'West';
  if (n >= 202.5 && n < 247.5) return 'South-West';
  if (n >= 247.5 && n < 292.5) return 'South';
  if (n >= 292.5 && n < 337.5) return 'South-East';
  return 'East';
}

export const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
