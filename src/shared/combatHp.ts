/**
 * Pure combat HP logic: damage-type matching, resistance/immunity/vulnerability
 * lookups, and the projection engine that previews the effect of damage,
 * healing, or temp HP on a combatant without mutating any state.
 *
 * Shared by the client (manual DM damage entry, src/components/MonsterOperationsModal.tsx)
 * and the server (the Assistant Oracle's apply_combat_damage HITL write tool,
 * server/assistant/toolController.js) so the two surfaces can never drift
 * apart the way the old server-only and client-only copies once did (see
 * src/utils/combatHpUtils.test.ts). server/assistant/combatHpUtils.js
 * re-exports this module rather than keeping its own copy.
 */

/**
 * The single source of truth for "bloodied": at or below half max HP, but
 * only while still up (> 0 HP). No rounding either way (an odd max like 7
 * bloodies at hp <= 3.5, i.e. hp <= 3). Everything that needs "bloodied" imports
 * this rather than keeping its own copy, so they can't disagree on an odd max HP.
 */
export function isBloodied(currentHp?: number, maxHp?: number): boolean {
  if (currentHp === undefined || maxHp === undefined || maxHp <= 0) return false;
  return currentHp > 0 && currentHp <= maxHp / 2;
}

export interface DamageTarget {
  instanceId?: string;
  combatantId?: string;
  id?: string;
  name?: string;
  combatantName?: string;
  currentHp?: number;
  maxHp?: number;
  tempHp?: number;
  currentTempHp?: number;
  resistances?: string[] | string;
  vulnerabilities?: string[] | string;
  immunities?: { damage?: string[] | string } | string[] | string;
  fullData?: {
    resistances?: string[] | string;
    vulnerabilities?: string[] | string;
    immunities?: { damage?: string[] | string } | string[] | string;
  };
}

export type HpActionType = 'damage' | 'healing' | 'temp_hp' | string;

export interface HpProjection {
  combatantId: string;
  combatantName: string;
  amount: number;
  actionType: string;
  damageType: string | undefined;
  currentHp: number;
  currentTempHp: number;
  maxHp: number;
  projectedHp: number;
  projectedTempHp: number;
  effectiveChange: string;
}

/**
 * Checks if a given damage type matches a list of damage types (case-insensitive).
 */
export function matchesDamageType(list: string[] | string | undefined | null, damageType: string | undefined | null): boolean {
  if (!list || !damageType || typeof damageType !== 'string') return false;
  const dType = damageType.toLowerCase().trim();
  if (!dType) return false;

  // Requires an exact match against a whole delimited entry or one of its
  // individual words, never a plain substring check. A substring check
  // would wrongly match damageType "son" against a resistance list entry
  // of "poison", or "fire" against "misfire".
  const matchesEntry = (entry: unknown): boolean => {
    if (typeof entry !== 'string') return false;
    const normalized = entry.toLowerCase().trim();
    if (!normalized) return false;
    return normalized.split(/[,;]/).some((part) => {
      const trimmedPart = part.trim();
      if (!trimmedPart) return false;
      if (trimmedPart === dType) return true;
      const words = trimmedPart.split(/\s+|\band\b|\bor\b/).map((w) => w.trim()).filter(Boolean);
      return words.includes(dType);
    });
  };

  if (Array.isArray(list)) {
    return list.some(matchesEntry);
  }

  if (typeof list === 'string') {
    return matchesEntry(list);
  }

  return false;
}

/**
 * Checks if a combatant has damage resistance to the given damage type.
 */
export function hasDamageResistance(target: DamageTarget, damageType?: string): boolean {
  if (!damageType) return false;
  const list = target.fullData?.resistances || target.resistances;
  return matchesDamageType(list, damageType);
}

/**
 * Checks if a combatant has damage immunity to the given damage type.
 */
export function hasDamageImmunity(target: DamageTarget, damageType?: string): boolean {
  if (!damageType) return false;
  const immunities = target.fullData?.immunities || target.immunities;
  if (!immunities) return false;

  if (typeof immunities === 'object' && !Array.isArray(immunities)) {
    const damageList = immunities.damage;
    if (matchesDamageType(damageList, damageType)) return true;
  }

  if (Array.isArray(immunities) || typeof immunities === 'string') {
    return matchesDamageType(immunities, damageType);
  }

  return false;
}

/**
 * Checks if a combatant has damage vulnerability to the given damage type.
 */
