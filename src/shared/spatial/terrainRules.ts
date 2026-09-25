import type { TerrainClass } from './types.ts';

export interface TerrainRule {
  /** Words used in plain-English output, e.g. "shallow water". */
  label: string;
  /** Can a walking creature stand here (swimming and difficult terrain still count as standing). */
  walkable: boolean;
  /** Movement cost multiplier for a creature with no special speed. */
  cost: number;
  /** Short mechanics note for descriptions. */
  note?: string;
  /** Places no creature may be put on a map. */
  blocksPlacement?: boolean;
}

export const TERRAIN_RULES: Record<TerrainClass, TerrainRule> = {
  void: { label: 'empty space', walkable: false, cost: Infinity, blocksPlacement: true },
  building: { label: 'building', walkable: false, cost: Infinity, blocksPlacement: true },
  cliff: { label: 'cliff', walkable: false, cost: Infinity, blocksPlacement: true },
  water_deep: { label: 'deep water', walkable: true, cost: 2, note: 'swimming' },
  water_shallow: { label: 'shallow water', walkable: true, cost: 2, note: 'difficult terrain' },
  sand: { label: 'sand', walkable: true, cost: 1 },
  grass: { label: 'grass', walkable: true, cost: 1 },
  dirt: { label: 'dirt', walkable: true, cost: 1 },
  stone_floor: { label: 'stone floor', walkable: true, cost: 1 },
  wood_floor: { label: 'wooden floor', walkable: true, cost: 1 },
  rubble: { label: 'rubble', walkable: true, cost: 2, note: 'difficult terrain' },
  dense_vegetation: { label: 'dense vegetation', walkable: true, cost: 2, note: 'difficult terrain, lightly obscured' },
  mud: { label: 'mud', walkable: true, cost: 2, note: 'difficult terrain' },
  ice: { label: 'ice', walkable: true, cost: 2, note: 'difficult terrain' },
  unknown: { label: 'unknown ground', walkable: true, cost: 1 },
};

export const TERRAIN_CLASS_NAMES = Object.keys(TERRAIN_RULES) as TerrainClass[];

/** Class names a caller may ask for in tool arguments ("water" is an alias for both water classes). */
export const TERRAIN_ARGUMENT_NAMES = [
  'water', 'water_deep', 'water_shallow', 'sand', 'grass', 'dirt', 'stone_floor', 'wood_floor',
  'rubble', 'dense_vegetation', 'mud', 'ice',
] as const;

export function expandTerrainNames(names: readonly string[]): TerrainClass[] {
  const out = new Set<TerrainClass>();
  for (const n of names) {
    if (n === 'water') {
      out.add('water_deep');
      out.add('water_shallow');
    } else if ((TERRAIN_CLASS_NAMES as string[]).includes(n)) {
      out.add(n as TerrainClass);
    }
  }
  return [...out];
}

export function isWater(c: TerrainClass): boolean {
  return c === 'water_deep' || c === 'water_shallow';
}

export function terrainLabel(c: TerrainClass): string {
  return TERRAIN_RULES[c].label;
}

/** Single-character codes used in TerrainLayer rows (mirrors tools/maps/terrain.py). */
export const TERRAIN_CODES: Record<TerrainClass, string> = {
  void: '#', building: 'B', cliff: '^', water_deep: 'W', water_shallow: 'w', sand: 's', grass: 'g', dirt: 'd',
  stone_floor: 'f', wood_floor: 'p', rubble: 'r', dense_vegetation: 'v', mud: 'm', ice: 'i', unknown: '?',
};
