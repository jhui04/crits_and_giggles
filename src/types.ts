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
  stats: Record<string, { score: number; modifier: number; save: number }>;
  skills: { name: string; modifier: number }[];
  vulnerabilities: string[];
  resistances: string[];
  immunities: { damage: string[]; condition: string[] };
  senses: { name: string; value: number; notes?: string }[];
  languages: string[];
  cr: string;
  source?: string;
  proficiency_bonus?: number;
  traits: { name: string; content: string; usage?: { times: number; type: string } }[];
  actions: { name: string; content: string; is_attack?: boolean; attack_bonus?: number; damage?: { dice: string; type: string }[] }[];
  legendary_actions: { name: string; content: string; cost?: number; is_attack?: boolean; attack_bonus?: number; damage?: { dice: string; type: string }[] }[];
  reactions: { name: string; content: string }[];
}

export interface EncounterUnit {
  instanceId: string;
  monsterId?: string;
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
}

export interface Chapter {
  id: string;
  title: string;
  content: string; // Custom Markdown string
  order: number;
}

export type AssetType = 'NPC' | 'PC' | 'Location' | 'Item';

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  description: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  chapters: Chapter[];
  assets: Asset[];
  encounters: Encounter[];
}
