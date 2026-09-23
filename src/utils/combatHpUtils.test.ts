import { describe, it, expect } from 'vitest';
// Targets the server module directly (the only copy that actually runs in
// production) rather than a client-side duplicate: the duplicate used to
// carry its own copy of this coverage while nothing imported the code it
// was meant to protect, so the two could silently drift apart (see R-2 —
// this is exactly what happened with the G-15 damage-type substring bug,
// which had to be fixed by hand in both copies).
import {
  projectHpApplication,
  hasDamageResistance,
  hasDamageImmunity,
  hasDamageVulnerability,
  matchesDamageType,
} from '../../server/assistant/combatHpUtils.js';

describe('combatHpUtils: projectHpApplication', () => {
  describe('Damage and Temp HP Absorption', () => {
    it('absorbs damage using temp HP first before affecting current HP', () => {
      const target = {
        instanceId: 'hero-1',
        name: 'Grog Strongjaw',
        currentHp: 50,
        maxHp: 50,
        tempHp: 15,
      };

      // 10 damage: fully absorbed by 15 temp HP
      const proj1 = projectHpApplication(target, 'damage', 10);
      expect(proj1.currentHp).toBe(50);
      expect(proj1.currentTempHp).toBe(15);
      expect(proj1.projectedHp).toBe(50);
      expect(proj1.projectedTempHp).toBe(5);
      expect(proj1.effectiveChange).toContain('-10 temp');

      // 20 damage: absorbs all 15 temp HP, excess 5 drains current HP
      const proj2 = projectHpApplication(target, 'damage', 20);
      expect(proj2.projectedTempHp).toBe(0);
      expect(proj2.projectedHp).toBe(45);
      expect(proj2.effectiveChange).toContain('-15 temp');
      expect(proj2.effectiveChange).toContain('-5 HP');
    });

    it('clamps current HP at zero on lethal or overwhelming damage', () => {
      const target = {
        instanceId: 'goblin-1',
        name: 'Goblin Sneak',
        currentHp: 7,
        maxHp: 7,
        tempHp: 0,
      };

      // 50 damage when target only has 7 HP
      const proj = projectHpApplication(target, 'damage', 50);
      expect(proj.projectedHp).toBe(0);
      expect(proj.projectedTempHp).toBe(0);
      expect(proj.effectiveChange).toBe('-7 HP');
    });

    it('handles negative or zero damage amounts gracefully', () => {
      const target = {
        instanceId: 'hero-2',
        name: 'Vax',
        currentHp: 30,
        maxHp: 30,
        tempHp: 5,
      };

      const projZero = projectHpApplication(target, 'damage', 0);
      expect(projZero.projectedHp).toBe(30);
      expect(projZero.projectedTempHp).toBe(5);
      expect(projZero.effectiveChange).toBe('-0 HP');

      const projNegative = projectHpApplication(target, 'damage', -10);
      expect(projNegative.projectedHp).toBe(30);
      expect(projNegative.projectedTempHp).toBe(5);
      expect(projNegative.effectiveChange).toBe('-0 HP');
    });
  });

  describe('Healing', () => {
    it('restores current HP clamped up to maxHp and leaves temp HP untouched', () => {
      const target = {
        instanceId: 'cleric-1',
        name: 'Pike Trickfoot',
        currentHp: 20,
        maxHp: 35,
        tempHp: 10,
      };

      // Heals 8 HP: 20 -> 28
      const proj1 = projectHpApplication(target, 'healing', 8);
      expect(proj1.projectedHp).toBe(28);
      expect(proj1.projectedTempHp).toBe(10); // temp HP untouched
      expect(proj1.effectiveChange).toBe('+8 HP');

      // Overhealing: Heals 50 HP: 20 -> 35 (maxHp)
      const proj2 = projectHpApplication(target, 'healing', 50);
      expect(proj2.projectedHp).toBe(35);
      expect(proj2.projectedTempHp).toBe(10);
      expect(proj2.effectiveChange).toBe('+15 HP');
    });

    it('reports no effective healing if combatant is already at max HP', () => {
      const target = {
        instanceId: 'cleric-2',
        name: 'Pike Full',
        currentHp: 35,
        maxHp: 35,
        tempHp: 5,
      };

      const proj = projectHpApplication(target, 'healing', 10);
      expect(proj.projectedHp).toBe(35);
      expect(proj.projectedTempHp).toBe(5);
      expect(proj.effectiveChange).toBe('+0 HP (at max)');
    });
  });

  describe('Temporary Hit Points (temp_hp)', () => {
    it('enforces D&D 5e non-stacking rule: takes higher value and leaves current HP untouched', () => {
      const target = {
        instanceId: 'warlock-1',
        name: 'Fjord',
        currentHp: 25,
        maxHp: 40,
        tempHp: 8,
      };

      // Applying lower temp HP (5 vs existing 8): retained existing 8
      const projLower = projectHpApplication(target, 'temp_hp', 5);
      expect(projLower.projectedTempHp).toBe(8);
      expect(projLower.projectedHp).toBe(25);
      expect(projLower.effectiveChange).toContain('retained');

      // Applying higher temp HP (14 vs existing 8): replaced with 14
      const projHigher = projectHpApplication(target, 'temp_hp', 14);
      expect(projHigher.projectedTempHp).toBe(14);
      expect(projHigher.projectedHp).toBe(25);
      expect(projHigher.effectiveChange).toContain('+6 temp HP (set to 14)');
    });

    it('applies temp HP when current temp HP is 0', () => {
      const target = {
        instanceId: 'wizard-1',
        name: 'Caleb',
        currentHp: 18,
        maxHp: 25,
        tempHp: 0,
      };

      const proj = projectHpApplication(target, 'temp_hp', 12);
      expect(proj.projectedTempHp).toBe(12);
      expect(proj.projectedHp).toBe(18);
      expect(proj.effectiveChange).toContain('+12 temp HP (set to 12)');
    });
  });

  describe('Resistances, Immunities, and Vulnerabilities', () => {
    it('halves damage when target is resistant to damage type', () => {
      const target = {
        instanceId: 'fiend-1',
        name: 'Tiefling Rogue',
        currentHp: 30,
        maxHp: 30,
        tempHp: 0,
        fullData: {
          resistances: ['fire', 'cold'],
        },
      };

      // 15 fire damage: resistant halves to Math.floor(15/2) = 7
      const proj = projectHpApplication(target, 'damage', 15, 'fire');
      expect(proj.projectedHp).toBe(23);
      expect(proj.effectiveChange).toContain('(resisted)');
      expect(proj.effectiveChange).toContain('-7 HP');

      // Unrelated damage type: piercing (full 15 damage)
      const projNormal = projectHpApplication(target, 'damage', 15, 'piercing');
      expect(projNormal.projectedHp).toBe(15);
      expect(projNormal.effectiveChange).toBe('-15 HP');
    });

    it('zeros damage when target is immune to damage type', () => {
      const target = {
        instanceId: 'elemental-1',
        name: 'Fire Elemental',
        currentHp: 100,
        maxHp: 100,
        tempHp: 10,
        fullData: {
          immunities: {
            damage: ['fire', 'poison'],
            condition: ['paralyzed'],
          },
        },
      };

      const proj = projectHpApplication(target, 'damage', 30, 'fire');
      expect(proj.projectedHp).toBe(100);
      expect(proj.projectedTempHp).toBe(10);
      expect(proj.effectiveChange).toBe('Immune (0 damage)');
    });

    it('doubles damage when target is vulnerable to damage type', () => {
      const target = {
        instanceId: 'skel-1',
        name: 'Skeleton',
        currentHp: 20,
        maxHp: 20,
        tempHp: 0,
        fullData: {
          vulnerabilities: ['bludgeoning'],
        },
      };

      // 6 bludgeoning damage: doubled to 12
      const proj = projectHpApplication(target, 'damage', 6, 'bludgeoning');
      expect(proj.projectedHp).toBe(8);
      expect(proj.effectiveChange).toContain('(vulnerable)');
      expect(proj.effectiveChange).toContain('-12 HP');
    });
  });

  describe('Damage Type Matching Helpers', () => {
    it('matchesDamageType matches single, array, and comma-separated types case-insensitively', () => {
      expect(matchesDamageType(['fire', 'cold'], 'FIRE')).toBe(true);
      expect(matchesDamageType(['fire', 'cold'], 'acid')).toBe(false);
      expect(matchesDamageType('fire, lightning, poison', 'lightning')).toBe(true);
      expect(matchesDamageType(null, 'fire')).toBe(false);
      expect(matchesDamageType(['fire'], '')).toBe(false);
    });

    it('correctly identifies resistance, immunity, and vulnerability via helper functions', () => {
      const target = {
        fullData: {
          resistances: ['cold'],
          immunities: { damage: ['fire'] },
          vulnerabilities: ['radiant'],
        },
      };

      expect(hasDamageResistance(target, 'cold')).toBe(true);
      expect(hasDamageResistance(target, 'fire')).toBe(false);
      expect(hasDamageImmunity(target, 'fire')).toBe(true);
      expect(hasDamageImmunity(target, 'cold')).toBe(false);
      expect(hasDamageVulnerability(target, 'radiant')).toBe(true);
      expect(hasDamageVulnerability(target, 'fire')).toBe(false);
    });
  });
});
