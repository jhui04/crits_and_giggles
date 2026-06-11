import type { Monster } from '../types';
import { DiceService } from '../services/DiceService';

export const DND_SKILLS_BY_ABILITY: Record<string, string[]> = {
  "STR": ["Athletics"],
  "DEX": ["Acrobatics", "Sleight of Hand", "Stealth"],
  "INT": ["Arcana", "History", "Investigation", "Nature", "Religion"],
  "WIS": ["Animal Handling", "Insight", "Medicine", "Perception", "Survival"],
  "CHA": ["Deception", "Intimidation", "Performance", "Persuasion"]
};

export const DND_SKILLS: Record<string, keyof Monster['stats']> = {};
Object.entries(DND_SKILLS_BY_ABILITY).forEach(([ability, skills]) => {
  skills.forEach(skill => {
    DND_SKILLS[skill] = ability as keyof Monster['stats'];
  });
});

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
  const stat = monster.stats[statName];
  if (stat) {
    return stat.save !== undefined ? stat.save : stat.modifier;
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
