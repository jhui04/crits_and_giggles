// MapDocument schema v1 (see plan.md section 4.3) plus the engine's own small types.
// Only erasable TypeScript syntax is allowed in src/shared/ because the Node server imports it directly.

export type Provenance = {
  source: '5etools' | 'ddb-meta' | 'printed-map' | 'adventure-text' | 'vision' | 'legacy-handcoded' | 'derived' | 'dm-override';
  confidence: number;
  note?: string;
};

export type TerrainClass =
  | 'void' | 'building' | 'cliff'
  | 'water_deep' | 'water_shallow'
  | 'sand' | 'grass' | 'dirt' | 'stone_floor' | 'wood_floor'
  | 'rubble' | 'dense_vegetation' | 'mud' | 'ice' | 'unknown';

export type CoverGrade = 'none' | 'half' | 'three_quarters' | 'total';

export interface Cell {
  x: number;
  y: number;
}

export interface ImageVariant {
  variant: 'dm' | 'player';
  url: string;
  width: number;
  height: number;
  cellPx: number;
  originX: number;
  originY: number;
  provenance: Provenance;
  playerToDm?: number[][];
  registrationInlierRatio?: number;
}

export interface RegionV2 {
  id: string;
  name: string;
  cells: string[];
  labelCells: Cell[];
  textRef?: { source: '5etools'; file: string; areaId: string; page?: number };
  extentMethod: 'polygon' | 'nearest-label' | 'flood-fill' | 'legacy' | 'label-only';
  provenance: Provenance;
}

export interface WallSegment {
  id: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  kind: 'wall' | 'terrain_outline' | 'low_wall' | 'window' | 'door' | 'secret_door' | 'invisible';
  blocksMovement: boolean;
  blocksSight: 'none' | 'limited' | 'full';
  cover: 'half' | 'three_quarters' | 'total';
  door?: { state: 'closed' | 'open' | 'locked' };
  oneWay?: 'left' | 'right';
  name?: string;
  provenance: Provenance;
}

export interface MapObject {
  id: string;
  kind: string;
  label: string;
  cells: string[];
  cover: CoverGrade;
  blocksMovement: boolean;
  difficultTerrain: boolean;
  blocksSight: boolean;
  regionId?: string;
  provenance: Provenance;
}

export interface TerrainLayer {
  legend: Record<string, TerrainClass>;
  rows: string[];
  mixed?: Record<string, Partial<Record<TerrainClass, number>>>;
  confidence?: Record<string, number>;
  provenance: Provenance;
}

export interface SpawnPoint {
  name: string;
  ddbMonsterId?: number;
  cell: Cell;
  sizeCells: number;
  disposition: 'hostile' | 'neutral' | 'friendly';
  provenance: Provenance;
}

export interface AuditEntry {
  level: 'ok' | 'info' | 'warn' | 'question';
  code: string;
  message: string;
}

export interface MapDocument {
  schemaVersion: 1;
  mapId: string;
  number: string;
  title: string;
  kind: 'tactical' | 'overview';
  source: { book: 'EGtW'; adventure: 'ToR' | 'DD' | 'FS' | 'US' };
  grid: { type: 'square' | 'hex'; columns: number; rows: number; feetPerCell: number; units: string; printedScale: string };
  images: ImageVariant[];
  regions: RegionV2[];
  walls: WallSegment[];
  objects: MapObject[];
  terrain?: TerrainLayer;
  spawns: SpawnPoint[];
  lights?: unknown[];
  audit: AuditEntry[];
  generatedAt: string;
  sourceShas: { fiveEtools?: string; ddbMeta?: string };
}

export type CreatureSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';

export interface CombatantLite {
  instanceId: string;
  name: string;
  isPlayer?: boolean;
  faction?: 'ally' | 'enemy' | 'neutral';
  position?: Cell | null;
  size?: CreatureSize;
  speeds?: { walk?: number; swim?: number; fly?: number; climb?: number };
}

// DM corrections applied on top of the generated document (Phase 9). Cells are "x,y" strings.
export type MapOverride =
  | { op: 'set_terrain'; cells: string[]; terrain: TerrainClass }
  | { op: 'add_object'; cells: string[]; kind: string; label?: string; regionId?: string }
  | { op: 'remove_object'; objectId: string }
  | { op: 'set_object_cover'; objectId: string; cover: CoverGrade }
  | { op: 'rename_region'; region: string; name: string }
  | { op: 'set_kind_cover'; kind: string; cover: CoverGrade };

export interface CoverResult {
  type: CoverGrade;
  acBonus: number;
  dexSaveBonus: number;
  description: string;
  blockers: string[];
}
