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
          expect(typeof monster.stats[stat].save).toBe('number');
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
