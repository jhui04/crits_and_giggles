/**
 * Pure logic for the 5e concentration check a damaged creature makes to
 * keep its "Concentrating" condition (PHB concentration rules). Used only by
 * EncounterRunner's manual DM damage path (applyHpMod) for monsters -- the
 * manual path already skips players for all HP changes, and this follows
 * that same boundary rather than introducing a new one.
 *
 * Kept framework/dice-free so the DC and wording can be unit tested without
 * mocking Math.random or React state.
 */

/**
 * DC = max(10, floor(damage taken / 2)), per the 5e concentration rule.
 * `damageTaken` must already be the amount actually taken -- i.e. after
 * resistance/vulnerability/immunity, and including any amount absorbed by
 * temp HP (temp HP absorption still counts as "taking damage" for this
 * check; only immunity, which reduces damage taken to 0, skips the check).
 */
export function getConcentrationDC(damageTaken: number): number {
  return Math.max(10, Math.floor(damageTaken / 2));
}

/**
 * A concentration check is only triggered by damage actually taken. Immune
 * damage (0 taken) never triggers one, matching the 5e rule that immunity
 * means "no damage" rather than "damage reduced to 0 by other means."
 */
export function needsConcentrationCheck(damageTaken: number): boolean {
  return damageTaken > 0;
}

/**
 * Announcement fragment when the creature was dropped to 0 HP by the same
 * damage: a creature at 0 HP is unconscious and automatically loses
 * concentration, so no roll happens. The caller appends this to the base HP
 * change announcement, which already says "<name> is down." (see
 * buildHpChangeAnnouncement) -- this fragment only adds "Concentration
 * ends.", so the combined sentence reads "<name> is down. Concentration
 * ends." without repeating the name or "is down" a second time.
 */
export function buildConcentrationDownAnnouncement(): string {
  return 'Concentration ends.';
}

/**
 * Announcement fragment for a rolled concentration save, to be appended to
 * the same damage announcement (never a second, competing announcement),
 * e.g. "Concentration save: 14 against DC 10, maintained." or
 * "Concentration save: 7 against DC 12, failed. Goblin shaman is no longer
 * concentrating."
 */
export function buildConcentrationSaveAnnouncement(name: string, rollTotal: number, dc: number, maintained: boolean): string {
  return maintained
    ? `Concentration save: ${rollTotal} against DC ${dc}, maintained.`
    : `Concentration save: ${rollTotal} against DC ${dc}, failed. ${name} is no longer concentrating.`;
}
