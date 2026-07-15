import type { Monster, Spell, MagicItem, MagicItemFilters } from '../types';

export interface MonsterFilters {
  search: string;
  sources?: string[];
  sizes?: string[];
  crs?: string[];
}

export interface SpellFilters {
  search: string;
  levels?: string[];
  schools?: string[];
  sources?: string[];
}

class DataService {
  private monsters: Monster[] = [];
  private spells: Spell[] = [];
  private magicItems: MagicItem[] = [];
  private monsterPromise: Promise<Monster[]> | null = null;
  private spellPromise: Promise<Spell[]> | null = null;
  private magicItemPromise: Promise<MagicItem[]> | null = null;
  private spellDuplicateMap: Map<number, number> = new Map();

  private monsterDuplicateMap: Map<string, string> = new Map();

  async getAllMonsters(): Promise<Monster[]> {
    if (this.monsters.length > 0) return this.monsters;
    if (this.monsterPromise) return this.monsterPromise;

    this.monsterPromise = fetch(`/data/monsters.json?t=${new Date().getTime()}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        const list = Array.isArray(data) ? data : (data.monsters || []);
        this.monsters = [];
        this.monsterDuplicateMap.clear();
        for (const m of list) {
          if (m.duplicate_of) {
            this.monsterDuplicateMap.set(m.id, m.duplicate_of);
          } else {
            this.monsters.push(m);
          }
        }
        return this.monsters;
      })
      .catch(err => {
        console.error("DataService: Failed to load monsters:", err);
        this.monsterPromise = null;
        return [];
      });

    return this.monsterPromise;
  }

  getMonsterByIdSync(id: string): Monster | null {
    const targetId = this.monsterDuplicateMap.get(id) || id;
    return this.monsters.find(m => m.id === targetId) || null;
  }

  async getMonsterById(id: string): Promise<Monster | null> {
    await this.getAllMonsters();
    return this.getMonsterByIdSync(id);
  }

  async getAllSpells(): Promise<Spell[]> {
    if (this.spells.length > 0) return this.spells;
    if (this.spellPromise) return this.spellPromise;

    this.spellPromise = fetch(`/data/spells.json?t=${new Date().getTime()}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        const list = Array.isArray(data) ? data : (data.spells || []);
        this.spells = [];
        this.spellDuplicateMap.clear();
        for (const s of list) {
          if (s.duplicate_of) {
            this.spellDuplicateMap.set(s.id, s.duplicate_of);
          } else {
            this.spells.push(s);
          }
        }
        return this.spells;
      })
      .catch(err => {
        console.error("DataService: Failed to load spells:", err);
        this.spellPromise = null;
        return [];
      });

    return this.spellPromise;
  }

  getSpellByIdSync(id: number | string): Spell | null {
    const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
    if (isNaN(numericId)) return null;
    const targetId = this.spellDuplicateMap.get(numericId) || numericId;
    return this.spells.find(s => s.id === targetId) || null;
  }

  getMonsterFilters(monsters: Monster[]) {
    if (!monsters || monsters.length === 0) return { sources: [], sizes: [], crs: [] };
    
    const sources = Array.from(new Set(monsters.map(m => m.source).filter(Boolean))) as string[];
    const sizes = Array.from(new Set(monsters.map(m => m.meta?.size).filter(Boolean))) as string[];
    const crs = Array.from(new Set(monsters.map(m => m.cr).filter(Boolean))).sort((a, b) => {
      const parseCr = (c: string) => {
        if (c === '1/8') return 0.125;
        if (c === '1/4') return 0.25;
        if (c === '1/2') return 0.5;
        return parseFloat(c) || 0;
      };
      return parseCr(a) - parseCr(b);
    });

    return {
      sources: sources.sort(),
      sizes: sizes.sort(),
      crs
    };
  }

  filterMonsters(monsters: Monster[], filters: MonsterFilters): Monster[] {
    if (!monsters) return [];
    return monsters
      .filter(m => {
        if (filters.search) {
          const search = filters.search.toLowerCase();
          if (!m.name.toLowerCase().includes(search)) return false;
        }
        if (filters.sources && filters.sources.length > 0 && !filters.sources.includes(m.source || '')) return false;
        if (filters.sizes && filters.sizes.length > 0 && !filters.sizes.includes(m.meta?.size || '')) return false;
        if (filters.crs && filters.crs.length > 0 && !filters.crs.includes(m.cr)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getSpellFilters(spells: Spell[]) {
    if (!spells || spells.length === 0) return { schools: [], sources: [] };
    const schools = Array.from(new Set(spells.map(s => s.school).filter(Boolean))) as string[];
    const sources = Array.from(new Set(spells.map(s => s.source).filter(Boolean))) as string[];
    return {
      schools: schools.sort(),
      sources: sources.sort()
    };
  }

  filterSpells(spells: Spell[], filters: SpellFilters): Spell[] {
    if (!spells) return [];
    return spells
      .filter(s => {
        if (filters.search) {
          const search = filters.search.toLowerCase();
          if (!s.name.toLowerCase().includes(search)) return false;
        }
        if (filters.levels && filters.levels.length > 0 && !filters.levels.includes(s.level.toString())) return false;
        if (filters.schools && filters.schools.length > 0 && !filters.schools.includes(s.school)) return false;
        if (filters.sources && filters.sources.length > 0 && !filters.sources.includes(s.source)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getAllMagicItems(): Promise<MagicItem[]> {
    if (this.magicItems.length > 0) return this.magicItems;
    if (this.magicItemPromise) return this.magicItemPromise;

    this.magicItemPromise = fetch(`/data/magic_items.json?t=${new Date().getTime()}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        const list = Array.isArray(data) ? data : (data.magicItems || []);
        this.magicItems = list;
        return this.magicItems;
      })
      .catch(err => {
        console.error("DataService: Failed to load magic items:", err);
        this.magicItemPromise = null;
        return [];
      });

    return this.magicItemPromise;
  }

  getMagicItemFilters(items: MagicItem[]) {
    if (!items || items.length === 0) return { types: [], rarities: [], sources: [] };
    
    const types = Array.from(new Set(items.map(i => i.type).filter(Boolean))) as string[];
    const rarities = Array.from(new Set(items.map(i => i.rarity).filter(Boolean))) as string[];
    const sources = Array.from(new Set(items.map(i => i.source).filter(Boolean))) as string[];

    return {
      types: types.sort(),
      rarities: rarities.sort(),
      sources: sources.sort()
    };
  }

  filterMagicItems(items: MagicItem[], filters: MagicItemFilters): MagicItem[] {
    if (!items) return [];
    return items
      .filter(i => {
        if (filters.search) {
          const search = filters.search.toLowerCase();
          if (!i.name.toLowerCase().includes(search)) return false;
        }
        if (filters.types && filters.types.length > 0 && !filters.types.includes(i.type)) return false;
        if (filters.rarities && filters.rarities.length > 0 && !filters.rarities.includes(i.rarity)) return false;
        if (filters.sources && filters.sources.length > 0 && !filters.sources.includes(i.source)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

export const dataService = new DataService();
