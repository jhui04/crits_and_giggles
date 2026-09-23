/**
 * Checks if a given damage type matches a list of damage types (case-insensitive).
 * @param {string[] | string | undefined | null} list
 * @param {string | undefined | null} damageType
 * @returns {boolean}
 */
export function matchesDamageType(list, damageType) {
  if (!list || !damageType || typeof damageType !== 'string') return false;
  const dType = damageType.toLowerCase().trim();
  if (!dType) return false;

  // Requires an exact match against a whole delimited entry or one of its
  // individual words, never a plain substring check. A substring check
  // would wrongly match damageType "son" against a resistance list entry
  // of "poison", or "fire" against "misfire".
  const matchesEntry = (entry) => {
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
 * @param {Object} target
 * @param {string} [damageType]
 * @returns {boolean}
 */
export function hasDamageResistance(target, damageType) {
  if (!damageType) return false;
  const list = target.fullData?.resistances || target.resistances;
  return matchesDamageType(list, damageType);
}

/**
 * Checks if a combatant has damage immunity to the given damage type.
 * @param {Object} target
 * @param {string} [damageType]
 * @returns {boolean}
 */
export function hasDamageImmunity(target, damageType) {
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
 * @param {Object} target
 * @param {string} [damageType]
 * @returns {boolean}
 */
export function hasDamageVulnerability(target, damageType) {
  if (!damageType) return false;
  const list = target.fullData?.vulnerabilities || target.vulnerabilities;
  return matchesDamageType(list, damageType);
}

/**
 * Pure projection engine: projects the effect of damage, healing, or temporary HP on a combatant
 * without mutating any underlying state.
 *
 * @param {Object} target
 * @param {'damage' | 'healing' | 'temp_hp' | string} actionType
 * @param {number} amount
 * @param {string} [damageType]
 * @returns {Object}
 */
export function projectHpApplication(target, actionType, amount, damageType) {
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

  let projectedHp = currentHp;
  let projectedTempHp = currentTempHp;
  let effectiveChange = '';

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
        const parts = [];

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
