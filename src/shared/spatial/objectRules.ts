import type { CoverGrade } from './types.ts';

export interface ObjectRule {
  cover: CoverGrade;
  blocksMovement: boolean;
  difficultTerrain: boolean;
  blocksSight: boolean;
}

// Defaults follow the 5e cover rules (plan section 4.5). Mirrored in tools/maps/objects.py.
export const OBJECT_RULES: Record<string, ObjectRule> = {
  palm_tree: { cover: 'half', blocksMovement: false, difficultTerrain: false, blocksSight: false },
  tree: { cover: 'three_quarters', blocksMovement: true, difficultTerrain: false, blocksSight: true },
  market_stall: { cover: 'half', blocksMovement: true, difficultTerrain: false, blocksSight: false },
  table: { cover: 'half', blocksMovement: false, difficultTerrain: true, blocksSight: false },
  chairs_and_tables: { cover: 'half', blocksMovement: false, difficultTerrain: true, blocksSight: false },
  pillar: { cover: 'three_quarters', blocksMovement: true, difficultTerrain: false, blocksSight: true },
  statue: { cover: 'three_quarters', blocksMovement: true, difficultTerrain: false, blocksSight: true },
  building: { cover: 'total', blocksMovement: true, difficultTerrain: false, blocksSight: true },
  cottage: { cover: 'total', blocksMovement: true, difficultTerrain: false, blocksSight: true },
  crate: { cover: 'half', blocksMovement: true, difficultTerrain: false, blocksSight: false },
  bed: { cover: 'half', blocksMovement: false, difficultTerrain: true, blocksSight: false },
  boulder: { cover: 'three_quarters', blocksMovement: true, difficultTerrain: false, blocksSight: true },
  fireplace: { cover: 'half', blocksMovement: true, difficultTerrain: false, blocksSight: false },
  fountain: { cover: 'half', blocksMovement: true, difficultTerrain: false, blocksSight: false },
};

export function objectKindLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}
