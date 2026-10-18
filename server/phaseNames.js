// Custom encounter phase names: a display-only map keyed by phase number (units keep
// referencing phases by number). Mirrors src/utils/phaseNames.ts; keep the cap in sync.
export const MAX_PHASE_NAME_LENGTH = 40;

export function cleanPhaseName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PHASE_NAME_LENGTH).trim();
}

/** Returns a clean { "1": "Beach Fight" } object, or null when there are no custom names. */
export function normalizePhaseNames(names) {
  if (!names || typeof names !== 'object' || Array.isArray(names)) return null;
  const out = {};
  for (const [key, value] of Object.entries(names)) {
    if (!/^[1-9]\d{0,3}$/.test(key)) continue;
    const name = cleanPhaseName(value);
    if (name) out[key] = name;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function phaseLabel(names, phase) {
  return cleanPhaseName(names?.[String(phase)]) || `Phase ${phase}`;
}
