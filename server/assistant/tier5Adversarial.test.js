import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { db } from '../db.js';
import hitlManager, {
  createProposal,
  getProposal,
  listPendingProposals,
  resolveProposal,
  clearProposals,
} from './hitlManager.js';
import {
  executeTool,
  registerBuiltInWriteTools,
  clearWriteTools,
  labelToCoordinate,
  coordinateToLabel,
  columnIndexToLabel,
  columnLabelToIndex,
  calculateDistance,
} from './toolController.js';
import {
  projectHpApplication,
  hasDamageImmunity,
  hasDamageResistance,
  hasDamageVulnerability,
} from './combatHpUtils.js';
import {
  parseScenarioCombatants,
  allocateTokenCoordinates,
  formatPhaseLabel,
} from './combatantParser.js';

describe('Tier 5 Adversarial Coverage Hardening: Backend & HITL Security Invariants', () => {
  const campaignId = 't5-adv-camp';
  const encounterId = 't5-adv-enc';
  const heroId = 't5-hero-1';
  const monsterId = 't5-monster-1';
  const bossId = 't5-boss-1';

  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();

    // Clean test database records
    db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);

    // Setup base campaign
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
      campaignId,
      'Tier 5 Hardening Campaign',
      'Adversarial stress testing suite'
    );

    // Setup base encounter with grid_config and running state
    const runningState = JSON.stringify({
      isCombatStarted: true,
      round: 1,
      turnIndex: 0,
      activePhases: [1],
      combatants: [
        {
          instanceId: heroId,
          name: 'Valeros the Bold',
          currentHp: 45,
          maxHp: 50,
          tempHp: 10,
          initiative: 18,
          isPlayer: true,
          faction: 'ally',
          position: { x: 2, y: 3 }, // C4
        },
        {
          instanceId: monsterId,
          name: 'Cave Troll',
          currentHp: 30,
          maxHp: 30,
          tempHp: 0,
          initiative: 8,
          isPlayer: false,
          faction: 'enemy',
          position: { x: 5, y: 5 }, // F6
          fullData: {
            resistances: ['bludgeoning', 'fire, cold'],
            immunities: { damage: ['poison'] },
            vulnerabilities: ['acid'],
          },
        },
        {
          instanceId: bossId,
          name: 'Archmage Zephyr',
          currentHp: 60,
          maxHp: 60,
          tempHp: 20,
          initiative: 20,
          isPlayer: false,
          faction: 'enemy',
          position: { x: 10, y: 10 }, // K11
          fullData: {
            resistances: ['lightning'],
            vulnerabilities: ['force'],
          },
        },
      ],
      combatLog: [],
    });

    const gridConfig = JSON.stringify({
      columns: 25,
      rows: 25,
      cellPitch: 50,
      regions: [
        {
          id: 'reg-throne',
          name: 'Throne Platform',
          bounds: { minCol: 0, maxCol: 5, minRow: 0, maxRow: 5 },
          cells: ['0,0', '1,1', '2,2', '2,3', '3,3'],
        },
        {
          id: 'reg-pit',
          name: 'Acid Pit',
          bounds: { minCol: 8, maxCol: 15, minRow: 8, maxRow: 15 },
          cells: ['10,10', '11,11'],
        },
      ],
    });

    db.prepare(`
      INSERT INTO encounters (id, campaign_id, name, running_state, grid_config)
      VALUES (?, ?, ?, ?, ?)
    `).run(encounterId, campaignId, 'Chamber of Trials', runningState, gridConfig);

    // Insert corresponding encounter units
    const insertUnit = db.prepare(`
      INSERT INTO encounter_units (
        instanceId, encounter_id, campaign_id, name, maxHp, currentHp, tempHp, dexMod,
        initiative, isPlayer, position_x, position_y, phase, faction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertUnit.run(heroId, encounterId, campaignId, 'Valeros the Bold', 50, 45, 10, 2, 18, 1, 2, 3, 1, 'ally');
    insertUnit.run(monsterId, encounterId, campaignId, 'Cave Troll', 30, 30, 0, 0, 8, 0, 5, 5, 1, 'enemy');
    insertUnit.run(bossId, encounterId, campaignId, 'Archmage Zephyr', 60, 60, 20, 3, 20, 0, 10, 10, 1, 'enemy');
  });

  // =========================================================================
  // 1. EXTREME COORDINATES & BOUNDARY INPUTS
  // =========================================================================
  describe('1. Extreme Coordinates & Boundary Parsing', () => {
    it('1.1 parses valid spreadsheet and comma-separated coordinates across boundaries', () => {
      expect(labelToCoordinate('A1')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate('Z26')).toEqual({ x: 25, y: 25 });
      expect(labelToCoordinate('AA1')).toEqual({ x: 26, y: 0 });
      expect(labelToCoordinate('ZZ999')).toEqual({ x: 701, y: 998 });
      expect(labelToCoordinate('0,0')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate(' 24 , 49 ')).toEqual({ x: 24, y: 49 });
      expect(labelToCoordinate('1000, 2000')).toEqual({ x: 1000, y: 2000 });
      expect(labelToCoordinate('A-1')).toEqual({ x: 0, y: 0 });
      expect(labelToCoordinate('B_12')).toEqual({ x: 1, y: 11 });
    });

    it('1.2 rejects zero and negative row numbers in spreadsheet notation', () => {
      expect(() => labelToCoordinate('A0')).toThrow(/row number must be >= 1/i);
      expect(() => labelToCoordinate('M-0')).toThrow(/row number must be >= 1/i);
    });

    it('1.3 rejects malformed strings, SQL injections, and invalid types', () => {
      expect(() => labelToCoordinate('')).toThrow(/non-empty string/i);
      expect(() => labelToCoordinate('   ')).toThrow(/Expected format/i);
      expect(() => labelToCoordinate('ZZZ')).toThrow(/Expected format/i);
      expect(() => labelToCoordinate('12345')).toThrow(/Expected format/i);
      expect(() => labelToCoordinate('!@#$%')).toThrow(/Expected format/i);
      expect(() => labelToCoordinate('; DROP TABLE users; --')).toThrow(/Expected format/i);
      expect(() => labelToCoordinate('-5, 10')).toThrow(/Expected format/i);
      expect(() => labelToCoordinate('10, -5')).toThrow(/Expected format/i);
      expect(() => labelToCoordinate('-5, -10')).toThrow(/Expected format/i);
      expect(() => labelToCoordinate(null)).toThrow(/non-empty string/i);
      expect(() => labelToCoordinate(undefined)).toThrow(/non-empty string/i);
      expect(() => labelToCoordinate(123)).toThrow(/non-empty string/i);
      expect(() => labelToCoordinate({})).toThrow(/non-empty string/i);
    });

    it('1.4 verifies bidirectional coordinate-label round trips', () => {
      const testCases = [
        { x: 0, y: 0, label: 'A1' },
        { x: 25, y: 0, label: 'Z1' },
        { x: 26, y: 0, label: 'AA1' },
        { x: 27, y: 4, label: 'AB5' },
        { x: 701, y: 99, label: 'ZZ100' },
      ];

      for (const tc of testCases) {
        expect(coordinateToLabel(tc.x, tc.y)).toBe(tc.label);
        expect(labelToCoordinate(tc.label)).toEqual({ x: tc.x, y: tc.y });
      }

      // Negative indices produce empty column label without crash
      expect(columnIndexToLabel(-1)).toBe('');
      expect(columnIndexToLabel(-999)).toBe('');
      expect(columnIndexToLabel('invalid')).toBe('');
      expect(columnLabelToIndex('')).toBe(-1);
      expect(columnLabelToIndex('123')).toBe(-1);
      expect(columnLabelToIndex('A-B')).toBe(-1);
    });

    it('1.5 rejects move_combatant destinations parsed outside the map grid bounds (ZZ999)', async () => {
      // The test encounter's grid_config declares a 25x25 grid; "ZZ999"
      // parses to (701, 998), far outside it. This must be rejected rather
      // than silently staged (see G-11), since a proposal for an
      // off-the-map destination would otherwise reach the DM as if valid.
      await expect(
        executeTool(
          'move_combatant',
          {
            combatantId: heroId,
            destination: 'ZZ999',
            encounterId,
          },
          { campaignId }
        )
      ).rejects.toThrow(/outside the 25x25 map grid/i);
    });

    it('1.5b stages move_combatant to a destination within the map grid bounds', async () => {
      const res = await executeTool(
        'move_combatant',
        {
          combatantId: heroId,
          destination: 'T20',
          encounterId,
        },
        { campaignId }
      );

      expect(res.status).toBe('proposal_staged');
      expect(res.proposal.payload.destination).toEqual({
        x: 19,
        y: 19,
        label: 'T20',
        regionName: undefined,
      });
      expect(res.proposal.payload.origin).toEqual({
        x: 2,
        y: 3,
        label: 'C4',
        regionName: 'Throne Platform',
      });
    });

    it('1.6 handles zero-distance movement (same origin and destination) safely', async () => {
      const res = await executeTool(
        'move_combatant',
        {
          combatantId: heroId,
          destination: 'C4', // Current position
          encounterId,
        },
        { campaignId }
      );

      expect(res.status).toBe('proposal_staged');
      expect(res.proposal.payload.origin.label).toBe('C4');
      expect(res.proposal.payload.destination.label).toBe('C4');
      expect(calculateDistance(res.proposal.payload.origin, res.proposal.payload.destination)).toBe(0);

      // Approve movement and verify state remains stable
      const confirmRes = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId: res.proposal.proposalId, action: 'approve' });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);

      const unit = db.prepare('SELECT position_x, position_y FROM encounter_units WHERE instanceId = ?').get(heroId);
      expect(unit.position_x).toBe(2);
      expect(unit.position_y).toBe(3);
    });

    it('1.7 allocates token coordinates outward when cells are congested without infinite loops', () => {
      const occupied = new Set(['5,5', '5,6', '6,5', '6,6', '4,5', '4,6', '5,4', '6,4', '4,4']);
      const gridConfig = { columns: 10, rows: 10 };

      const allocated = allocateTokenCoordinates({ x: 5, y: 5 }, occupied, gridConfig);
      // Must allocate an unoccupied cell within bounds and add it to occupied
      expect(occupied.has(`${allocated.x},${allocated.y}`)).toBe(true);
      expect(allocated.x >= 0 && allocated.x < 10).toBe(true);
      expect(allocated.y >= 0 && allocated.y < 10).toBe(true);
      // Distance from center must be > 1 since immediate 3x3 ring was full
      expect(Math.max(Math.abs(allocated.x - 5), Math.abs(allocated.y - 5))).toBeGreaterThanOrEqual(2);
    });

    it('1.8 throws when moving a combatant not found in the encounter', async () => {
      await expect(
        executeTool(
          'move_combatant',
          { combatantId: 'non-existent-unit-id', destination: 'A1', encounterId },
          { campaignId }
        )
      ).rejects.toThrow(/Combatant "non-existent-unit-id" not found/i);
    });

    it('1.9 rejects negative object coordinates { x: -5, y: -10 } in move_combatant', async () => {
      await expect(
        executeTool(
          'move_combatant',
          { combatantId: heroId, destination: { x: -5, y: -10 }, encounterId },
          { campaignId }
        )
      ).rejects.toThrow(/Invalid destination coordinates/i);
    });
  });

  // =========================================================================
  // 2. ZERO/NEGATIVE DAMAGE AMOUNTS & UNKNOWN DAMAGE TYPES
  // =========================================================================
  describe('2. Damage Calculation Engine & Edge Cases', () => {
    it('2.1 clamps negative and zero damage amounts to 0 without mutating HP', () => {
      const target = {
        instanceId: heroId,
        name: 'Valeros',
        currentHp: 45,
        maxHp: 50,
        tempHp: 10,
      };

      const negDmg = projectHpApplication(target, 'damage', -30);
      expect(negDmg.amount).toBe(0);
      expect(negDmg.projectedHp).toBe(45);
      expect(negDmg.projectedTempHp).toBe(10);
      expect(negDmg.effectiveChange).toContain('0');

      const zeroDmg = projectHpApplication(target, 'damage', 0);
      expect(zeroDmg.amount).toBe(0);
      expect(zeroDmg.projectedHp).toBe(45);
      expect(zeroDmg.projectedTempHp).toBe(10);
    });

    it('2.2 clamps negative and zero healing amounts to 0', () => {
      const target = {
        instanceId: heroId,
        name: 'Valeros',
        currentHp: 30,
        maxHp: 50,
        tempHp: 0,
      };

      const negHeal = projectHpApplication(target, 'healing', -15);
      expect(negHeal.amount).toBe(0);
      expect(negHeal.projectedHp).toBe(30);

      const zeroHeal = projectHpApplication(target, 'healing', 0);
      expect(zeroHeal.amount).toBe(0);
      expect(zeroHeal.projectedHp).toBe(30);
    });

    it('2.3 caps healing at maxHp (overheal clamp)', () => {
      const target = {
        instanceId: heroId,
        name: 'Valeros',
        currentHp: 45,
        maxHp: 50,
        tempHp: 0,
      };

      const overheal = projectHpApplication(target, 'healing', 100);
      expect(overheal.projectedHp).toBe(50);
      expect(overheal.effectiveChange).toBe('+5 HP');
    });

    it('2.4 clamps overkill damage at 0 HP (never negative)', () => {
      const target = {
        instanceId: monsterId,
        name: 'Cave Troll',
        currentHp: 10,
        maxHp: 30,
        tempHp: 5,
      };

      const overkill = projectHpApplication(target, 'damage', 9999);
      expect(overkill.projectedHp).toBe(0);
      expect(overkill.projectedTempHp).toBe(0);
      expect(overkill.effectiveChange).toContain('-5 temp, -10 HP');
    });

    it('2.5 enforces 5e Temporary HP precedence (absorption order and non-stacking)', () => {
      const target = {
        instanceId: heroId,
        name: 'Valeros',
        currentHp: 40,
        maxHp: 50,
        tempHp: 15,
      };

      // 1. Partial temp HP absorption (5 damage absorbed, 10 temp remains, HP untouched)
      const p1 = projectHpApplication(target, 'damage', 5);
      expect(p1.projectedTempHp).toBe(10);
      expect(p1.projectedHp).toBe(40);
      expect(p1.effectiveChange).toBe('-5 temp');

      // 2. Exact temp HP absorption (15 damage absorbed, 0 temp remains, HP untouched)
      const p2 = projectHpApplication(target, 'damage', 15);
      expect(p2.projectedTempHp).toBe(0);
      expect(p2.projectedHp).toBe(40);
      expect(p2.effectiveChange).toBe('-15 temp');

      // 3. Excess damage penetration (15 temp absorbed, 10 HP lost)
      const p3 = projectHpApplication(target, 'damage', 25);
      expect(p3.projectedTempHp).toBe(0);
      expect(p3.projectedHp).toBe(30);
      expect(p3.effectiveChange).toBe('-15 temp, -10 HP');

      // 4. Non-stacking rule: lesser temp HP does NOT replace existing
      const p4 = projectHpApplication(target, 'temp_hp', 8);
      expect(p4.projectedTempHp).toBe(15);
      expect(p4.effectiveChange).toContain('No change');

      // 5. Non-stacking rule: greater temp HP replaces existing
      const p5 = projectHpApplication(target, 'temp_hp', 25);
      expect(p5.projectedTempHp).toBe(25);
      expect(p5.effectiveChange).toContain('set to 25');
    });

    it('2.6 correctly evaluates complex, delimited, and unknown damage types', () => {
      const troll = {
        name: 'Cave Troll',
        currentHp: 30,
        maxHp: 30,
        tempHp: 0,
        fullData: {
          resistances: ['bludgeoning', 'fire, cold'],
          immunities: { damage: ['poison'] },
          vulnerabilities: ['acid'],
        },
      };

      // Unknown damage type ('banana', 'cosmic') applies normal unresisted damage
      const unknownDmg = projectHpApplication(troll, 'damage', 10, 'banana');
      expect(unknownDmg.projectedHp).toBe(20);
      expect(unknownDmg.effectiveChange).toBe('-10 HP');

      // Resistance: 'fire' from comma-separated 'fire, cold' list (halved: 10 / 2 = 5)
      const fireDmg = projectHpApplication(troll, 'damage', 10, 'fire');
      expect(fireDmg.projectedHp).toBe(25);
      expect(fireDmg.effectiveChange).toContain('(resisted)');

      // Resistance with odd number: floor(7 / 2) = 3
      const oddFireDmg = projectHpApplication(troll, 'damage', 7, 'fire');
      expect(oddFireDmg.projectedHp).toBe(27);

      // Immunity: 'poison' (0 damage)
      const poisonDmg = projectHpApplication(troll, 'damage', 50, 'poison');
      expect(poisonDmg.projectedHp).toBe(30);
      expect(poisonDmg.effectiveChange).toContain('Immune');

      // Vulnerability: 'acid' (doubled: 10 * 2 = 20)
      const acidDmg = projectHpApplication(troll, 'damage', 10, 'acid');
      expect(acidDmg.projectedHp).toBe(10);
      expect(acidDmg.effectiveChange).toContain('(vulnerable)');
    });

    it('2.7 rejects unsupported action types cleanly with descriptive error and defaults empty string to damage', () => {
      const target = { name: 'Target', currentHp: 20, maxHp: 20 };
      expect(() => projectHpApplication(target, 'disintegrate', 100)).toThrow(/Unsupported actionType "disintegrate"/i);
      expect(() => projectHpApplication(target, 'kill', 1)).toThrow(/Unsupported actionType "kill"/i);
      expect(() => projectHpApplication(target, 'resurrect', 10)).toThrow(/Unsupported actionType "resurrect"/i);

      // Empty or undefined actionType cleanly defaults to 'damage'
      const defaultRes = projectHpApplication(target, '', 5);
      expect(defaultRes.actionType).toBe('damage');
      expect(defaultRes.projectedHp).toBe(15);
    });

    it('2.8 stages and executes multi-target proposal with mixed effects atomically', async () => {
      const res = await executeTool(
        'apply_combat_damage',
        {
          encounterId,
          targets: [
            { combatantId: heroId, amount: 15, actionType: 'damage' }, // 10 temp absorbed, 5 HP lost (45 -> 40)
            { combatantId: monsterId, amount: 10, actionType: 'healing' }, // 30 -> 30 (at max)
            { combatantId: bossId, amount: 35, actionType: 'temp_hp' }, // 20 -> 35
          ],
        },
        { campaignId }
      );

      expect(res.status).toBe('proposal_staged');
      expect(res.proposal.payload.targets.length).toBe(3);

      // Approve proposal
      const confirmRes = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId: res.proposal.proposalId, action: 'approve' });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);

      // Verify SQLite state after atomic commit
      const hero = db.prepare('SELECT currentHp, tempHp FROM encounter_units WHERE instanceId = ?').get(heroId);
      const monster = db.prepare('SELECT currentHp, tempHp FROM encounter_units WHERE instanceId = ?').get(monsterId);
      const boss = db.prepare('SELECT currentHp, tempHp FROM encounter_units WHERE instanceId = ?').get(bossId);

      expect(hero.currentHp).toBe(40);
      expect(hero.tempHp).toBe(0);
      expect(monster.currentHp).toBe(30);
      expect(boss.tempHp).toBe(35);

      // Verify combat log was recorded in running_state
      const enc = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
      const rs = JSON.parse(enc.running_state);
      expect(rs.combatLog.length).toBeGreaterThan(0);
      expect(rs.combatLog[0].type).toBe('combat_damage');
    });

    it('2.9 rejects empty or non-array targets in apply_combat_damage', async () => {
      await expect(
        executeTool('apply_combat_damage', { encounterId, targets: [] }, { campaignId })
      ).rejects.toThrow(/targets must be a non-empty array/i);

      await expect(
        executeTool('apply_combat_damage', { encounterId, targets: null }, { campaignId })
      ).rejects.toThrow(/targets must be a non-empty array/i);
    });

    it('2.10 throws when a target combatant is not found in the encounter', async () => {
      await expect(
        executeTool(
          'apply_combat_damage',
          {
            encounterId,
            targets: [{ combatantName: 'Unknown Ghost', amount: 10, actionType: 'damage' }],
          },
          { campaignId }
        )
      ).rejects.toThrow(/Combatant "Unknown Ghost" not found/i);
    });

    it('2.11 safely handles non-string damageType (e.g. number 42) without TypeError crash', () => {
      const troll = {
        name: 'Cave Troll',
        currentHp: 30,
        maxHp: 30,
        tempHp: 0,
        fullData: { resistances: ['fire'] },
      };

      // Calling with non-string damageType safely coerces to undefined without crashing
      expect(() => projectHpApplication(troll, 'damage', 10, 42)).not.toThrow();
      const res = projectHpApplication(troll, 'damage', 10, 42);
      expect(res.projectedHp).toBe(20);
    });
  });

  // =========================================================================
  // 3. HIGH PHASE NUMBERS & EMPTY SCENARIO TEXT
  // =========================================================================
  describe('3. Scenario Text Parser & Phase Customization', () => {
    it('3.1 rejects empty string or whitespace scenarioText with clean error', async () => {
      await expect(
        executeTool('configure_encounter_combatants', { scenarioText: '', encounterId }, { campaignId })
      ).rejects.toThrow(/No combatants could be identified/i);

      await expect(
        executeTool('configure_encounter_combatants', { scenarioText: '   \n\t  ', encounterId }, { campaignId })
      ).rejects.toThrow(/No combatants could be identified/i);
    });

    it('3.2 rejects narrative scenarioText with zero combatants identified', async () => {
      const ambientText = 'The moonlight shines through the ancient stained glass windows. Silence fills the dusty cathedral.';
      await expect(
        executeTool('configure_encounter_combatants', { scenarioText: ambientText, encounterId }, { campaignId })
      ).rejects.toThrow(/No combatants could be identified/i);
    });

    it('3.3 handles extreme high phase numbers (phase 999) accurately', async () => {
      const res = await executeTool(
        'configure_encounter_combatants',
        {
          encounterId,
          combatants: [
            {
              name: 'Abyssal Overlord',
              coordinates: 'D5',
              phase: 999,
              faction: 'enemy',
              hp: 250,
            },
            {
              name: 'Vanguard Scout',
              coordinates: 'A1',
              phase: 1,
              faction: 'enemy',
              hp: 15,
            },
          ],
        },
        { campaignId }
      );

      expect(res.status).toBe('proposal_staged');
      expect(res.proposal.payload.combatants.length).toBe(2);
      expect(res.proposal.description).toContain('Phase 1: Initial Wave');
      expect(res.proposal.description).toContain('Phase 999: Reinforcements');

      // Approve proposal and verify DB stores phase 999
      const confirmRes = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId: res.proposal.proposalId, action: 'approve' });

      expect(confirmRes.status).toBe(200);

      const overlord = db.prepare('SELECT phase, maxHp FROM encounter_units WHERE name = ?').get('Abyssal Overlord');
      expect(overlord.phase).toBe(999);
      expect(overlord.maxHp).toBe(250);
    });

    it('3.4 rejects invalid phase numbers (0, negative, NaN)', async () => {
      await expect(
        executeTool(
          'configure_encounter_combatants',
          {
            encounterId,
            combatants: [{ name: 'Orc', coordinates: 'A1', phase: 0 }],
          },
          { campaignId }
        )
      ).rejects.toThrow(/Phase must be >= 1/i);

      await expect(
        executeTool(
          'configure_encounter_combatants',
          {
            encounterId,
            combatants: [{ name: 'Orc', coordinates: 'A1', phase: -3 }],
          },
          { campaignId }
        )
      ).rejects.toThrow(/Phase must be >= 1/i);

      await expect(
        executeTool(
          'configure_encounter_combatants',
          {
            encounterId,
            combatants: [{ name: 'Orc', coordinates: 'A1', phase: 'invalid' }],
          },
          { campaignId }
        )
      ).rejects.toThrow(/Phase must be >= 1/i);
    });

    it('3.5 parses multi-wave high-phase reinforcement scenario text', () => {
      const scenario = `
        Initial wave: 2 Goblins emerge at A1.
        Phase 12 reinforcements: 1 Ogre enters at M9.
      `;

      const combatants = parseScenarioCombatants(scenario, {
        grid_config: JSON.stringify({ columns: 20, rows: 20 }),
      });

      expect(combatants.length).toBe(3);
      const goblins = combatants.filter((c) => c.name.toLowerCase().includes('goblin'));
      const ogre = combatants.find((c) => c.name.toLowerCase().includes('ogre'));

      expect(goblins.length).toBe(2);
      expect(goblins[0].phase).toBe(1);
      expect(ogre).toBeDefined();
      expect(ogre.phase).toBe(12);
      expect(formatPhaseLabel(12)).toBe('Phase 12: Reinforcements');
    });

    it('3.6 rejects malformed combatant list entries (missing name, missing coordinates)', async () => {
      await expect(
        executeTool(
          'configure_encounter_combatants',
          {
            encounterId,
            combatants: [{ coordinates: 'A1' }], // missing name
          },
          { campaignId }
        )
      ).rejects.toThrow(/name is required/i);

      await expect(
        executeTool(
          'configure_encounter_combatants',
          {
            encounterId,
            combatants: [{ name: 'Ghost' }], // missing coordinates
          },
          { campaignId }
        )
      ).rejects.toThrow(/coordinates are required/i);

      await expect(
        executeTool(
          'configure_encounter_combatants',
          {
            encounterId,
            combatants: [{ name: 'Ghost', coordinates: 'INVALID_COORDS' }],
          },
          { campaignId }
        )
      ).rejects.toThrow(/Invalid coordinate label/i);
    });

    it('3.7 throws when combatants array is empty and no scenarioText provided', async () => {
      await expect(
        executeTool('configure_encounter_combatants', { encounterId, combatants: [] }, { campaignId })
      ).rejects.toThrow(/No combatants could be identified/i);
    });

    it('3.8 defaults unknown or invalid faction strings to "enemy"', async () => {
      const res = await executeTool(
        'configure_encounter_combatants',
        {
          encounterId,
          combatants: [{ name: 'Mutant Raider', coordinates: 'E5', faction: 'unknown_faction' }],
        },
        { campaignId }
      );

      expect(res.status).toBe('proposal_staged');
      expect(res.proposal.payload.combatants[0].faction).toBe('enemy');
    });
  });

  // =========================================================================
  // 4. CONCURRENT PROPOSALS, STALE/EXPIRED PROPOSALS & REPLAY INVARIANTS
  // =========================================================================
  describe('4. Proposal Lifecycle, Concurrency & Stale-State Security', () => {
    it('4.1 rejects approval with 409 Conflict when a live move_combatant proposal is staged, then the target roster changes before approval', async () => {
      let mutationRan = false;
      hitlManager.registerExecutionHandler('test_stale_tool', async () => {
        mutationRan = true;
        return { executionSummary: 'Should never run' };
      });
      // Simulate a hasher whose answer changes once the "encounter" is
      // touched, standing in for computeEncounterStateHash actually
      // observing a real DB change between staging and approval.
      let liveHash = 'hash-at-staging-time';
      hitlManager.registerStateHasher('test_stale_tool', async () => liveHash);

      const proposal = createProposal({
        toolName: 'test_stale_tool',
        description: 'Stale probe',
        stateHash: liveHash,
      });

      expect(proposal.status).toBe('pending');
      expect(listPendingProposals().length).toBe(1);

      // Something else (another approved proposal, a manual DM edit) changes
      // the encounter's state before this proposal is resolved.
      liveHash = 'hash-after-someone-else-changed-the-encounter';

      // A changed-state proposal is still visible in the pending queue right
      // up until someone tries to resolve it — unlike a timer, staleness is
      // only detected at the moment of approval, not proactively.
      expect(listPendingProposals().length).toBe(1);

      // Attempt to approve the now-stale proposal via API -> 409 Conflict
      const approveRes = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId: proposal.proposalId, action: 'approve' });

      expect(approveRes.status).toBe(409);
      expect(approveRes.body.error).toMatch(/state.*changed/i);
      expect(approveRes.body.status).toBe('stale');
      expect(mutationRan).toBe(false);
      expect(getProposal(proposal.proposalId).status).toBe('stale');

      // A stale rejection is terminal: a second attempt (approve or deny)
      // must not retry the hash check or run the mutation, just report
      // it's already resolved.
      const denyRes = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId: proposal.proposalId, action: 'deny' });

      expect(denyRes.status).toBe(409);
      expect(denyRes.body.status).toBe('stale');
      expect(mutationRan).toBe(false);
    });

    it('4.2 supports multiple concurrent, independent proposals across tools without collision, scoped to different campaigns', async () => {
      // Each proposal here is staged against its own campaign/encounter to
      // exercise genuinely independent, non-colliding proposals — unique
      // IDs, isolated resolution, no cross-talk.
      const campA = 'tier5-concurrent-camp-a';
      const campB = 'tier5-concurrent-camp-b';
      const campC = 'tier5-concurrent-camp-c';
      const setups = [campA, campB, campC].map((camp, idx) => {
        const encId = `${camp}-enc`;
        const unitId = `${camp}-unit`;
        db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(camp);
        db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(camp);
        db.prepare('INSERT OR IGNORE INTO campaigns (id, name) VALUES (?, ?)').run(camp, `Concurrency Campaign ${idx}`);
        db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(
          encId,
          camp,
          `Concurrency Encounter ${idx}`,
          JSON.stringify({ isCombatStarted: true, round: 1, combatants: [], combatLog: [] })
        );
        db.prepare(
          'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, isPlayer, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(unitId, encId, camp, `Unit ${idx}`, 30, 30, 0, 0, 0, 0);
        return { camp, encId, unitId };
      });

      const resA = await executeTool(
        'move_combatant',
        { combatantId: setups[0].unitId, destination: 'D4', encounterId: setups[0].encId },
        { campaignId: setups[0].camp }
      );
      const resB = await executeTool(
        'apply_combat_damage',
        { encounterId: setups[1].encId, targets: [{ combatantId: setups[1].unitId, amount: 5, actionType: 'damage' }] },
        { campaignId: setups[1].camp }
      );
      const resC = await executeTool(
        'move_combatant',
        { combatantId: setups[2].unitId, destination: 'L12', encounterId: setups[2].encId },
        { campaignId: setups[2].camp }
      );

      const propIdA = resA.proposal.proposalId;
      const propIdB = resB.proposal.proposalId;
      const propIdC = resC.proposal.proposalId;

      // Verify unique IDs
      expect(new Set([propIdA, propIdB, propIdC]).size).toBe(3);

      // Verify all 3 pending (independent campaigns, so none superseded the others)
      expect(listPendingProposals().length).toBe(3);

      // Approve A
      const confA = await request(app).post('/api/assistant/confirm').send({ proposalId: propIdA, action: 'approve' });
      expect(confA.status).toBe(200);
      expect(confA.body.status).toBe('approved');

      // Deny B
      const confB = await request(app).post('/api/assistant/confirm').send({ proposalId: propIdB, action: 'deny' });
      expect(confB.status).toBe(200);
      expect(confB.body.status).toBe('denied');

      // Approve C
      const confC = await request(app).post('/api/assistant/confirm').send({ proposalId: propIdC, action: 'approve' });
      expect(confC.status).toBe(200);
      expect(confC.body.status).toBe('approved');

      // 0 pending remain
      expect(listPendingProposals().length).toBe(0);

      // Verify DB: unit A moved to D4, unit C moved to L12, unit B HP unmutated because B was denied
      const unitA = db.prepare('SELECT position_x, position_y FROM encounter_units WHERE instanceId = ?').get(setups[0].unitId);
      const unitC = db.prepare('SELECT position_x, position_y FROM encounter_units WHERE instanceId = ?').get(setups[2].unitId);
      const unitB = db.prepare('SELECT currentHp FROM encounter_units WHERE instanceId = ?').get(setups[1].unitId);

      expect(unitA.position_x).toBe(3);
      expect(unitA.position_y).toBe(3);
      expect(unitC.position_x).toBe(11);
      expect(unitC.position_y).toBe(11);
      expect(unitB.currentHp).toBe(30); // untouched!
    });

    it('4.2b staging a second proposal for the same campaign no longer supersedes the earlier one — both queue, and approving the first correctly makes a conflicting second one stale', async () => {
      const resA = await executeTool(
        'move_combatant',
        { combatantId: heroId, destination: 'A1', encounterId },
        { campaignId }
      );
      const resB = await executeTool(
        'move_combatant',
        { combatantId: heroId, destination: 'T20', encounterId },
        { campaignId }
      );

      // Both proposals are queued — the DM reviews them one at a time, and
      // an older one is never silently discarded just because a newer one
      // came in.
      const pending = listPendingProposals();
      expect(pending).toHaveLength(2);
      expect(pending[0].proposalId).toBe(resA.proposal.proposalId);
      expect(pending[1].proposalId).toBe(resB.proposal.proposalId);

      // Approving A actually moves the hero, which changes the encounter
      // state B's proposal was staged against (they target the same
      // combatant). B must now be rejected as stale rather than blindly
      // applied on top of a state it no longer reflects.
      const approveA = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId: resA.proposal.proposalId, action: 'approve' });
      expect(approveA.status).toBe(200);
      expect(approveA.body.status).toBe('approved');

      const approveB = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId: resB.proposal.proposalId, action: 'approve' });
      expect(approveB.status).toBe(409);
      expect(approveB.body.status).toBe('stale');

      // The hero ends up at A1 (from the approved proposal), not T20.
      const hero = db.prepare('SELECT position_x, position_y FROM encounter_units WHERE instanceId = ?').get(heroId);
      expect(hero.position_x).toBe(0);
      expect(hero.position_y).toBe(0);
    });

    it('4.2c does not supersede pending proposals across different campaigns', async () => {
      const otherCampaignId = 'tier5-supersede-other-camp';
      const otherEncounterId = 'tier5-supersede-other-enc';
      const otherUnitId = 'tier5-supersede-other-unit';
      db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(otherCampaignId);
      db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(otherCampaignId);
      db.prepare('INSERT OR IGNORE INTO campaigns (id, name) VALUES (?, ?)').run(otherCampaignId, 'Other Campaign');
      db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(
        otherEncounterId,
        otherCampaignId,
        'Other Encounter',
        JSON.stringify({ isCombatStarted: true, round: 1, combatants: [], combatLog: [] })
      );
      db.prepare(
        'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, isPlayer, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(otherUnitId, otherEncounterId, otherCampaignId, 'Other Unit', 20, 20, 0, 0, 0, 0);

      const resHere = await executeTool(
        'move_combatant',
        { combatantId: heroId, destination: 'A1', encounterId },
        { campaignId }
      );
      const resOther = await executeTool(
        'move_combatant',
        { combatantId: otherUnitId, destination: 'B2', encounterId: otherEncounterId },
        { campaignId: otherCampaignId }
      );

      expect(getProposal(resHere.proposal.proposalId).status).toBe('pending');
      expect(getProposal(resOther.proposal.proposalId).status).toBe('pending');
      expect(listPendingProposals()).toHaveLength(2);
    });

    it('4.3 prevents TOCTOU race conditions when multiple concurrent requests resolve the same proposal', async () => {
      let executionCount = 0;
      hitlManager.registerExecutionHandler('race_test_tool', async () => {
        await new Promise((r) => setTimeout(r, 40));
        executionCount++;
        return { executionSummary: `Executed #${executionCount}` };
      });

      const proposal = createProposal({
        toolName: 'race_test_tool',
        description: 'Race condition probe',
      });

      // Fire 4 simultaneous resolution attempts (3 approvals, 1 denial)
      const results = await Promise.all([
        request(app).post('/api/assistant/confirm').send({ proposalId: proposal.proposalId, action: 'approve' }),
        request(app).post('/api/assistant/confirm').send({ proposalId: proposal.proposalId, action: 'approve' }),
        request(app).post('/api/assistant/confirm').send({ proposalId: proposal.proposalId, action: 'deny' }),
        request(app).post('/api/assistant/confirm').send({ proposalId: proposal.proposalId, action: 'approve' }),
      ]);

      const statuses = results.map((r) => r.status);
      const successful = statuses.filter((s) => s === 200);
      const conflicts = statuses.filter((s) => s === 409);

      // Exactly ONE request wins; the other 3 receive 409 Conflict
      expect(successful.length).toBe(1);
      expect(conflicts.length).toBe(3);
      expect(executionCount).toBe(1);
    });

    it('4.4 guarantees ZERO mutation on denial across all write tools', async () => {
      // Snapshot full database tables before test
      const unitsBefore = db.prepare('SELECT * FROM encounter_units WHERE campaign_id = ? ORDER BY instanceId').all(campaignId);
      const encBefore = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);

      // 1. Stage Movement and Deny
      const mRes = await executeTool(
        'move_combatant',
        { combatantId: heroId, destination: 'H8', encounterId },
        { campaignId }
      );
      const d1 = await request(app).post('/api/assistant/confirm').send({ proposalId: mRes.proposal.proposalId, action: 'deny' });
      expect(d1.body.cancelled).toBe(true);

      // 2. Stage Damage and Deny
      const dmgRes = await executeTool(
        'apply_combat_damage',
        { encounterId, targets: [{ combatantId: heroId, amount: 20, actionType: 'damage' }] },
        { campaignId }
      );
      const d2 = await request(app).post('/api/assistant/confirm').send({ proposalId: dmgRes.proposal.proposalId, action: 'deny' });
      expect(d2.body.cancelled).toBe(true);

      // 3. Stage Combatant Config and Deny
      const cfgRes = await executeTool(
        'configure_encounter_combatants',
        {
          encounterId,
          combatants: [{ name: 'Infiltrator', coordinates: 'E5', phase: 1 }],
        },
        { campaignId }
      );
      const d3 = await request(app).post('/api/assistant/confirm').send({ proposalId: cfgRes.proposal.proposalId, action: 'deny' });
      expect(d3.body.cancelled).toBe(true);

      // Verify ZERO mutation: state must match snapshot identically
      const unitsAfter = db.prepare('SELECT * FROM encounter_units WHERE campaign_id = ? ORDER BY instanceId').all(campaignId);
      const encAfter = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);

      expect(unitsAfter).toEqual(unitsBefore);
      expect(encAfter.running_state).toBe(encBefore.running_state);
    });

    it('4.5 prevents client-side payload tampering during confirm endpoint execution', async () => {
      // Stage damage of 5 to hero
      const staged = await executeTool(
        'apply_combat_damage',
        { encounterId, targets: [{ combatantId: heroId, amount: 5, actionType: 'damage' }] },
        { campaignId }
      );

      // Malicious client tries to inject lethal damage or mutate execution payload
      const tamperedRes = await request(app)
        .post('/api/assistant/confirm')
        .send({
          proposalId: staged.proposal.proposalId,
          action: 'approve',
          targets: [{ combatantId: heroId, amount: 9999, projectedHp: 0 }],
          executionPayload: { targets: [{ combatantId: heroId, projectedHp: 0 }] },
        });

      expect(tamperedRes.status).toBe(200);

      // Verify that server executed ONLY the server-staged payload (5 damage: 10 temp absorbed -> 5 temp, 45 HP)
      const hero = db.prepare('SELECT currentHp, tempHp FROM encounter_units WHERE instanceId = ?').get(heroId);
      expect(hero.currentHp).toBe(45);
      expect(hero.tempHp).toBe(5);
    });

    it('4.6 observes multiple sequential proposals for the same combatant', async () => {
      // Stage first proposal: 10 damage to monster (30 -> 20)
      const prop1 = await executeTool(
        'apply_combat_damage',
        { encounterId, targets: [{ combatantId: monsterId, amount: 10, actionType: 'damage' }] },
        { campaignId }
      );

      // Approve first proposal
      await request(app).post('/api/assistant/confirm').send({ proposalId: prop1.proposal.proposalId, action: 'approve' });
      let monster = db.prepare('SELECT currentHp FROM encounter_units WHERE instanceId = ?').get(monsterId);
      expect(monster.currentHp).toBe(20);

      // Stage second proposal: 10 damage to monster based on updated state (20 -> 10)
      const prop2 = await executeTool(
        'apply_combat_damage',
        { encounterId, targets: [{ combatantId: monsterId, amount: 10, actionType: 'damage' }] },
        { campaignId }
      );
      expect(prop2.proposal.payload.targets[0].currentHp).toBe(20);
      expect(prop2.proposal.payload.targets[0].projectedHp).toBe(10);

      // Approve second proposal
      await request(app).post('/api/assistant/confirm').send({ proposalId: prop2.proposal.proposalId, action: 'approve' });
      monster = db.prepare('SELECT currentHp FROM encounter_units WHERE instanceId = ?').get(monsterId);
      expect(monster.currentHp).toBe(10);
    });

    it('4.7 safely handles non-string damageType in projectHpApplication without unhandled TypeError', () => {
      const target = { instanceId: heroId, currentHp: 45, maxHp: 50, tempHp: 5 };
      const resNum = projectHpApplication(target, 'damage', 10, 42);
      expect(resNum.projectedHp).toBe(40);
      expect(resNum.projectedTempHp).toBe(0);

      const resBool = projectHpApplication(target, 'damage', 10, true);
      expect(resBool.projectedHp).toBe(40);

      const resNull = projectHpApplication(target, 'damage', 10, null);
      expect(resNull.projectedHp).toBe(40);
    });

    it('4.8 rejects object-format destination coordinates with negative or non-finite values in move_combatant', async () => {
      await expect(
        executeTool(
          'move_combatant',
          { encounterId, combatantId: heroId, destination: { x: -5, y: -10 } },
          { campaignId }
        )
      ).rejects.toThrow(/Invalid destination coordinates/);

      await expect(
        executeTool(
          'move_combatant',
          { encounterId, combatantId: heroId, destination: { x: Infinity, y: 5 } },
          { campaignId }
        )
      ).rejects.toThrow(/Invalid destination coordinates/);
    });

    it('4.9 guards columnIndexToLabel against Infinity, -Infinity, and NaN without infinite loops', () => {
      expect(columnIndexToLabel(Infinity)).toBe('');
      expect(columnIndexToLabel(-Infinity)).toBe('');
      expect(columnIndexToLabel(NaN)).toBe('');
    });
  });
});
