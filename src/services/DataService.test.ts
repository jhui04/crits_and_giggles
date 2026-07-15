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

  it('should correctly parse spells with stubs and resolve them synchronously via getSpellByIdSync', async () => {
    const mockSpellsData = {
      spells: [
        { id: 101, name: 'Fireball', level: 3, school: 'Evocation', source: 'PHB', description: 'Big boom' },
        { id: 102, duplicate_of: 101 }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSpellsData
    });

    (dataService as any).spells = [];
    (dataService as any).spellPromise = null;

    const spells = await dataService.getAllSpells();

    // Verify stubs are filtered out from the main list
    expect(spells.length).toBe(1);
    expect(spells[0].id).toBe(101);

    // Verify lookup resolves the stub (102) to the original (101)
    const resolvedOriginal = dataService.getSpellByIdSync(102);
    expect(resolvedOriginal).not.toBeNull();
    expect(resolvedOriginal!.id).toBe(101);
    expect(resolvedOriginal!.name).toBe('Fireball');

    // Verify lookup for original still works
    const resolvedDirect = dataService.getSpellByIdSync(101);
    expect(resolvedDirect).not.toBeNull();
    expect(resolvedDirect!.id).toBe(101);

    // Verify lookup with string ID works
    const resolvedString = dataService.getSpellByIdSync('102');
    expect(resolvedString).not.toBeNull();
    expect(resolvedString!.id).toBe(101);
  });

  it('should correctly parse monsters with stubs and resolve them synchronously via getMonsterByIdSync', async () => {
    const mockMonstersData = [
      { id: '101', name: 'Goblin', cr: '1/4', meta: { size: 'Small', type: 'Humanoid' }, source: 'MM', attributes: { ac: { value: 15 }, hp: { value: 7, dice: '2d6' }, speeds: { walk: 30 } }, stats: { STR: { score: 8, modifier: -1 } }, skills: [], vulnerabilities: [], resistances: [], immunities: { damage: [], condition: [] }, senses: [], languages: [], traits: [], actions: [], legendary_actions: [], reactions: [] },
      { id: '102', duplicate_of: '101' }
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockMonstersData
    });

    (dataService as any).monsters = [];
    (dataService as any).monsterPromise = null;

    const monsters = await dataService.getAllMonsters();

    // Verify stubs are filtered out from the main list
    expect(monsters.length).toBe(1);
    expect(monsters[0].id).toBe('101');

    // Verify lookup resolves the stub ('102') to the original ('101')
    const resolvedOriginal = dataService.getMonsterByIdSync('102');
    expect(resolvedOriginal).not.toBeNull();
    expect(resolvedOriginal!.id).toBe('101');
    expect(resolvedOriginal!.name).toBe('Goblin');

    // Verify lookup for original still works
    const resolvedDirect = dataService.getMonsterByIdSync('101');
    expect(resolvedDirect).not.toBeNull();
    expect(resolvedDirect!.id).toBe('101');
  });
});
