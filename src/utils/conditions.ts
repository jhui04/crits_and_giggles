/**
 * Pure logic for the combat conditions tracker. Kept framework-free so it can
 * be unit tested directly and reused from both the React UI
 * (ConditionsModal, EncounterRunner) and the server-side assistant tool
 * controller (which only ever reads conditions, never mutates them).
 */

/** The 15 SRD 5e conditions, plus "Concentrating" which DMs track the same way. */
export const SRD_CONDITIONS: readonly string[] = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
  'Concentrating',
];

/**
 * An applied condition. `roundsRemaining` undefined/omitted means the
 * condition lasts indefinitely (until manually removed) rather than
 * expiring at a tracked end-of-turn tick.
 *
 * `skipNextTick`: a duration of N rounds is meant to read as "lasts through
 * the end of this creature's Nth turn-end AFTER it was applied, not counting
 * any turn already in progress." Applying a timed condition to the
 * combatant whose turn is currently active would otherwise tick it down the
 * moment the DM presses Next Turn, so it only gets N-1 effective rounds. Set
 * `skipNextTick: true` when (re-)timing a condition on the currently-acting
 * combatant; tickConditionsAtEndOfTurn then clears the flag on the next
 * end-of-turn tick instead of decrementing `roundsRemaining`, so the first
 * real decrement happens on the turn-end after that one. Irrelevant for
 * indefinite conditions (`roundsRemaining` undefined).
 */
export interface ActiveCondition {
  name: string;
  roundsRemaining?: number;
  skipNextTick?: boolean;
}

/** Minimal shape this module needs from EncounterUnit, to stay decoupled from React/types.ts. */
export interface UnitWithConditions {
  conditions?: ActiveCondition[] | string[];
}

/**
 * Accepts whatever shape may have been persisted (legacy plain string
 * arrays from before conditions were structured, or the current
 * ActiveCondition[] shape) and returns a normalized ActiveCondition[].
 * Anything unrecognized is dropped rather than thrown.
 */
export function normalizeConditions(raw: unknown): ActiveCondition[] {
  if (!Array.isArray(raw)) return [];
  const result: ActiveCondition[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (name) result.push({ name });
    } else if (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
      const name = (entry as { name: string }).name.trim();
      if (!name) continue;
      const rr = (entry as { roundsRemaining?: unknown }).roundsRemaining;
      const skip = (entry as { skipNextTick?: unknown }).skipNextTick;
      result.push({
        name,
        roundsRemaining: typeof rr === 'number' && Number.isFinite(rr) ? rr : undefined,
        skipNextTick: skip === true ? true : undefined,
      });
    }
  }
  return result;
}

/**
 * Adds (or replaces, if a condition of the same name is already present —
 * case-insensitive) a condition. Returns a new array; never mutates input.
 */
export function addCondition(
  conditions: ActiveCondition[] | undefined,
  name: string,
  roundsRemaining?: number,
  skipNextTick?: boolean
): ActiveCondition[] {
  const trimmed = name.trim();
  if (!trimmed) return conditions ? [...conditions] : [];
  const existing = conditions || [];
  const filtered = existing.filter(c => c.name.toLowerCase() !== trimmed.toLowerCase());
  return [...filtered, { name: trimmed, roundsRemaining, skipNextTick: skipNextTick ? true : undefined }];
}

/** Removes a condition by name (case-insensitive). Returns a new array; never mutates input. */
export function removeCondition(conditions: ActiveCondition[] | undefined, name: string): ActiveCondition[] {
  const target = name.trim().toLowerCase();
  return (conditions || []).filter(c => c.name.toLowerCase() !== target);
}

/**
 * Ticks a unit's timed conditions down by one round at the end of its turn.
 * Conditions with no `roundsRemaining` (indefinite) are left untouched.
 * A condition that reaches 0 is removed and reported as expired.
 * Returns a new unit object (shallow copy) plus the list of expired names,
 * in the order they were defined on the unit.
 */
export function tickConditionsAtEndOfTurn<T extends UnitWithConditions>(
  unit: T
): { unit: T; expired: string[] } {
  const normalized = normalizeConditions(unit.conditions);
  if (normalized.length === 0) {
    return { unit: { ...unit, conditions: normalized }, expired: [] };
  }

  const expired: string[] = [];
  const remaining: ActiveCondition[] = [];
  for (const cond of normalized) {
    if (cond.roundsRemaining === undefined) {
      remaining.push(cond);
      continue;
    }
    // A condition (re-)timed on the currently-acting combatant is flagged
    // skipNextTick so this, its first end-of-turn tick, consumes the flag
    // instead of the round count -- see the ActiveCondition doc comment for
    // why. The duration starts decrementing from the turn-end after this one.
    if (cond.skipNextTick) {
      remaining.push({ ...cond, skipNextTick: undefined });
      continue;
    }
    const next = cond.roundsRemaining - 1;
    if (next <= 0) {
      expired.push(cond.name);
    } else {
      remaining.push({ ...cond, roundsRemaining: next });
    }
  }

  return { unit: { ...unit, conditions: remaining }, expired };
}

/**
 * Formats a list of conditions for display/announcement, e.g.
 * "Poisoned (2 rounds), Prone". Indefinite conditions show just the name.
 * Returns '' for an empty list — callers should treat that as "say nothing".
 */
export function formatConditions(conditions: ActiveCondition[] | string[] | undefined): string {
  const normalized = normalizeConditions(conditions);
  return normalized
    .map(c => (c.roundsRemaining !== undefined ? `${c.name} (${c.roundsRemaining} round${c.roundsRemaining === 1 ? '' : 's'})` : c.name))
    .join(', ');
}

/** Formats a list of conditions as plain names only (no round counts), e.g. for assistant tool output. */
export function formatConditionNames(conditions: ActiveCondition[] | string[] | undefined): string[] {
  return normalizeConditions(conditions).map(c =>
    c.roundsRemaining !== undefined ? `${c.name} (${c.roundsRemaining} round${c.roundsRemaining === 1 ? '' : 's'})` : c.name
  );
}
