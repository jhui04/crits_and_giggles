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
  proficiency_bonus?: number;
  traits: { name: string; content: string; usage?: { times: number; type: string } }[];
  actions: { name: string; content: string; is_attack?: boolean; attack_bonus?: number; damage?: { dice: string; type: string }[] }[];
  legendary_actions: { name: string; content: string; cost?: number; is_attack?: boolean; attack_bonus?: number; damage?: { dice: string; type: string }[] }[];
  reactions: { name: string; content: string }[];
}

export interface PlayerCharacter {
  id: string;
  name: string;
  description: string;
}

export interface EncounterUnit {
  instanceId: string;
  monsterId?: string;
  playerId?: string;
  name: string;
  maxHp?: number;
  currentHp?: number;
  hpDice?: string; 
  dexMod: number;
  initiative?: number;
  passivePerception?: number;
  isPlayer?: boolean;
  fullData?: Monster;
}

export interface Encounter {
  id: string;
  name: string;
  units: EncounterUnit[];
  chapterIds?: string[];
}

export interface Chapter {
  id: string;
  title: string;
  content: string; // Custom Markdown string
  order: number;
}

export type AssetType = 'NPC' | 'PC' | 'Location' | 'Item' | 'Spell';

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  description: string;
  chapterIds?: string[];
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
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  chapters: Chapter[];
  assets: Asset[];
  players: PlayerCharacter[];
  encounters: Encounter[];
}
