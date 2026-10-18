/**
 * Pure helpers for building the screen-reader announcement text for a manual
 * DM HP change (EncounterRunner.applyHpMod) and the "bloodied"/"down"
 * transition that change may cross. Kept separate from the HP math itself
 * (src/shared/combatHp.ts) so the exact wording can be unit tested without
 * touching component state.
 */

/** A combatant is "bloodied" at or below half max HP, but only while still up (> 0 HP). */
export function isBloodied(hp: number, maxHp: number): boolean {
  return hp > 0 && maxHp > 0 && hp <= maxHp / 2;
}

export interface HpStatusTransition {
  /** Just crossed from above half max HP to at-or-below half max HP (and is still > 0). */
  crossedBloodied: boolean;
  /** HP is now at or below zero. */
  wentDown: boolean;
}

/** Determines whether an HP change just crossed the bloodied threshold or brought the combatant to 0. */
export function getHpStatusTransition(prevHp: number, nextHp: number, maxHp: number): HpStatusTransition {
  const wentDown = nextHp <= 0;
  const crossedBloodied = !wentDown && !isBloodied(prevHp, maxHp) && isBloodied(nextHp, maxHp);
  return { crossedBloodied, wentDown };
}

/** HP text for an Initiative Track row, e.g. "HP: 4/7, bloodied" or "HP: 0/7, down". */
export function formatTrackerHp(currentHp: number | undefined, maxHp: number | undefined): string {
  let text = `HP: ${currentHp}/${maxHp}`;
  if (currentHp !== undefined && currentHp <= 0) text += ', down';
  else if (currentHp !== undefined && maxHp !== undefined && isBloodied(currentHp, maxHp)) text += ', bloodied';
  return text;
}

export interface HpChangeAnnouncementInput {
  /** Combatant's display name. */
  name: string;
  actionType: 'damage' | 'healing';
  /** The amount requested (before resistance/vulnerability is applied). */
  amount: number;
  /** Lowercase damage type, or undefined for untyped damage (healing never has a type). */
  damageType?: string;
  isImmune: boolean;
  isResistant: boolean;
  isVulnerable: boolean;
  prevHp: number;
  newHp: number;
  maxHp: number;
  newTempHp: number;
}

/**
 * Builds the terse, most-important-information-first announcement for a
 * manual HP change, e.g.:
 *   "Goblin 2 takes 3 fire damage, halved by resistance. 4 of 7 HP."
 *   "Goblin 2 is immune to poison. No damage."
 *   "Ogre takes 12 cold damage, doubled by vulnerability. 47 of 59 HP. Ogre is bloodied."
 *   "Goblin 2 takes 7 damage. 0 of 7 HP. Goblin 2 is down."
 */
export function buildHpChangeAnnouncement(input: HpChangeAnnouncementInput): string {
  const { name, actionType, amount, damageType, isImmune, isResistant, isVulnerable, prevHp, newHp, maxHp, newTempHp } = input;

  if (actionType === 'damage' && isImmune) {
    return `${name} is immune to ${damageType}. No damage.`;
  }

  const parts: string[] = [];

  if (actionType === 'damage') {
    const typeWord = damageType ? ` ${damageType}` : '';
    let modifier = '';
    if (isResistant && isVulnerable) modifier = ', resisted and vulnerable';
    else if (isResistant) modifier = ', halved by resistance';
    else if (isVulnerable) modifier = ', doubled by vulnerability';
    parts.push(`${name} takes ${amount}${typeWord} damage${modifier}.`);
  } else {
    parts.push(`${name} heals ${amount} HP.`);
  }

  parts.push(`${newHp} of ${maxHp} HP.`);

  if (newTempHp > 0) {
    parts.push(`${newTempHp} temporary hit points remain.`);
  }

  const { crossedBloodied, wentDown } = getHpStatusTransition(prevHp, newHp, maxHp);
  if (wentDown) {
    parts.push(`${name} is down.`);
  } else if (crossedBloodied) {
    parts.push(`${name} is bloodied.`);
  }

  return parts.join(' ');
}
