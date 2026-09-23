import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { app } from '../index.js';
import { db } from '../db.js';
import hitlManager, { clearProposals } from './hitlManager.js';
import {
  executeTool,
  registerBuiltInWriteTools,
  clearWriteTools,
  isWriteTool,
  parseScenarioCombatants,
  allocateTokenCoordinates,
  formatPhaseLabel,
  labelToCoordinate,
} from './toolController.js';

describe('R4: configure_encounter_combatants Tool Backend & Scenario Parsing Integration', () => {
  const campaignId = 'test-config-camp';
  const encounterId = 'test-config-enc';
  const existingPlayerId = 'test-existing-player';

  const gridConfig = {
    columns: 33,
    rows: 21,
    cellPitch: 74,
    regions: [
      {
        id: 'P1',
        name: 'South Shore',
        cells: ['1,2', '1,3', '2,2', '2,3'], // around B3 (1,2)
      },
      {
        id: 'P2',
        name: 'North Woods',
        cells: ['7,0', '7,1', '8,0', '8,1'], // around H1 (7,0)
      },
    ],
  };

  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();

    // Clean test records
    db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);

    // Setup test campaign
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
      campaignId,
      'Combatant Config Test Campaign',
      'Milestone 4 scenario parsing and combatant configuration'
    );

    const initialRunningState = JSON.stringify({
      isCombatStarted: false,
      round: 1,
      turnIndex: 0,
      activePhases: [1],
      combatants: [
        {
          instanceId: existingPlayerId,
          name: 'Valeros',
          currentHp: 25,
          maxHp: 25,
          tempHp: 0,
          initiative: 15,
          isPlayer: true,
          position: { x: 0, y: 0 }, // A1
          phase: 1,
        },
      ],
      combatLog: [],
    });

    db.prepare(
      'INSERT INTO encounters (id, campaign_id, name, running_state, dm_map_url, grid_config) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      encounterId,
      campaignId,
      'Palma Flora Shoreline Ambush',
      initialRunningState,
      '/maps/5.1-palma-flora.png',
      JSON.stringify(gridConfig)
    );

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, position_x, position_y, phase, faction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      existingPlayerId,
      encounterId,
      campaignId,
      'Valeros',
      25,
      25,
      2,
      15,
      1,
      0,
      0,
      1,
      'ally'
    );
  });

  describe('1. Scenario Text Analysis & Parser', () => {
    it('parses @Monster tag syntax correctly with coordinates, region, and phase', () => {
      const scenarioText =
        'An ambush begins: @Monster[goblin]{Goblin} appears at South Shore (B3) as the initial wave.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toHaveLength(1);
      const c = combatants[0];
      expect(c.name).toBe('Goblin');
      expect(c.monsterType).toBe('Goblin');
      expect(c.phase).toBe(1);
      expect(c.faction).toBe('enemy');
      expect(c.coordinates.label).toBe('B3');
      expect(c.coordinates.x).toBe(1);
      expect(c.coordinates.y).toBe(2);
      expect(c.coordinates.regionName).toBe('South Shore');
      expect(c.hp).toBeGreaterThan(0);
    });

    it('parses multi-wave narrative with natural counts, coordinates, regions, and phases', () => {
      const scenarioText =
        '3 Goblins appear at South Shore (B3) as the initial wave. 2 Bugbears arrive at Round 3 from North Woods (H1) as reinforcements.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toHaveLength(5);

      // Phase 1 wave: 3 Goblins
      const goblins = combatants.filter((c) => c.phase === 1);
      expect(goblins).toHaveLength(3);
      expect(goblins[0].name).toBe('Goblin 1');
      expect(goblins[0].coordinates.label).toBe('B3');
      expect(goblins[0].coordinates.regionName).toBe('South Shore');

      // Check conflict resolution: Goblins 2 and 3 should have distinct coordinates
      const goblinCoords = goblins.map((g) => `${g.coordinates.x},${g.coordinates.y}`);
      const uniqueGoblinCoords = new Set(goblinCoords);
      expect(uniqueGoblinCoords.size).toBe(3);

      // Phase 2 wave: 2 Bugbears
      const bugbears = combatants.filter((c) => c.phase === 2);
      expect(bugbears).toHaveLength(2);
      expect(bugbears[0].name).toBe('Bugbear 1');
      expect(bugbears[0].coordinates.label).toBe('H1');
      expect(bugbears[0].coordinates.regionName).toBe('North Woods');

      const bugbearCoords = bugbears.map((b) => `${b.coordinates.x},${b.coordinates.y}`);
      const uniqueBugbearCoords = new Set(bugbearCoords);
      expect(uniqueBugbearCoords.size).toBe(2);
    });

    it('handles missing monster stat block with default placeholder values without crashing', () => {
      const scenarioText = '1 ShadowBeast arrives at B3 as the initial wave';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toHaveLength(1);
      expect(combatants[0].name).toBe('ShadowBeast');
      expect(combatants[0].hp).toBe(10);
      expect(combatants[0].dexMod).toBe(0);
      expect(combatants[0].phase).toBe(1);
    });

    it('does not throw and does not match on monster names containing regex metacharacters (e.g. "Deep Gnome (Svirfneblin)")', () => {
      const scenarioText = '1 Deep Gnome (Svirfneblin) ambushes the party at B3.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      // Unescaped parentheses in a monster name would previously turn into a
      // regex capture group, so the name would never match its own literal
      // text (and an unbalanced name elsewhere in the manual could throw).
      expect(() => parseScenarioCombatants(scenarioText, encounter)).not.toThrow();
      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toHaveLength(1);
      expect(combatants[0].monsterType).toBe('Deep Gnome (Svirfneblin)');
    });

    it('matches a monster name ending in a non-word character (e.g. a closing paren) even via the primary natural-language matcher (N-3)', () => {
      // Escaping the regex metacharacters is not enough on its own: a plain
      // `\b` immediately after a name ending in ")" requires the very next
      // character to be a word character, which ordinary prose never
      // provides, so the name could never match through the main
      // natural-language regex loop. A capitalized count word ("Two") at
      // the start of the sentence also bypasses the generic capitalized-word
      // fallback (that fallback's count-word alternation is case-sensitive),
      // so this exact phrasing exercises the primary matcher specifically.
      const scenarioText = 'Two Deep Gnome (Svirfneblin) wait at B2.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toHaveLength(2);
      expect(combatants[0].monsterType).toBe('Deep Gnome (Svirfneblin)');
      expect(combatants[1].monsterType).toBe('Deep Gnome (Svirfneblin)');
    });

    it('does not treat "Finally"/"really"/"usually"/"rally" as declaring an ally faction', () => {
      const scenarioText = 'Finally, 2 Goblins really rally at B3 for the ambush.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants.length).toBeGreaterThan(0);
      for (const c of combatants) {
        expect(c.faction).toBe('enemy');
      }
    });

    it('still recognizes a real "ally" declaration as a whole word', () => {
      const scenarioText = '1 Goblin ally joins the party at B3.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toHaveLength(1);
      expect(combatants[0].faction).toBe('ally');
    });

    it('returns empty array when scenario text contains no combatants', () => {
      const scenarioText = 'The seaside winds blow gently against the palm trees.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toEqual([]);
    });

    it('resolves regions/bounds from the caller-supplied calibrated gridData (map_grids.json) instead of encounter.grid_config (N-2)', () => {
      // "Northern Bridge" only exists in the real map_grids.json entry for
      // this map, not in the encounter's (stale/synthetic) grid_config
      // column, and the clause gives no explicit coordinate, so this can
      // only resolve correctly if parseScenarioCombatants actually uses the
      // gridData argument.
      const realGridData = JSON.parse(fs.readFileSync(path.join('public', 'data', 'map_grids.json'), 'utf-8'))['/maps/5.1-palma-flora.png'];
      const scenarioText = 'Six goblins hold the Northern Bridge.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter, undefined, new Set(), realGridData);
      expect(combatants).toHaveLength(6);
      for (const c of combatants) {
        expect(c.coordinates.regionName).toBe('Northern Bridge');
        expect(c.coordinates.placementInferred).toBeUndefined();
        // Region cells are columns 17-18, rows 0-1: nowhere near the (0,0)
        // default that a failed region lookup would fall back to.
        expect(c.coordinates.x).toBeGreaterThanOrEqual(16);
        expect(c.coordinates.y).toBeLessThanOrEqual(2);
      }
    });

    it('flags a clause with no detectable location as an inferred (not specified) placement (N-4)', () => {
      const scenarioText = 'Two kobolds skulk nearby, waiting to strike.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toHaveLength(2);
      for (const c of combatants) {
        expect(c.coordinates.placementInferred).toBe(true);
      }
    });

    it('does not flag placementInferred when a real location was found in the text', () => {
      const scenarioText = '1 Goblin appears at B3.';
      const encounter = { id: encounterId, grid_config: JSON.stringify(gridConfig) };

      const combatants = parseScenarioCombatants(scenarioText, encounter);
      expect(combatants).toHaveLength(1);
      expect(combatants[0].coordinates.placementInferred).toBeUndefined();
    });
  });

  describe('2. Token Placement & Congestion Conflict Resolution', () => {
    it('resolves placement conflicts by searching outward for adjacent free cells', () => {
      const occupied = new Set(['1,2', '1,3']); // B3 and B4 occupied
      const requested = { x: 1, y: 2 }; // B3

      const allocated = allocateTokenCoordinates(requested, occupied, gridConfig);
      expect(allocated).toBeDefined();
      expect(`${allocated.x},${allocated.y}`).not.toBe('1,2');
      expect(`${allocated.x},${allocated.y}`).not.toBe('1,3');
      expect(occupied.has(`${allocated.x},${allocated.y}`)).toBe(true);
    });

    it('formats phase labels clearly for screen readers', () => {
      expect(formatPhaseLabel(1)).toBe('Phase 1: Initial Wave');
      expect(formatPhaseLabel(2)).toBe('Phase 2: Reinforcements');
      expect(formatPhaseLabel(3)).toBe('Phase 3: Reinforcements');
    });
  });

  describe('3. configure_encounter_combatants Write Tool Protocol & Proposal Staging', () => {
    it('verifies configure_encounter_combatants is registered as an authoritative write tool', () => {
      expect(isWriteTool('configure_encounter_combatants')).toBe(true);
    });

    it('stages proposal with scenarioText, leaving database completely unmutated in Phase 1', async () => {
      const scenarioText =
        '3 Goblins appear at South Shore (B3) as the initial wave. 2 Bugbears arrive at Round 3 from North Woods (H1) as reinforcements.';

      const result = await executeTool(
        'configure_encounter_combatants',
        { scenarioText, encounterId },
        { campaignId, encounterId }
      );

      expect(result.status).toBe('proposal_staged');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.proposal).toBeDefined();

      const proposal = result.proposal;
      expect(proposal.toolName).toBe('configure_encounter_combatants');
      expect(proposal.payloadType).toBe('combatant_config');

      const payload = proposal.payload;
      expect(payload.encounterId).toBe(encounterId);
      expect(payload.encounterName).toBe('Palma Flora Shoreline Ambush');
      expect(payload.combatants).toHaveLength(5);

      // Verify zero DB changes during staging
      const count = db
        .prepare('SELECT COUNT(*) as count FROM encounter_units WHERE encounter_id = ?')
        .get(encounterId);
      expect(count.count).toBe(1); // only existing Valeros unit
    });

    it('stages proposal with explicit structured combatants array', async () => {
      const structuredCombatants = [
        {
          name: 'Goblin Skirmisher',
          monsterId: 'goblin',
          coordinates: 'B3',
          phase: 1,
          faction: 'enemy',
        },
        {
          name: 'Hobgoblin Captain',
          coordinates: 'H1',
          phase: 2,
          faction: 'enemy',
        },
      ];

      const result = await executeTool(
        'configure_encounter_combatants',
        { combatants: structuredCombatants, encounterId },
        { campaignId, encounterId }
      );

      expect(result.status).toBe('proposal_staged');
      const payload = result.proposal.payload;
      expect(payload.combatants).toHaveLength(2);
      expect(payload.combatants[0].name).toBe('Goblin Skirmisher');
      expect(payload.combatants[0].coordinates.label).toBe('B3');
      expect(payload.combatants[1].name).toBe('Hobgoblin Captain');
      expect(payload.combatants[1].coordinates.label).toBe('H1');
      expect(payload.combatants[1].phase).toBe(2);
    });

    it('rejects invalid arguments: empty roster or invalid phase', async () => {
      await expect(
        executeTool(
          'configure_encounter_combatants',
          { scenarioText: 'The quiet sea breeze rustles the leaves.', encounterId },
          { campaignId, encounterId }
        )
      ).rejects.toThrow(/No combatants could be identified/);

      await expect(
        executeTool(
          'configure_encounter_combatants',
          {
            combatants: [{ name: 'Test Goblin', coordinates: 'B3', phase: 0 }],
            encounterId,
          },
          { campaignId, encounterId }
        )
      ).rejects.toThrow(/Invalid phase/);
    });
  });

  describe('4. Proposal Confirmation & Execution (Approve & Deny)', () => {
    it('executes mutation on approval: inserts units into SQLite and updates running_state', async () => {
      const scenarioText =
        '3 Goblins appear at South Shore (B3) as the initial wave. 2 Bugbears arrive at Round 3 from North Woods (H1) as reinforcements.';

      // 1. Stage proposal
      const staged = await executeTool(
        'configure_encounter_combatants',
        { scenarioText, encounterId },
        { campaignId, encounterId }
      );
      const proposalId = staged.proposal.proposalId;

      // 2. Approve proposal via API endpoint
      const response = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId, action: 'approve' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('approved');
      expect(response.body.executionSummary).toContain('Configure 5 combatant(s)');

      // 3. Verify SQLite encounter_units table has the 5 new units + 1 existing player = 6 units
      const totalUnits = db
        .prepare('SELECT COUNT(*) as count FROM encounter_units WHERE encounter_id = ?')
        .get(encounterId);
      expect(totalUnits.count).toBe(6);

      const dbGoblins = db
        .prepare('SELECT * FROM encounter_units WHERE encounter_id = ? AND phase = 1 AND isPlayer = 0')
        .all(encounterId);
      expect(dbGoblins).toHaveLength(3);
      expect(dbGoblins[0].name).toContain('Goblin');
      expect(dbGoblins[0].position_x).toBeDefined();
      expect(dbGoblins[0].position_y).toBeDefined();

      const dbBugbears = db
        .prepare('SELECT * FROM encounter_units WHERE encounter_id = ? AND phase = 2')
        .all(encounterId);
      expect(dbBugbears).toHaveLength(2);
      expect(dbBugbears[0].name).toContain('Bugbear');

      // 4. Verify encounters.running_state JSON was updated
      const encRow = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
      const parsedState = JSON.parse(encRow.running_state);
      expect(parsedState.combatants.length).toBe(6);
      expect(parsedState.combatLog).toBeDefined();
      expect(parsedState.combatLog.length).toBeGreaterThan(0);
      expect(parsedState.combatLog[0].type).toBe('combatants_configured');
    });

    it('cancels mutation cleanly on denial: leaves database and running state completely unchanged', async () => {
      const scenarioText = '2 Bugbears arrive at Round 3 from North Woods (H1) as reinforcements.';

      // 1. Stage proposal
      const staged = await executeTool(
        'configure_encounter_combatants',
        { scenarioText, encounterId },
        { campaignId, encounterId }
      );
      const proposalId = staged.proposal.proposalId;

      // 2. Deny proposal via API endpoint
      const response = await request(app)
        .post('/api/assistant/confirm')
        .send({ proposalId, action: 'deny' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('denied');
      expect(response.body.cancelled).toBe(true);

      // 3. Verify encounter_units still has only the 1 initial player
      const count = db
        .prepare('SELECT COUNT(*) as count FROM encounter_units WHERE encounter_id = ?')
        .get(encounterId);
      expect(count.count).toBe(1);

      // 4. Verify running_state has only the 1 initial player
      const encRow = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
      const parsedState = JSON.parse(encRow.running_state);
      expect(parsedState.combatants.length).toBe(1);
      expect(parsedState.combatants[0].name).toBe('Valeros');
    });
  });
});