export function hasDamageVulnerability(target: DamageTarget, damageType?: string): boolean {
  if (!damageType) return false;
  const list = target.fullData?.vulnerabilities || target.vulnerabilities;
  return matchesDamageType(list, damageType);
}

/**
 * Pure projection engine: projects the effect of damage, healing, or temporary HP on a combatant
 * without mutating any underlying state.
 */
export function projectHpApplication(target: DamageTarget, actionType: HpActionType, amount: number, damageType?: string): HpProjection {
  const combatantId = target.instanceId || target.combatantId || target.id || 'unknown';
  const combatantName = target.combatantName || target.name || 'Unknown';

  const rawCurrentHp = typeof target.currentHp === 'number' ? target.currentHp : (target.maxHp ?? 0);
  const maxHp = typeof target.maxHp === 'number' ? target.maxHp : rawCurrentHp;
  const currentHp = Math.max(0, rawCurrentHp);
  const currentTempHp = Math.max(
    0,
    typeof target.tempHp === 'number'
      ? target.tempHp
      : typeof target.currentTempHp === 'number'
      ? target.currentTempHp
      : 0
  );

  const cleanAmount = Math.max(0, Math.floor(Number(amount) || 0));
  const normAction = (actionType || 'damage').toLowerCase().trim();
  const normDamageType = typeof damageType === 'string' && damageType.trim() ? damageType.toLowerCase().trim() : undefined;

  // Every branch below assigns all three (or the default throws), so no
  // initializer is needed here.
  let projectedHp: number;
  let projectedTempHp: number;
  let effectiveChange: string;

  switch (normAction) {
    case 'damage': {
      const isImmune = normDamageType ? hasDamageImmunity(target, normDamageType) : false;
      const isResistant = normDamageType && !isImmune ? hasDamageResistance(target, normDamageType) : false;
      const isVulnerable = normDamageType && !isImmune ? hasDamageVulnerability(target, normDamageType) : false;

      let effectiveDamage = cleanAmount;
      if (isImmune) {
        effectiveDamage = 0;
      } else {
        if (isResistant) {
          effectiveDamage = Math.floor(effectiveDamage / 2);
        }
        if (isVulnerable) {
          effectiveDamage = effectiveDamage * 2;
        }
      }

      if (isImmune) {
        projectedHp = currentHp;
        projectedTempHp = currentTempHp;
        effectiveChange = 'Immune (0 damage)';
      } else {
        const absorbedByTemp = Math.min(currentTempHp, effectiveDamage);
        projectedTempHp = currentTempHp - absorbedByTemp;
        const excessDamage = effectiveDamage - absorbedByTemp;

        projectedHp = Math.max(0, currentHp - excessDamage);

        const hpLost = currentHp - projectedHp;
        const parts: string[] = [];

        if (absorbedByTemp > 0) {
          parts.push(`-${absorbedByTemp} temp`);
        }
        if (hpLost > 0 || (absorbedByTemp === 0 && effectiveDamage === 0)) {
          parts.push(`-${hpLost} HP`);
        }

        let changeText = parts.length > 0 ? parts.join(', ') : '-0 HP';
        if (isResistant && isVulnerable) {
          changeText += ' (resisted & vulnerable)';
        } else if (isResistant) {
          changeText += ' (resisted)';
        } else if (isVulnerable) {
          changeText += ' (vulnerable)';
        }
        effectiveChange = changeText;
      }
      break;
    }

    case 'healing': {
      projectedHp = Math.min(maxHp, currentHp + cleanAmount);
      projectedTempHp = currentTempHp;
      const healed = projectedHp - currentHp;
      effectiveChange = healed > 0 ? `+${healed} HP` : '+0 HP (at max)';
      break;
    }

    case 'temp_hp': {
      projectedHp = currentHp;
      if (cleanAmount > currentTempHp) {
        projectedTempHp = cleanAmount;
        effectiveChange = `+${cleanAmount - currentTempHp} temp HP (set to ${cleanAmount})`;
      } else {
        projectedTempHp = currentTempHp;
        effectiveChange = `No change (${currentTempHp} temp HP retained)`;
      }
      break;
    }

    default:
      throw new Error(`Unsupported actionType "${actionType}". Expected "damage", "healing", or "temp_hp".`);
  }

  return {
    combatantId,
    combatantName,
    amount: cleanAmount,
    actionType: normAction,
    damageType: normDamageType,
    currentHp,
    currentTempHp,
    maxHp,
    projectedHp,
    projectedTempHp,
    effectiveChange,
  };
}
