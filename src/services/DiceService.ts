/**
 * DiceService.ts
 * 
 * Handles parsing of dice notation (e.g., "1d20+5", "2d6") 
 * and rolling random results.
 */

export interface DiceResult {
  total: number;
  rolls: number[];
  modifier: number;
  notation: string;
}

export const MAX_DICE_COUNT = 1000;
export const MAX_DICE_SIDES = 1_000_000;

export const DiceService = {
  /**
   * Parses a dice notation string and returns the result.
   * Format: [count]d[sides][+/-modifier] or a flat number
   */
  roll(notation: string): DiceResult {
    if (typeof notation !== 'string') {
      throw new Error(`Invalid dice notation: ${String(notation)}`);
    }
    const cleanNotation = notation.replace(/\s+/g, '').replace(/[−–]/g, '-');
    
    if (!cleanNotation) {
      throw new Error(`Invalid dice notation: ${notation}`);
    }

    // Match terms: either something like +2d6 or -3 or 1d10
    const termRegex = /([+-]?(?:\d+d\d+|\d+))/gi;
    const matches = cleanNotation.match(termRegex);

    if (!matches) {
      throw new Error(`Invalid dice notation: ${notation}`);
    }

    // Validate that the matched terms reconstruct the entire cleanNotation string
    const reconstructed = matches.join('');
    if (reconstructed !== cleanNotation) {
      throw new Error(`Invalid dice notation: ${notation}`);
    }

    const rolls: number[] = [];
    let totalModifier = 0;
    let totalSum = 0;

    for (const term of matches) {
      if (term.toLowerCase().includes('d')) {
        // Die term: optionally starts with + or -, then count, then d, then sides
        const dieRegex = /^([+-]?)(\d+)d(\d+)$/i;
        const dieMatch = term.match(dieRegex);
        if (!dieMatch) {
          throw new Error(`Invalid dice notation: ${notation}`);
        }
        const sign = dieMatch[1] === '-' ? -1 : 1;
        const count = parseInt(dieMatch[2], 10);
        const sides = parseInt(dieMatch[3], 10);

        if (count === 0 || sides === 0) {
          throw new Error(`Invalid dice notation: ${notation}`);
        }
        if (!Number.isFinite(count) || !Number.isFinite(sides) || count > MAX_DICE_COUNT || sides > MAX_DICE_SIDES) {
          throw new Error(
            `Dice notation out of range (max ${MAX_DICE_COUNT} dice, ${MAX_DICE_SIDES} sides): ${notation}`
          );
        }
        if (rolls.length + count > MAX_DICE_COUNT) {
          throw new Error(`Too many dice in total (max ${MAX_DICE_COUNT}): ${notation}`);
        }

        for (let i = 0; i < count; i++) {
          const roll = Math.floor(Math.random() * sides) + 1;
          rolls.push(roll);
          totalSum += roll * sign;
        }
      } else {
        // Modifier term: optionally starts with + or -, then a number
        const modRegex = /^([+-]?)(\d+)$/;
        const modMatch = term.match(modRegex);
        if (!modMatch) {
          throw new Error(`Invalid dice notation: ${notation}`);
        }
        const sign = modMatch[1] === '-' ? -1 : 1;
        const value = parseInt(modMatch[2], 10);
        totalModifier += value * sign;
      }
    }

    return {
      total: totalSum + totalModifier,
      rolls,
      modifier: totalModifier,
      notation
    };
  },

  /**
   * Helper for rolling a single dice with a modifier.
   */
  rollSimple(sides: number, modifier: number = 0): number {
    return this.roll(`1d${sides}${modifier >= 0 ? '+' : ''}${modifier}`).total;
  }
};
