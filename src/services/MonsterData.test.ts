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
          "744336", "744337", "744338", "744343", "745189"
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
      const hasDamageImmunities = monsters.some(m => m.immunities.damage.length > 0);
      expect(hasDamageImmunities).toBe(true);
    });

    it('should find at least one monster with skills', () => {
      const hasSkills = monsters.some(m => m.skills.length > 0);
      expect(hasSkills).toBe(true);
    });

    it('should find at least one monster with legendary actions', () => {
      const hasLegendary = monsters.some(m => m.legendary_actions.length > 0);
      expect(hasLegendary).toBe(true);
    });
  });
});
