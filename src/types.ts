import type { WallSegment, TerrainLayer, MapObject } from './shared/spatial/types.ts';
import type { ActiveCondition } from './utils/conditions';
export type LoreItem = 
  | string 
  | { type: 'list', items: string[] }
  | { type: 'table', rows: string[][] };

export interface LoreSection {
  title: string;
  content: LoreItem[];
}

export interface Monster {
  id: string;
  name: string;
  meta: {
    size: string;
    type: string;
    tags: string[];
    alignment: string;
  };
  attributes: {
    ac: { value: number; notes?: string };
    hp: { value: number; dice: string };
    speeds: Record<string, number | boolean>;
    initiative_modifier?: number;
  };
  stats: Record<string, { score: number; modifier: number; save?: number }>;
  skills: { name: string; modifier: number }[];
  vulnerabilities: string[];
  resistances: string[];
  immunities: { damage: string[]; condition: string[] };
  senses: { name: string; value: number; notes?: string }[];
  languages: string[];
  cr: string;
  source?: string;
  description?: LoreItem[];
  lore_sections?: LoreSection[];
  image?: string;
  proficiency_bonus?: number;
  traits: { name: string; content: string; usage?: { times: number; type: string } }[];
  actions: { name: string; content: string; is_attack?: boolean; attack_bonus?: number; damage?: { dice: string; type: string }[] }[];
  legendary_actions: { name: string; content: string; cost?: number; is_attack?: boolean; attack_bonus?: number; damage?: { dice: string; type: string }[] }[];
  reactions: { name: string; content: string }[];
  duplicate_of?: string;
}

export interface PlayerCharacter {
  id: string;
  name: string;
  description: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface MapRegion {
  id: string;
  name: string;
  type?: string;
  description?: string;
  color?: [number, number, number];
  bounds?: {
    minCol: number;
    maxCol: number;
    minRow: number;
    maxRow: number;
  };
  cells: string[];
}

export type WallType = 'full' | 'half' | 'three_quarters' | 'door_closed' | 'door_open' | 'window';

export interface WallEdge {
  id: string;
  c1: [number, number]; // [col, row] of cell 1
  c2: [number, number]; // [col, row] of adjacent cell 2
  type: WallType;
  name?: string;
  blocksVision?: boolean;
}

export interface ObstacleCell {
  x: number;
  y: number;
  type: 'half' | 'three_quarters' | 'full';
  name?: string;
}

export interface MapWallsData {
  edges: WallEdge[];
  obstacleCells?: Record<string, ObstacleCell>; // key "x,y"
  /** Free wall segments in grid units from a compiled MapDocument (see src/shared/spatial). */
  segments?: WallSegment[];
}

export type CoverType = 'none' | 'half' | 'three_quarters' | 'total';

export interface CoverResult {
  type: CoverType;
  acBonus: number;
  dexSaveBonus: number;
  description: string;
  blockers: string[];
}

export interface MapGridConfig {
  columns: number;
  rows: number;
  cellPitch: number;
  offsetX: number;
  offsetY: number;
  imageWidth?: number;
  imageHeight?: number;
  confidence?: number;
  regions?: MapRegion[];
  walls?: MapWallsData;
  /** Set when the grid comes from a compiled MapDocument. */
  mapId?: string;
  mapKind?: 'tactical' | 'overview';
  terrain?: TerrainLayer;
  objects?: MapObject[];
}

export interface MapSize {
  width: number;
  height: number;
  cellPitch?: number;
  offsetX?: number;
  offsetY?: number;
  regions?: MapRegion[];
  walls?: MapWallsData;
}

export interface EncounterUnit {
  instanceId: string;
  monsterId?: string;
  playerId?: string;
  name: string;
  maxHp?: number;
  currentHp?: number;
  tempHp?: number;
  hpDice?: string; 
  dexMod: number;
  initiative?: number;
  passivePerception?: number;
  isPlayer?: boolean;
  faction?: 'ally' | 'enemy' | 'neutral';
  fullData?: Monster;
  conditions?: ActiveCondition[];
  notes?: string;
  position?: Position;
  phase?: number;
}

export interface EncounterRunningState {
  isCombatStarted: boolean;
  round: number;
  turnIndex: number;
  combatants: EncounterUnit[];
  activePhases?: number[];
  combatLog?: Array<Record<string, unknown>>;
  updatedAt?: string;
}

export interface Encounter {
  id: string;
  name: string;
  units: EncounterUnit[];
  chapterIds?: string[];
  runningState?: EncounterRunningState | null;
  mapSize?: MapSize;
  gridConfig?: MapGridConfig;
  dmMapUrl?: string;
  playerMapUrl?: string;
  /** Custom phase names keyed by phase number ("1" -> "Beach Fight"); display only. Missing/blank = "Phase N". */
  phaseNames?: Record<string, string>;
}

/**
 * Minimal reference to a single asset mentioned in chapter text via @TagType[id]{Name} syntax.
 * Stored as an ordered, deduplicated index on each Chapter so that campaign-wide
 * asset lists can be built without re-scanning chapter content at render time.
 */
export interface ChapterAssetRef {
  id: string;
  tagType: 'Campaign' | 'Monster' | 'Spell' | 'Item' | 'World';
}

export interface Chapter {
  id: string;
  title: string;
  content: string; // Custom Markdown string
  order: number;
  /** Ordered, deduplicated list of assets mentioned in this chapter's content. Computed on save. */
  mentionedAssets?: ChapterAssetRef[];
}

export type WorldAssetType = 'NPC' | 'Location' | 'Item' | 'Spell' | 'Organization' | 'Religion' | 'Lore' | 'Faction' | 'Race' | 'Class' | 'Background' | 'Note';

export type AssetType = WorldAssetType;

export interface WorldAssetConnection {
  id: string;
  targetId: string;       // The other WorldAsset's ID
  relationship: string;   // e.g. "is capital of", "rules", "is member of"
  inverseRelationship?: string; // Label from the target's side, e.g. "is hated by"; blank = derive/fallback
  description?: string;   // Optional detail, e.g. "has lived here for twenty years"
}

export interface WorldAsset {
  id: string;
  type: WorldAssetType;
  name: string;
  description: string;
  tags: string[];
  connections: WorldAssetConnection[];
}

export interface World {
  id: string;
  name: string;
  description: string;
  assets: WorldAsset[];
}

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  description: string;
  chapterIds?: string[];
  worldAssetId?: string;
  tagType?: 'Campaign' | 'Monster' | 'Spell' | 'Item' | 'World';
}

