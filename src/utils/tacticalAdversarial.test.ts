import { describe, it, expect } from 'vitest';
import {
  calculateDistance,
  calculateDirection,
  columnIndexToLabel,
  coordinateToLabel,
  getRegionCenter,
  getRegionSector,
} from './mapUtils';
// columnLabelToIndex, labelToCoordinate, calculateAdjacencies (like
// projectHpApplication/matchesDamageType below) are no longer duplicated
// client-side; this coverage now targets the server modules that actually
// run in production. See R-2 in out_of_scope.md.
import {
  columnLabelToIndex,
  labelToCoordinate,
  calculateAdjacencies,
} from '../../server/assistant/gridUtils.js';
import {
  projectHpApplication,
  matchesDamageType,
} from '../../server/assistant/combatHpUtils.js';
import type { EncounterUnit, MapRegion, Position } from '../types';

describe('Tier 5 Adversarial Coverage: Tactical Utilities & Boundary Probes', () => {
  describe('labelToCoordinate & coordinateToLabel: Extreme Boundaries & Fuzzing', () => {
    it('handles extreme column indices up to multi-letter boundaries (Z, AA, ZZ, AAA, ZZZ)', () => {
      // Single letter boundaries
      expect(coordinateToLabel({ x: 0, y: 0 })).toBe('A1');
      expect(coordinateToLabel({ x: 25, y: 0 })).toBe('Z1');
      expect(labelToCoordinate('A1')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate('Z1')).toEqual({ x: 25, y: 0 });

      // Double letter boundaries
      expect(coordinateToLabel({ x: 26, y: 9 })).toBe('AA10');
      expect(coordinateToLabel({ x: 701, y: 49 })).toBe('ZZ50');
      expect(labelToCoordinate('AA10')).toEqual({ x: 26, y: 9 });
      expect(labelToCoordinate('ZZ50')).toEqual({ x: 701, y: 49 });

      // Triple letter boundaries
      expect(coordinateToLabel({ x: 702, y: 99 })).toBe('AAA100');
      expect(labelToCoordinate('AAA100')).toEqual({ x: 702, y: 99 });
      expect(coordinateToLabel({ x: 18277, y: 0 })).toBe('ZZZ1');
      expect(labelToCoordinate('ZZZ1')).toEqual({ x: 18277, y: 0 });
    });

    it('roundtrips 1,000 randomized coordinates between (0..500, 0..500) without divergence', () => {
      for (let i = 0; i < 1000; i++) {
        const x = Math.floor(Math.random() * 500);
        const y = Math.floor(Math.random() * 500);
        const label = coordinateToLabel({ x, y });
        const parsed = labelToCoordinate(label);
        expect(parsed.x).toBe(x);
        expect(parsed.y).toBe(y);
      }
    });

    it('parses formatted coordinates with internal whitespace, hyphens, and underscores', () => {
      expect(labelToCoordinate('  B  12  ')).toEqual({ x: 1, y: 11 });
      expect(labelToCoordinate('B-12')).toEqual({ x: 1, y: 11 });
      expect(labelToCoordinate('B_12')).toEqual({ x: 1, y: 11 });
      expect(labelToCoordinate('m 9')).toEqual({ x: 12, y: 8 });
      expect(labelToCoordinate('  aa - 25  ')).toEqual({ x: 26, y: 24 });
    });

    it('parses comma-separated grid coordinates with varied whitespace', () => {
      expect(labelToCoordinate('0,0')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate('  15 , 32  ')).toEqual({ x: 15, y: 32 });
      expect(labelToCoordinate('100,200')).toEqual({ x: 100, y: 200 });
    });

    it('throws informative errors on invalid, malformed, or boundary-violating strings', () => {
      // Zero or negative row numbers
      expect(() => labelToCoordinate('A0')).toThrow(/row number must be >= 1/);
      expect(() => labelToCoordinate('A-0')).toThrow(/row number must be >= 1/);
      expect(() => labelToCoordinate('M-0')).toThrow(/row number must be >= 1/);

      // Malformed strings & illegal punctuation
      expect(() => labelToCoordinate('')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('   ')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('123')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('A')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('1A')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('A!1')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('A#5')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('1.5, 2.5')).toThrow(/Invalid coordinate label/);
      expect(() => labelToCoordinate('-5, 10')).toThrow(/Invalid coordinate label/);

      // Type safety
      expect(() => labelToCoordinate(null as unknown as string)).toThrow(/non-empty string/);
      expect(() => labelToCoordinate(undefined as unknown as string)).toThrow(/non-empty string/);
      expect(() => labelToCoordinate(12345 as unknown as string)).toThrow(/non-empty string/);
    });

    it('columnLabelToIndex handles empty, malformed, and non-letter inputs gracefully returning -1', () => {
      expect(columnLabelToIndex('')).toBe(-1);
      expect(columnLabelToIndex('   ')).toBe(-1);
      expect(columnLabelToIndex('123')).toBe(-1);
      expect(columnLabelToIndex('A1')).toBe(-1);
      expect(columnLabelToIndex('A B')).toBe(-1);
      expect(columnLabelToIndex(null as unknown as string)).toBe(-1);
      expect(columnLabelToIndex(undefined as unknown as string)).toBe(-1);
      expect(columnIndexToLabel(-1)).toBe('');
      expect(columnIndexToLabel(-100)).toBe('');
    });
  });

  describe('Chebyshev Distance, Adjacency & Direction Calculations', () => {
    it('calculates 5e Chebyshev distance correctly across negative, zero, and huge offsets', () => {
      // 5e rule: max(abs(dx), abs(dy)) * 5
      expect(calculateDistance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
      expect(calculateDistance({ x: -10, y: -10 }, { x: -10, y: -10 })).toBe(0);
      expect(calculateDistance({ x: -5, y: -5 }, { x: 5, y: 5 })).toBe(50);
      expect(calculateDistance({ x: 0, y: 0 }, { x: 1000, y: 500 })).toBe(5000);
      expect(calculateDistance({ x: -100, y: 200 }, { x: 100, y: -200 })).toBe(2000);
    });

    it('evaluates calculateDirection across all 8 compass directions and Self', () => {
      const origin: Position = { x: 10, y: 10 };
      expect(calculateDirection(origin, origin)).toBe('Self');
      expect(calculateDirection(origin, { x: 10, y: 5 })).toBe('North');
      expect(calculateDirection(origin, { x: 15, y: 5 })).toBe('North-East');
      expect(calculateDirection(origin, { x: 15, y: 10 })).toBe('East');
      expect(calculateDirection(origin, { x: 15, y: 15 })).toBe('South-East');
      expect(calculateDirection(origin, { x: 10, y: 15 })).toBe('South');
      expect(calculateDirection(origin, { x: 5, y: 15 })).toBe('South-West');
      expect(calculateDirection(origin, { x: 5, y: 10 })).toBe('West');
      expect(calculateDirection(origin, { x: 5, y: 5 })).toBe('North-West');
    });

    it('correctly categorizes all 8 adjacent Chebyshev neighbors around a coordinate', () => {
      const center: Position = { x: 5, y: 5 };
      const playerMover: EncounterUnit = {
        instanceId: 'player-center',
        name: 'Center Hero',
        dexMod: 2,
        isPlayer: true,
      };

      // Create 8 surrounding combatants
      const neighbors: EncounterUnit[] = [
        { instanceId: 'u-n', name: 'North Ally', isPlayer: true, position: { x: 5, y: 4 } },
        { instanceId: 'u-ne', name: 'NE Enemy', isPlayer: false, faction: 'enemy', position: { x: 6, y: 4 } },
        { instanceId: 'u-e', name: 'East Neutral', isPlayer: false, faction: 'neutral', position: { x: 6, y: 5 } },
        { instanceId: 'u-se', name: 'SE Enemy', isPlayer: false, position: { x: 6, y: 6 } },
        { instanceId: 'u-s', name: 'South Ally', isPlayer: true, position: { x: 5, y: 6 } },
        { instanceId: 'u-sw', name: 'SW Enemy', isPlayer: false, position: { x: 4, y: 6 } },
        { instanceId: 'u-w', name: 'West Neutral', isPlayer: false, faction: 'neutral', position: { x: 4, y: 5 } },
        { instanceId: 'u-nw', name: 'NW Ally', isPlayer: true, position: { x: 4, y: 4 } },
        // Two units outside the 5 ft radius (10 ft away)
        { instanceId: 'u-far-1', name: 'Far Orthogonal', isPlayer: true, position: { x: 5, y: 3 } },
        { instanceId: 'u-far-2', name: 'Far Diagonal', isPlayer: false, position: { x: 7, y: 3 } },
      ];

      const adj = calculateAdjacencies(center, playerMover, neighbors);
      expect(adj.allies).toHaveLength(3);
      expect(adj.allies).toContain('North Ally');
      expect(adj.allies).toContain('South Ally');
      expect(adj.allies).toContain('NW Ally');
      expect(adj.allies).not.toContain('Far Orthogonal');

      expect(adj.enemies).toHaveLength(3);
      expect(adj.enemies).toContain('NE Enemy');
      expect(adj.enemies).toContain('SE Enemy');
      expect(adj.enemies).toContain('SW Enemy');
      expect(adj.enemies).not.toContain('Far Diagonal');

      expect(adj.neutral).toHaveLength(2);
      expect(adj.neutral).toContain('East Neutral');
      expect(adj.neutral).toContain('West Neutral');
    });

    it('handles stacked combatants sharing the exact same coordinate (0 ft distance)', () => {
      const center: Position = { x: 5, y: 5 };
      const playerMover: EncounterUnit = {
        instanceId: 'player-1',
        name: 'Rider',
        isPlayer: true,
      };

      const mount: EncounterUnit = {
        instanceId: 'mount-1',
        name: 'Warhorse',
        isPlayer: true,
        position: { x: 5, y: 5 }, // exact same coordinate
      };

      const adj = calculateAdjacencies(center, playerMover, [mount]);
      expect(adj.allies).toContain('Warhorse');
    });

    it('correctly handles neutral mover perspective where all other units are neutral', () => {
      const neutralMover: EncounterUnit = {
        instanceId: 'npc-neutral',
        name: 'Town Mayor',
        isPlayer: false,
        faction: 'neutral',
      };

      const units: EncounterUnit[] = [
        { instanceId: 'p1', name: 'Player Fighter', isPlayer: true, position: { x: 1, y: 2 } },
        { instanceId: 'm1', name: 'Goblin', isPlayer: false, position: { x: 2, y: 1 } },
        { instanceId: 'n1', name: 'Shopkeeper', isPlayer: false, faction: 'neutral', position: { x: 2, y: 2 } },
      ];

      const adj = calculateAdjacencies({ x: 1, y: 1 }, neutralMover, units);
      expect(adj.allies).toHaveLength(0);
      expect(adj.enemies).toHaveLength(0);
      expect(adj.neutral).toContain('Player Fighter');
      expect(adj.neutral).toContain('Goblin');
      expect(adj.neutral).toContain('Shopkeeper');
    });

    it('ignores units with undefined, null, or non-numeric positions without crashing', () => {
      const mover: EncounterUnit = { instanceId: 'm-1', name: 'Hero', isPlayer: true };
      const corruptUnits = [
        { instanceId: 'c1', name: 'No Pos' },
        { instanceId: 'c2', name: 'Null Pos', position: null },
        { instanceId: 'c3', name: 'String Pos', position: { x: '5' as unknown as number, y: 5 } },
        { instanceId: 'c4', name: 'NaN Pos', position: { x: NaN, y: 5 } },
        { instanceId: 'c5', name: 'Valid Unit', isPlayer: false, position: { x: 5, y: 6 } },
      ] as unknown as EncounterUnit[];

      const adj = calculateAdjacencies({ x: 5, y: 5 }, mover, corruptUnits);
      expect(adj.enemies).toEqual(['Valid Unit']);
    });

    it('evaluates getRegionCenter with complex, L-shaped, and empty regions', () => {
      // L-shaped region
      const lRegion: MapRegion = {
        id: 'r-l',
        name: 'L-Corridor',
        cells: ['0,0', '0,1', '0,2', '1,0', '2,0'],
      };
      const center = getRegionCenter(lRegion);
      // Center cell must be a valid member of region.cells
      expect(lRegion.cells).toContain(`${center.x},${center.y}`);

      // Empty cells fallback to bounds
      const boundedRegion: MapRegion = {
        id: 'r-b',
        name: 'Hall',
        bounds: { minCol: 10, maxCol: 20, minRow: 4, maxRow: 14 },
        cells: [],
      };
      expect(getRegionCenter(boundedRegion)).toEqual({ x: 15, y: 9 });

      // Completely empty region
      const emptyRegion: MapRegion = { id: 'r-e', name: 'Void' };
      expect(getRegionCenter(emptyRegion)).toEqual({ x: 0, y: 0 });
    });

    it('evaluates getRegionSector across 9 tactical zones', () => {
      const mapSize = { width: 30, height: 30 };
      expect(getRegionSector({ x: 2, y: 2 }, mapSize)).toBe('North-West');
      expect(getRegionSector({ x: 15, y: 2 }, mapSize)).toBe('North');
      expect(getRegionSector({ x: 28, y: 2 }, mapSize)).toBe('North-East');
      expect(getRegionSector({ x: 2, y: 15 }, mapSize)).toBe('West');
      expect(getRegionSector({ x: 15, y: 15 }, mapSize)).toBe('Central');
      expect(getRegionSector({ x: 28, y: 15 }, mapSize)).toBe('East');
      expect(getRegionSector({ x: 2, y: 28 }, mapSize)).toBe('South-West');
      expect(getRegionSector({ x: 15, y: 28 }, mapSize)).toBe('South');
      expect(getRegionSector({ x: 28, y: 28 }, mapSize)).toBe('South-East');
    });
  });

  describe('Complex Damage Projections with Multiple Simultaneous Targets', () => {
    it('accurately projects multiple simultaneous targets in a Fireball scenario', () => {
      const targets = [
        // Target 1: Fire Immunity + Temp HP + Current HP
        {
          instanceId: 't-elemental',
          combatantName: 'Fire Elemental',
          currentHp: 100,
          maxHp: 100,
          tempHp: 15,
          fullData: { immunities: { damage: ['fire'] } },
        },
        // Target 2: Fire Resistance + 10 Temp HP
        {
          instanceId: 't-tiefling',
          combatantName: 'Tiefling Warlock',
          currentHp: 40,
          maxHp: 40,
          tempHp: 10,
          fullData: { resistances: ['fire'] },
        },
        // Target 3: Fire Vulnerability + 0 Temp HP
        {
          instanceId: 't-mummy',
          combatantName: 'Mummy',
          currentHp: 58,
          maxHp: 58,
          tempHp: 0,
          fullData: { vulnerabilities: ['fire'] },
        },
        // Target 4: Both Resistance AND Vulnerability (PHB half then double)
        {
          instanceId: 't-chimera',
          combatantName: 'Mutant Beast',
          currentHp: 60,
          maxHp: 60,
          tempHp: 0,
          fullData: { resistances: ['fire'], vulnerabilities: ['fire'] },
        },
        // Target 5: Fragile creature with overkill damage
        {
          instanceId: 't-bat',
          combatantName: 'Giant Bat',
          currentHp: 12,
          maxHp: 22,
          tempHp: 0,
        },
      ];

      // Fireball does 28 fire damage to all targets
      const projections = targets.map((t) => projectHpApplication(t, 'damage', 28, 'fire'));

      // T1 (Immune): takes 0 damage, 15 temp retained, 100 HP retained
      expect(projections[0].projectedHp).toBe(100);
      expect(projections[0].projectedTempHp).toBe(15);
      expect(projections[0].effectiveChange).toBe('Immune (0 damage)');

      // T2 (Resistant): 28 / 2 = 14 effective damage. Absorbs 10 temp, 4 drains HP -> 36 HP
      expect(projections[1].projectedTempHp).toBe(0);
      expect(projections[1].projectedHp).toBe(36);
      expect(projections[1].effectiveChange).toContain('-10 temp');
      expect(projections[1].effectiveChange).toContain('-4 HP (resisted)');

      // T3 (Vulnerable): 28 * 2 = 56 effective damage -> 58 - 56 = 2 HP
      expect(projections[2].projectedHp).toBe(2);
      expect(projections[2].projectedTempHp).toBe(0);
      expect(projections[2].effectiveChange).toContain('-56 HP (vulnerable)');

      // T4 (Resistant & Vulnerable): 28 / 2 = 14, 14 * 2 = 28 -> 60 - 28 = 32 HP
      expect(projections[3].projectedHp).toBe(32);
      expect(projections[3].effectiveChange).toContain('(resisted & vulnerable)');

      // T5 (Overkill): 28 damage on 12 HP -> clamped to 0 HP
      expect(projections[4].projectedHp).toBe(0);
      expect(projections[4].effectiveChange).toBe('-12 HP');
    });

    it('evaluates temp HP replacement and retention rules across varying target states', () => {
      const targetWith15Temp = {
        instanceId: 'w-1',
        name: 'Warlock',
        currentHp: 30,
        maxHp: 30,
        tempHp: 15,
      };

      // Lower temp HP (10 vs 15): retained
      const p1 = projectHpApplication(targetWith15Temp, 'temp_hp', 10);
      expect(p1.projectedTempHp).toBe(15);
      expect(p1.effectiveChange).toContain('15 temp HP retained');

      // Equal temp HP (15 vs 15): retained
      const p2 = projectHpApplication(targetWith15Temp, 'temp_hp', 15);
      expect(p2.projectedTempHp).toBe(15);
      expect(p2.effectiveChange).toContain('15 temp HP retained');

      // Higher temp HP (22 vs 15): replaced
      const p3 = projectHpApplication(targetWith15Temp, 'temp_hp', 22);
      expect(p3.projectedTempHp).toBe(22);
      expect(p3.effectiveChange).toContain('+7 temp HP (set to 22)');
    });

    it('evaluates healing rules with overhealing, unconscious units, and temp HP neutrality', () => {
      const targetUnconscious = {
        instanceId: 'f-1',
        name: 'Fighter Down',
        currentHp: 0,
        maxHp: 45,
        tempHp: 10,
      };

      // Heals 20 HP from 0 HP
      const p1 = projectHpApplication(targetUnconscious, 'healing', 20);
      expect(p1.projectedHp).toBe(20);
      expect(p1.projectedTempHp).toBe(10); // temp HP untouched
      expect(p1.effectiveChange).toBe('+20 HP');

      // Overhealing past max HP (100 HP healing)
      const p2 = projectHpApplication(targetUnconscious, 'healing', 100);
      expect(p2.projectedHp).toBe(45);
      expect(p2.projectedTempHp).toBe(10);
      expect(p2.effectiveChange).toBe('+45 HP');
    });

    it('gracefully normalizes edge-case inputs (NaN, negative, floats, whitespace)', () => {
      const target = { instanceId: 'u-edge', currentHp: 20, maxHp: 20, tempHp: 5 };

      // Float damage (11.9) floored to 11
      const pFloat = projectHpApplication(target, 'damage', 11.9);
      expect(pFloat.amount).toBe(11);
      expect(pFloat.projectedTempHp).toBe(0);
      expect(pFloat.projectedHp).toBe(14);

      // String amount ('10')
      const pStr = projectHpApplication(target, 'damage', '10' as unknown as number);
      expect(pStr.amount).toBe(10);

      // Negative amount (-25) clamped to 0
      const pNeg = projectHpApplication(target, 'damage', -25);
      expect(pNeg.amount).toBe(0);
      expect(pNeg.projectedHp).toBe(20);

      // Damage type with whitespace and mixed casing
      const pCase = projectHpApplication(target, 'damage', 10, '  RaDiAnT  ');
      expect(pCase.damageType).toBe('radiant');

      // Non-string damageType (number, boolean, null, undefined) safely handled without error
      const pNumType = projectHpApplication(target, 'damage', 10, 42 as unknown as string);
      expect(pNumType.projectedHp).toBe(15);
      const pBoolType = projectHpApplication(target, 'damage', 10, true as unknown as string);
      expect(pBoolType.projectedHp).toBe(15);
      expect(matchesDamageType(['fire'], 42 as unknown as string)).toBe(false);

      // Unsupported action throws descriptive error
      expect(() => projectHpApplication(target, 'banish', 10)).toThrow(/Unsupported actionType "banish"/);
    });

    it('safely guards columnIndexToLabel against Infinity, -Infinity, and NaN without infinite loops', () => {
      expect(columnIndexToLabel(Infinity)).toBe('');
      expect(columnIndexToLabel(-Infinity)).toBe('');
      expect(columnIndexToLabel(NaN)).toBe('');
      expect(columnIndexToLabel(null as unknown as number)).toBe('');
      expect(columnIndexToLabel(undefined as unknown as number)).toBe('');
    });
  });
});
