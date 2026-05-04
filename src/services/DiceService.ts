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

export const DiceService = {
  /**
   * Parses a dice notation string and returns the result.
   * Format: [count]d[sides][+/-modifier]
   */
  roll(notation: string): DiceResult {
    const regex = /^(\d+)d(\d+)([+-]\d+)?$/i;
    const match = notation.replace(/\s+/g, '').match(regex);

    if (!match) {
      throw new Error(`Invalid dice notation: ${notation}`);
    }

    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;

    const rolls: number[] = [];
    let sum = 0;

    for (let i = 0; i < count; i++) {
      const roll = Math.floor(Math.random() * sides) + 1;
      rolls.push(roll);
      sum += roll;
    }

    return {
      total: sum + modifier,
      rolls,
      modifier,
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
