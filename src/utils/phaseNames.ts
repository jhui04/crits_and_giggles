/**
 * Custom encounter phase names. Phase identity is always the phase NUMBER (stored on each unit);
 * names are a display-only map keyed by that number, so renaming never affects unit assignments.
 * Keep MAX_PHASE_NAME_LENGTH in sync with server/phaseNames.js.
 */
export type PhaseNames = Record<string, string>;

export const MAX_PHASE_NAME_LENGTH = 40;
/** The Encounter Builder offers phases 1..MAX_BUILDER_PHASES. */
export const MAX_BUILDER_PHASES = 5;

/** Trims, caps and collapses whitespace; returns '' when the name is blank. */
export function cleanPhaseName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PHASE_NAME_LENGTH).trim();
}

export interface PhaseNameConflict {
  phase: number;
  name: string;
  /** The other phase whose label (custom name or default "Phase N") this name duplicates. */
  conflictsWith: number;
  /** 'default' when it duplicates another unnamed phase's default label. */
  kind: 'name' | 'default';
}

/**
 * Names must be unique within an encounter (case-insensitive, after cleaning), and must not equal
 * the default "Phase N" label of a different unnamed phase. A phase naming itself its own default
 * is fine. Resolution is deterministic: phases are considered in ascending order and the LATER
 * offender loses (it is reported here, and dropped by normalizePhaseNames). `phaseCount` is the
 * number of phases that exist (1..phaseCount); names for higher phases still take part.
 * `names` must already be cleaned (blank entries absent). Mirrored in server/phaseNames.js.
 */
export function findPhaseNameConflicts(names: PhaseNames, phaseCount: number = MAX_BUILDER_PHASES): PhaseNameConflict[] {
  const kept: PhaseNames = { ...names };
  const conflicts: PhaseNameConflict[] = [];
  for (;;) {
    const phases = Object.keys(kept).map(Number).sort((a, b) => a - b);
    const takenBy = new Map<string, number>(); // lowercase label -> phase
    for (let m = 1; m <= phaseCount; m++) {
      if (!kept[String(m)]) takenBy.set(defaultPhaseName(m).toLowerCase(), m);
    }
    let dropped = false;
    for (const n of phases) {
      const name = kept[String(n)];
      const key = name.toLowerCase();
      const owner = takenBy.get(key);
      if (owner !== undefined && owner !== n) {
        conflicts.push({ phase: n, name, conflictsWith: owner, kind: kept[String(owner)] ? 'name' : 'default' });
        delete kept[String(n)];
        dropped = true;
        break; // defaults changed; recompute
      }
      if (owner === undefined) takenBy.set(key, n);
    }
    if (!dropped) break;
  }
  return conflicts.sort((a, b) => a.phase - b.phase);
}

/**
 * Drops blank names and non-positive-integer keys, then drops later duplicates (see
 * findPhaseNameConflicts) so stored names are always unique. Returns undefined when nothing is left.
 */
export function normalizePhaseNames(names: unknown, phaseCount: number = MAX_BUILDER_PHASES): PhaseNames | undefined {
  if (!names || typeof names !== 'object' || Array.isArray(names)) return undefined;
  const out: PhaseNames = {};
  for (const [key, value] of Object.entries(names as Record<string, unknown>)) {
    if (!/^[1-9]\d{0,3}$/.test(key)) continue;
    const name = cleanPhaseName(value);
    if (name) out[key] = name;
  }
  for (const c of findPhaseNameConflicts(out, phaseCount)) delete out[String(c.phase)];
  return Object.keys(out).length > 0 ? out : undefined;
}

export function defaultPhaseName(phase: number): string {
  return `Phase ${phase}`;
}

/** The display name for a phase: the custom name, or "Phase N" when blank/unset. */
export function phaseLabel(names: PhaseNames | null | undefined, phase: number): string {
  return cleanPhaseName(names?.[String(phase)]) || defaultPhaseName(phase);
}
