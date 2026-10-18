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

/** Drops blank names and non-positive-integer keys. Returns undefined when nothing is left. */
export function normalizePhaseNames(names: unknown): PhaseNames | undefined {
  if (!names || typeof names !== 'object' || Array.isArray(names)) return undefined;
  const out: PhaseNames = {};
  for (const [key, value] of Object.entries(names as Record<string, unknown>)) {
    if (!/^[1-9]\d{0,3}$/.test(key)) continue;
    const name = cleanPhaseName(value);
    if (name) out[key] = name;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function defaultPhaseName(phase: number): string {
  return `Phase ${phase}`;
}

/** The display name for a phase: the custom name, or "Phase N" when blank/unset. */
export function phaseLabel(names: PhaseNames | null | undefined, phase: number): string {
  return cleanPhaseName(names?.[String(phase)]) || defaultPhaseName(phase);
}
