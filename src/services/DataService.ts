import type { Monster, Spell } from '../types';

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
}

class DataService {
  private monsters: Monster[] = [];
  private spells: Spell[] = [];
  private monsterPromise: Promise<Monster[]> | null = null;
  private spellPromise: Promise<Spell[]> | null = null;

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
        this.monsters = list;
        return this.monsters;
      })
      .catch(err => {
        console.error("DataService: Failed to load monsters:", err);
        this.monsterPromise = null;
        return [];
      });

    return this.monsterPromise;
  }

  async getMonsterById(id: string): Promise<Monster | null> {
    const monsters = await this.getAllMonsters();
    return monsters.find(m => m.id === id) || null;
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
        this.spells = list;
        return this.spells;
      })
      .catch(err => {
        console.error("DataService: Failed to load spells:", err);
        this.spellPromise = null;
        return [];
      });

    return this.spellPromise;
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
    if (!spells || spells.length === 0) return { schools: [] };
    const schools = Array.from(new Set(spells.map(s => s.school).filter(Boolean))) as string[];
    return {
      schools: schools.sort()
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
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

export const dataService = new DataService();
