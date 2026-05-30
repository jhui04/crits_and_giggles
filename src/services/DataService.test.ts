import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dataService } from './DataService';
import fs from 'fs';
import path from 'path';

describe('DataService Integrity Test', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should correctly parse the actual monsters.json file', async () => {
    const monstersPath = path.resolve(__dirname, '../../public/data/monsters.json');
    const monstersRaw = fs.readFileSync(monstersPath, 'utf-8');
    const monstersJson = JSON.parse(monstersRaw);
    
    console.log('Unit Test: monsters.json size:', monstersRaw.length);
    console.log('Unit Test: monsters.json item count:', Array.isArray(monstersJson) ? monstersJson.length : monstersJson.monsters?.length);

    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => monstersJson
    });

    const monsters = await dataService.getAllMonsters();
    console.log('Unit Test: DataService processed monsters count:', monsters.length);

    expect(monsters.length).toBeGreaterThan(0);
    expect(monsters[0]).toHaveProperty('id');
    expect(monsters[0]).toHaveProperty('name');
  });

  it('should correctly parse the actual spells.json file', async () => {
    const spellsPath = path.resolve(__dirname, '../../public/data/spells.json');
    const spellsRaw = fs.readFileSync(spellsPath, 'utf-8');
    const spellsJson = JSON.parse(spellsRaw);
    
    console.log('Unit Test: spells.json size:', spellsRaw.length);
    console.log('Unit Test: spells.json item count:', spellsJson.spells?.length || spellsJson.length);

    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => spellsJson
    });

    const spells = await dataService.getAllSpells();
    console.log('Unit Test: DataService processed spells count:', spells.length);

    expect(spells.length).toBeGreaterThan(0);
    expect(spells[0]).toHaveProperty('id');
    expect(spells[0]).toHaveProperty('name');
  });

  it('should generate valid filters from the actual monster data', async () => {
    const monstersPath = path.resolve(__dirname, '../../public/data/monsters.json');
    const monstersJson = JSON.parse(fs.readFileSync(monstersPath, 'utf-8'));
    const monsterList = Array.isArray(monstersJson) ? monstersJson : monstersJson.monsters;

    const filters = dataService.getMonsterFilters(monsterList);
    console.log('Unit Test: Sources count:', filters.sources.length);
    console.log('Unit Test: CRs count:', filters.crs.length);
    console.log('Unit Test: Sizes count:', filters.sizes.length);

    expect(filters.sources.length).toBeGreaterThan(0);
    expect(filters.crs.length).toBeGreaterThan(0);
    expect(filters.sizes.length).toBeGreaterThan(0);
  });
});
