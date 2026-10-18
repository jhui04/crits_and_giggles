// Custom encounter phase names: a display-only map keyed by phase number (units keep
// referencing phases by number). Mirrors src/utils/phaseNames.ts; keep the cap in sync.
export const MAX_PHASE_NAME_LENGTH = 40;

export function cleanPhaseName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PHASE_NAME_LENGTH).trim();
}

export const DEFAULT_PHASE_COUNT = 5;

/**
 * Names must be unique per encounter (case-insensitive) and must not equal the default
 * "Phase N" of a different unnamed phase. Later phases lose; returns the offending phases.
 * Mirrors findPhaseNameConflicts in src/utils/phaseNames.ts. `names` must already be cleaned.
 */
export function findPhaseNameConflicts(names, phaseCount = DEFAULT_PHASE_COUNT) {
  const kept = { ...names };
  const conflicts = [];
  for (;;) {
    const phases = Object.keys(kept).map(Number).sort((a, b) => a - b);
    const takenBy = new Map();
    for (let m = 1; m <= phaseCount; m++) {
      if (!kept[String(m)]) takenBy.set(`Phase ${m}`.toLowerCase(), m);
    }
    let dropped = false;
    for (const n of phases) {
      const key = kept[String(n)].toLowerCase();
      const owner = takenBy.get(key);
      if (owner !== undefined && owner !== n) {
        conflicts.push({ phase: n, name: kept[String(n)], conflictsWith: owner, kind: kept[String(owner)] ? 'name' : 'default' });
        delete kept[String(n)];
        dropped = true;
        break;
      }
      if (owner === undefined) takenBy.set(key, n);
    }
    if (!dropped) break;
  }
  return conflicts.sort((a, b) => a.phase - b.phase);
}

/** Phases that exist for these units: at least the builder's default of 5. */
export function phaseCountFor(units) {
  return Math.max(DEFAULT_PHASE_COUNT, ...(Array.isArray(units) ? units : []).map((u) => Number(u?.phase) || 1));
}

/**
 * Returns a clean { "1": "Beach Fight" } object, or null when there are no custom names.
 * Duplicate names are never stored: the later phase (by number) is dropped and falls back to
 * "Phase N", so legacy/imported data and API clients can't break uniqueness or crash anything.
 */
export function normalizePhaseNames(names, phaseCount = DEFAULT_PHASE_COUNT) {
  if (!names || typeof names !== 'object' || Array.isArray(names)) return null;
  const out = {};
  for (const [key, value] of Object.entries(names)) {
    if (!/^[1-9]\d{0,3}$/.test(key)) continue;
    const name = cleanPhaseName(value);
    if (name) out[key] = name;
  }
  for (const c of findPhaseNameConflicts(out, phaseCount)) delete out[String(c.phase)];
  return Object.keys(out).length > 0 ? out : null;
}

export function phaseLabel(names, phase) {
  return cleanPhaseName(names?.[String(phase)]) || `Phase ${phase}`;
}
