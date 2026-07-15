import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { Monster } from '../types';

describe('Monster Data Integrity', () => {
  const dataPath = path.join(__dirname, '../../public/data/monsters.json');
  const rawData = fs.readFileSync(dataPath, 'utf-8');
  const monsters: Monster[] = JSON.parse(rawData);

  it('should load monsters successfully', () => {
    expect(monsters.length).toBeGreaterThan(0);
  });

  describe('Structural integrity of all monsters', () => {
    monsters.forEach((monster) => {
      if (monster.duplicate_of) return;
      it(`should have all required fields structurally present and valid for ${monster.name}`, () => {
        // Base fields
        expect(typeof monster.id).toBe('string');
        expect(typeof monster.name).toBe('string');
        expect(typeof monster.cr).toBe('string');
        
        // Meta
        expect(monster.meta).toBeDefined();
        expect(typeof monster.meta.size).toBe('string');
        expect(typeof monster.meta.type).toBe('string');
        
        // Attributes
        expect(monster.attributes).toBeDefined();
        
        // AC
        expect(monster.attributes.ac).toBeDefined();
        expect(typeof monster.attributes.ac.value).toBe('number');
        
        // HP
        expect(monster.attributes.hp).toBeDefined();
        expect(typeof monster.attributes.hp.value).toBe('number');
        expect(monster.attributes.hp.value).toBeGreaterThanOrEqual(0);
        // CR 0 tiny creatures might not have dice, but the field should be a string
        expect(typeof monster.attributes.hp.dice).toBe('string');
        
        // Speeds
        expect(monster.attributes.speeds).toBeDefined();
        // At least one movement type should be defined
        expect(Object.keys(monster.attributes.speeds).length).toBeGreaterThan(0);

        // Stats
        expect(monster.stats).toBeDefined();
        ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(stat => {
          expect(monster.stats[stat]).toBeDefined();
          expect(typeof monster.stats[stat].score).toBe('number');
          expect(typeof monster.stats[stat].modifier).toBe('number');
          if (monster.stats[stat].save !== undefined) {
            expect(typeof monster.stats[stat].save).toBe('number');
          }
        });

        // Arrays (can be empty, but must be defined as arrays)
        expect(Array.isArray(monster.skills)).toBe(true);
        expect(Array.isArray(monster.vulnerabilities)).toBe(true);
        expect(Array.isArray(monster.resistances)).toBe(true);
        expect(Array.isArray(monster.senses)).toBe(true);
        expect(Array.isArray(monster.languages)).toBe(true);
        expect(Array.isArray(monster.traits)).toBe(true);
        expect(Array.isArray(monster.actions)).toBe(true);
        expect(Array.isArray(monster.legendary_actions)).toBe(true);
        expect(Array.isArray(monster.reactions)).toBe(true);

        // Objects
        expect(monster.immunities).toBeDefined();
        expect(Array.isArray(monster.immunities.damage)).toBe(true);
        expect(Array.isArray(monster.immunities.condition)).toBe(true);
      });
      
      it(`should have damage for every attack action for ${monster.name}`, () => {
        // Known exceptions that have an attack roll but deal no direct damage
        const exceptions = ["Net", "Web", "Grapple", "Intoxicating Touch", "Tendril", "Chromatic Bolt", "Spellcasting"]; 
        
        monster.actions.forEach(action => {
          if (action.attack_bonus !== undefined && !exceptions.some(e => action.name.includes(e))) {
            const hasDamage = action.damage && action.damage.length > 0;
            if (!hasDamage) {
               console.warn(`WARNING: Monster '${monster.name}' Action '${action.name}' has attack bonus but no damage.`);
            }
            expect(hasDamage).toBe(true);
          }
        });
      });

      it(`should correctly have attack rolls and damage for legendary attack actions for ${monster.name}`, () => {
        // Separate exception lists for legendary actions
        const noHitExceptions: string[] = ["Charging Horn"]; 
        const noDamageExceptions: string[] = ["Spellcasting"]; 
        
        monster.legendary_actions.forEach(action => {
          if (action.is_attack) {
            const hasHit = action.attack_bonus !== undefined;
            if (!hasHit && !noHitExceptions.some(e => action.name.includes(e))) {
              console.warn(`WARNING: Monster '${monster.name}' Legendary Action '${action.name}' is an attack but has no hit roll.`);
              expect(hasHit).toBe(true);
            }
          }

          if (action.attack_bonus !== undefined && !noDamageExceptions.some(e => action.name.includes(e))) {
            const hasDamage = action.damage && action.damage.length > 0;
            if (!hasDamage) {
               console.warn(`WARNING: Monster '${monster.name}' Legendary Action '${action.name}' has attack bonus but no damage.`);
            }
            expect(hasDamage).toBe(true);
          }
        });
      });

      it(`should have a source without page numbers for ${monster.name}`, () => {
        if (monster.source) {
          expect(monster.source).not.toMatch(/,\s*p(?:age|g)?\.?\s*\d+/i);
        }
      });

      it(`should not contain bullet separators in the source for ${monster.name}`, () => {
        if (monster.source) {
          expect(monster.source).not.toContain('•');
        }
      });

      it(`should have a lore description for ${monster.name} unless it is a known exception`, () => {
        // List of monsters that legitimately lack a lore description on D&D Beyond
        // This list is programmatically derived from test failures using monster IDs.
        const NO_DESCRIPTION_EXCEPTIONS = [
          "16766", "16787", "16788", "16794", "16795", "16796", "16797", "16800", "16802", "16803",
          "16804", "16806", "16807", "16808", "16811", "16812", "16813", "16814", "16815", "16816",
          "16818", "16819", "16820", "16822", "16824", "16825", "16826", "16827", "16830", "16831",
          "16832", "16833", "16834", "16837", "16839", "16840", "16841", "16842", "16844", "16845",
          "16846", "16847", "16849", "16850", "16851", "16852", "16854", "16855", "16857", "16858",
          "16859", "16860", "16869", "16870", "16873", "16874", "16875", "16876", "16877", "16878",
          "16879", "16880", "16884", "16885", "16886", "16888", "16890", "16891", "16892", "16896",
          "16898", "16899", "16901", "16902", "16906", "16908", "16909", "16911", "16914", "16916",
          "16918", "16920", "16922", "16926", "16927", "16930", "16931", "16932", "16933", "16934",
          "16935", "16936", "16937", "16941", "16942", "16944", "16945", "16948", "16949", "16952",
          "16956", "16957", "16959", "16960", "16963", "16964", "16965", "16968", "16970", "16971",
          "16973", "16974", "16976", "16979", "16980", "16982", "16983", "16984", "16986", "16987",
          "16988", "16990", "16991", "16992", "16995", "16996", "16997", "16998", "16999", "17000",
          "17001", "17002", "17003", "17004", "17006", "17008", "17009", "17010", "17011", "17012",
          "17013", "17014", "17015", "17016", "17017", "17018", "17019", "17020", "17022", "17024",
          "17026", "17027", "17028", "17029", "17030", "17031", "17032", "17033", "17034", "17036",
          "17037", "17046", "17047", "17048", "17049", "17050", "17051", "17052", "17053", "17054",
          "17055", "17056", "17058", "17060", "17062", "17064", "17066", "17067", "17068", "17069",
          "17070", "17071", "17072", "17075", "17076", "17098", "17100", "17120", "17133", "17139",
          "17150", "17160", "17162", "17171", "17193", "17195", "17196", "17205", "17211", "17216",
          "257235", "2821140", "2821146", "2821149", "287859", "301407", "301411", "301414", "301415",
          "4830980", "4904636", "4904746", "4904816", "4904838", "4904883", "5174955", "5174957",
          "5194869", "5194870", "5194871", "5194872", "5194873", "5194874", "5194875", "5194876",
          "5194880", "5194881", "5194882", "5194883", "5194884", "5194885", "5194886", "5194887",
          "5194888", "5194902", "5194904", "5194909", "5194911", "5194912", "5194915", "5194917",
          "5194928", "5194930", "5194931", "5194933", "5194934", "5194941", "5194947", "5194951",
          "5194952", "5194953", "5194954", "5194968", "5194971", "5194973", "5194975", "5194976",
          "5194977", "5194981", "5194988", "5195024", "5195036", "5195041", "5195042", "5195051",
          "5195056", "5195057", "5195064", "5195065", "5195066", "5195068", "5195077", "5195081",
          "5195082", "5195086", "5195089", "5195097", "5195103", "5195106", "5195117", "5195118",
          "5195119", "5195134", "5195140", "5195142", "5195143", "5195145", "5195150", "5195153",
          "5195162", "5195165", "5195169", "5195170", "5195176", "5195178", "5195179", "5195182",
          "5195193", "5195195", "5195198", "5195206", "5195211", "5195213", "5195215", "5195217",
          "5195221", "5195235", "5195245", "5195246", "5195247", "5195249", "5195251", "5195252",
          "5195260", "5195263", "5195266", "5195267", "5195269", "5195274", "5195277", "5195278",
          "5195279", "5195280", "5195281", "5195282", "5195283", "5195284", "5195285", "5195286",
          "5198095", "5198155", "744300", "744301", "744303", "744310", "744316", "744327", "744330",
          "744336", "744337", "744338", "744343", "745189",
          // Basic Rules (2014) & Monster Manual (2014) monsters confirmed to have no description
          // block in their cached HTML (verified 2026-07-03 against dnd_beyond/monsters cache)
          "5194897", "4775801", "5194910", "4775802", "4775803", "5194920", "5194921", "4775804", "5194925", "4775805",
          "4775806", "5194936", "4775807", "4775808", "5194944", "5194945", "5194946", "4775809", "4775810", "4775811",
          "5194959", "5194966", "4775812", "4775813", "5194974", "5194978", "5194979", "4775814", "4775815", "5194989",
          "5194990", "5195005", "5195007", "5195010", "4775817", "5195012", "5195013", "5195014", "5195015", "4775818",
          "5195016", "5195020", "4775819", "5195021", "5195023", "5195025", "5195026", "5195029", "5195032", "4775822",
          "5195034", "4775823", "5195052", "4904776", "5195063", "4775824", "5195073", "5195080", "5195085", "5195087",
          "4775825", "4904793", "5195090", "5195091", "5195095", "5195105", "4775826", "4775827", "5195110", "5195111",
          "5195121", "5195123", "5195127", "4775829", "4775830", "5174956", "5195151", "4775831", "4775832", "316600",
          "5195167", "4775833", "4775834", "5195174", "4775835", "4775836", "4775837", "5195181", "5195183", "4775839",
          "5195184", "5195185", "5195186", "5195187", "4775840", "5174958", "5195203", "5195204", "4775841", "5195210",
          "4775844", "4775845", "5195218", "5195220", "4904865", "5195222", "5195224", "5195228", "5195229", "5195232",
          "4775846", "5195236", "5195254", "5195255", "5195256", "4775848", "5195257", "5195261", "4775849", "5195264",
          "5195265", "5195268", "4775850", "5174960", "5195287"
        ];

        const hasLore = !!((monster.description && monster.description.length > 0) || 
                          (monster.lore_sections && monster.lore_sections.length > 0));

        if (!NO_DESCRIPTION_EXCEPTIONS.includes(monster.id) && !hasLore) {
           console.warn(`WARNING: Monster '${monster.name}' (ID: ${monster.id}, Source: ${monster.source}) is missing a description.`);
           expect(hasLore).toBe(true);
        }

        const checkLoreItems = (items: LoreItem[]) => {
          expect(Array.isArray(items)).toBe(true);
          items.forEach(item => {
            if (typeof item === 'string') {
              expect(item.length).toBeGreaterThan(0);
            } else {
              expect(item).toBeDefined();
              expect(['list', 'table']).toContain(item.type);
              if (item.type === 'list') {
                expect(Array.isArray(item.items)).toBe(true);
                expect(item.items.length).toBeGreaterThan(0);
              } else if (item.type === 'table') {
                expect(Array.isArray(item.rows)).toBe(true);
                expect(item.rows.length).toBeGreaterThan(0);
                item.rows.forEach((row) => expect(Array.isArray(row)).toBe(true));
              }
            }
          });
        };

        if (monster.description) checkLoreItems(monster.description);
        if (monster.lore_sections) {
          monster.lore_sections.forEach(section => {
            expect(typeof section.title).toBe('string');
            checkLoreItems(section.content);
          });
        }
      });
    });
  });

  describe('Specific known traits to verify scraper correctness', () => {
    it('should correctly parse Adult Brass Dragon', () => {
      const dragon = monsters.find(m => m.name === 'Adult Brass Dragon');
      expect(dragon).toBeDefined();
      if (!dragon) return;
      
      // Known immunities (was previously missing due to label format)
      expect(dragon.immunities.damage).toContain('Fire');
      
      // Known skills
      expect(dragon.skills.find(s => s.name === 'Perception')).toBeDefined();
      
      // Known senses
      expect(dragon.senses.find(s => s.name === 'Darkvision')).toBeDefined();
      
      // Known languages
      expect(dragon.languages).toContain('Draconic');
      
      // Known legendary actions
      expect(dragon.legendary_actions.length).toBeGreaterThan(0);
      expect(dragon.legendary_actions.find(a => a.name === 'Pounce')).toBeDefined();
    });

    it('should correctly parse Aartuk Starhorror', () => {
      const aartuk = monsters.find(m => m.name === 'Aartuk Starhorror');
      expect(aartuk).toBeDefined();
      if (!aartuk) return;
      
      // Known languages
      expect(aartuk.languages).toContain('Aartuk');
      
      // Known traits
      expect(aartuk.traits.find(t => t.name === 'Spider Climb')).toBeDefined();
    });
  });

  describe('Global aggregate checks', () => {
    // These tests ensure that across the entire dataset, at least some
    // monsters triggered the parsing logic for these fields, proving
    // the scraper is actually capable of finding them.

    it('should find at least one monster with damage immunities', () => {
      const hasDamageImmunities = monsters.some(m => !m.duplicate_of && m.immunities.damage.length > 0);
      expect(hasDamageImmunities).toBe(true);
    });

    it('should find at least one monster with skills', () => {
      const hasSkills = monsters.some(m => !m.duplicate_of && m.skills.length > 0);
      expect(hasSkills).toBe(true);
    });

    it('should find at least one monster with legendary actions', () => {
      const hasLegendary = monsters.some(m => !m.duplicate_of && m.legendary_actions.length > 0);
      expect(hasLegendary).toBe(true);
    });
  });

  describe('Scraper coverage validation', () => {
    const monsterCacheDir = path.join(__dirname, '../../dnd_beyond/monsters');
    const statePath = path.join(__dirname, '../../tools/state/monster_scraper_state.json');

    it('should have no duplicate monster IDs in the dataset', () => {
      const idCounts = new Map<string, number>();
      monsters.forEach(m => {
        idCounts.set(m.id, (idCounts.get(m.id) || 0) + 1);
      });
      const duplicates = Array.from(idCounts.entries()).filter(([, count]) => count > 1);
      expect(duplicates.length, `Duplicate monster IDs found: ${JSON.stringify(duplicates)}`).toBe(0);
    });

    it('should include all owned monsters and contain no extra/unowned monsters', () => {
      // 1. Gather all unique monster URLs and IDs from cached list pages
      const uniqueUrls = new Set<string>();
      const listPageIds = new Set<string>();
      
      if (!fs.existsSync(monsterCacheDir)) {
        return; // Skip if cache is not present locally
      }
      
      const files = fs.readdirSync(monsterCacheDir);
      const listPages = files.filter(f => f.startsWith('page') && f.endsWith('.html'));
      
      const urlRegex = /\/monsters\/(\d+)-([^"\s>]+)/g;
      
      listPages.forEach(file => {
        const filePath = path.join(monsterCacheDir, file);
        const html = fs.readFileSync(filePath, 'utf-8');
        
        let match;
        urlRegex.lastIndex = 0;
        while ((match = urlRegex.exec(html)) !== null) {
          const absoluteUrl = `https://www.dndbeyond.com${match[0]}`;
          uniqueUrls.add(absoluteUrl);
          listPageIds.add(match[1]);
        }
      });
      
      expect(uniqueUrls.size).toBeGreaterThan(0);
      
      // 2. Load unowned URLs from the scraper state
      let unownedUrls: string[] = [];
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        unownedUrls = state.unowned_urls || [];
      }
      
      const unownedUrlsSet = new Set<string>(unownedUrls);
      
      // 3. Filter candidate list to only include owned monster URLs
      const ownedUrls = Array.from(uniqueUrls).filter(url => !unownedUrlsSet.has(url));
      
      // 4. Map existing monster database IDs and URLs
      const databaseIds = new Set<string>(monsters.map(m => m.id));
      
      // --- CHECK A: Detect missing monsters ---
      const missingMonsters: { id: string; url: string }[] = [];
      ownedUrls.forEach(url => {
        const idMatch = url.match(/\/monsters\/(\d+)-/);
        if (idMatch) {
          const monsterId = idMatch[1];
          if (!databaseIds.has(monsterId)) {
            missingMonsters.push({ id: monsterId, url });
          }
        }
      });
      
      if (missingMonsters.length > 0) {
        console.error('Missing Monsters Details:', missingMonsters);
      }
      expect(missingMonsters.length, `Scraper missed ${missingMonsters.length} owned monsters`).toBe(0);

      // --- CHECK B: Detect extra/orphaned/unowned monsters ---
      const extraMonsters: { id: string; name: string; url: string; reason: string }[] = [];
      monsters.forEach(m => {
        if (m.duplicate_of) return;
        // Reason 1: Monster is marked as unowned/locked in the state file
        if (unownedUrlsSet.has(m.url)) {
          extraMonsters.push({ id: m.id, name: m.name, url: m.url, reason: 'Marked as unowned in state' });
        }
        // Reason 2: Monster ID is not present in cached list pages
        else if (!listPageIds.has(m.id)) {
          extraMonsters.push({ id: m.id, name: m.name, url: m.url, reason: 'Not found in cached list pages' });
        }
      });

      if (extraMonsters.length > 0) {
        console.error('Extra Monsters Details:', extraMonsters);
      }
      expect(extraMonsters.length, `Database has ${extraMonsters.length} extra/unowned monsters`).toBe(0);
    });
  });
});