export interface Spell {
  id: number;
  name: string;
  slug: string;
  url: string;
  level: number;
  school: string;
  class_spell_lists: string[];
  casting_time: string;
  range: string;
  components: string;
  required_materials: string | null;
  duration: string;
  concentration_required: number;
  ritual: number;
  melee_spell_attack: number;
  ranged_spell_attack: number;
  saving_throw: string | null;
  damage: string | null;
  description: string;
  higher_level_description: string | null;
  source: string;
  duplicate_of?: number;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  chapters: Chapter[];
  assets: Asset[];
  players: PlayerCharacter[];
  encounters: Encounter[];
  worldId?: string;
}

export interface MagicItem {
  id: string;
  name: string;
  url: string;
  slug: string;
  type: string;
  subtype: string;
  rarity: string;
  requires_attunement: boolean;
  attunement_notes: string;
  notes: string;
  tags: string[];
  source: string;
  description: LoreItem[];
  html_description: string;
  scraped_at: string;
  image?: string;
  duplicate_of?: string;
}

export interface MagicItemFilters {
  search: string;
  types?: string[];
  rarities?: string[];
  sources?: string[];
}

// ============================================================================
// Human-In-The-Loop (HITL) Write-Tool Framework Types
// ============================================================================

export type HitlAction = 'approve' | 'deny';
export type ProposalStatus = 'pending' | 'approved' | 'denied' | 'stale';
export type HitlPayloadType = 'movement' | 'damage' | 'combatant_config' | 'map_patch' | 'generic';

export interface MovementProposalPayload {
  combatantId: string;
  combatantName?: string;
  origin: {
    x: number;
    y: number;
    label: string;
    regionName?: string;
  };
  destination: {
    x: number;
    y: number;
    label: string;
    regionName?: string;
    /** Ground under the destination in words, from the compiled map. */
    terrain?: string;
    /** Plain-English facts about the destination (water contact, cover, hazards). */
    notes?: string[];
  };
  originAdjacencies?: {
    allies: string[];
    enemies: string[];
    neutral: string[];
  };
  destinationAdjacencies?: {
    allies: string[];
    enemies: string[];
    neutral: string[];
  };
}

export interface DamageTargetProjection {
  combatantId: string;
  combatantName: string;
  amount: number;
  actionType: 'damage' | 'healing' | 'temp_hp';
  damageType?: string;
  currentHp: number;
  currentTempHp: number;
  maxHp: number;
  projectedHp: number;
  projectedTempHp: number;
  effectiveChange?: string;
}

export interface DamageProposalPayload {
  targets: DamageTargetProjection[];
  encounterId?: string;
}

export interface CombatantConfigEntry {
  name: string;
  monsterId?: string;
  monsterType?: string;
  coordinates: {
    x: number;
    y: number;
    label: string;
    regionName?: string;
    /** True when the scenario text gave no location for this combatant and
     *  the placement (A1 / 0,0) was inferred rather than specified. */
    placementInferred?: boolean;
  };
  phase: number;
  faction: 'ally' | 'enemy' | 'neutral';
  hp?: number;
}

export interface CombatantConfigProposalPayload {
  encounterId?: string;
  encounterName?: string;
  scenarioTextSummary?: string;
  combatants: CombatantConfigEntry[];
  /** DM-chosen phase names (phase number -> name); absent when every phase uses "Phase N". */
  phaseNames?: Record<string, string>;
}

export interface MapPatchProposalPayload {
  map: string;
  Change: string;
  [detail: string]: string;
}

export interface GenericProposalPayload {
  [key: string]: unknown;
}

export type ToolProposalPayload =
  | MovementProposalPayload
  | DamageProposalPayload
  | CombatantConfigProposalPayload
  | MapPatchProposalPayload
  | GenericProposalPayload;

export interface ConfirmationProposal<T = ToolProposalPayload> {
  proposalId: string;
  toolName: string;
  description: string;
  requiresConfirmation: true;
  status: ProposalStatus;
  createdAt: number;
  payloadType: HitlPayloadType | string;
  payload: T;
  context?: {
    campaignId?: string | null;
    encounterId?: string | null;
    chapterId?: string | null;
  };
}
