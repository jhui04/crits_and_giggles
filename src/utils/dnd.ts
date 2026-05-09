import type { Monster } from '../types';
import { DiceService } from '../services/DiceService';

export const DND_SKILLS: Record<string, keyof Monster['stats']> = {
  'Acrobatics': 'DEX',
  'Animal Handling': 'WIS',
  'Arcana': 'INT',
  'Athletics': 'STR',
  'Deception': 'CHA',
  'History': 'INT',
  'Insight': 'WIS',
  'Intimidation': 'CHA',
  'Investigation': 'INT',
  'Medicine': 'WIS',
  'Nature': 'INT',
  'Perception': 'WIS',
  'Performance': 'CHA',
  'Persuasion': 'CHA',
  'Religion': 'INT',
  'Sleight of Hand': 'DEX',
  'Stealth': 'DEX',
  'Survival': 'WIS'
};

export const DND_SAVES: Array<keyof Monster['stats']> = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

export function getSkillModifier(monster: Monster, skillName: string): number {
  const explicitSkill = monster.skills?.find(s => s.name.toLowerCase() === skillName.toLowerCase());
  if (explicitSkill) {
    return explicitSkill.modifier;
  }
  
  const statKey = DND_SKILLS[skillName];
  if (statKey && monster.stats[statKey]) {
    return monster.stats[statKey].modifier;
  }
  
  return 0;
}

export function getSaveModifier(monster: Monster, statName: keyof Monster['stats']): number {
  if (monster.stats[statName]) {
    return monster.stats[statName].save;
  }
  return 0;
}

export function formatD20Roll(mod: number) {
  const result = DiceService.roll(`1d20${mod >= 0 ? '+' : ''}${mod}`);
  const base = result.rolls[0];
  let announceStr = result.total.toString();
  if (base === 1) announceStr = `natural 1 (total ${result.total})`;
  if (base === 20) announceStr = `natural 20 (total ${result.total})`;
  const visualStr = `${result.total}, ${base}${mod >= 0 ? '+' : ''}${mod}`;
  return { announceStr, visualStr, total: result.total, base };
}
