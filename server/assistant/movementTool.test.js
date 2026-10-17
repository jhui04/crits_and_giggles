import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { db } from '../db.js';
import hitlManager, { clearProposals } from './hitlManager.js';
import {
  executeTool,
  registerBuiltInWriteTools,
  clearWriteTools,
  isWriteTool,
  labelToCoordinate,
  columnLabelToIndex,
  resolveRegionName,
  calculateAdjacencies,
} from './toolController.js';

describe('R2: move_combatant Tool Backend & State Integration', () => {
  const campaignId = 'test-move-camp';
  const encounterId = 'test-move-enc';
  const playerUnitId = 'test-move-grog';
  const monsterUnitId = 'test-move-sahuagin';

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
      'Movement Test Campaign',
      'Tactical movement testing'
    );

    // Grid config with Palma Flora like semantic regions
    const gridConfig = JSON.stringify({
      columns: 33,
      rows: 21,
      cellPitch: 74,
      regions: [
        {
          id: 'P5',
          name: 'Northern Bridge',
          cells: ['17,0', '17,1', '17,2'],
        },
        {
          id: 'P1',
          name: 'South Shore',
          cells: ['12,8', '13,8', '12,9', '13,9'],
        },
      ],
    });

    const runningState = JSON.stringify({
      isCombatStarted: true,
      round: 1,
      combatants: [
        {
          instanceId: playerUnitId,
          name: 'Grog Strongjaw',
          currentHp: 45,
          maxHp: 45,
          initiative: 12,
          isPlayer: true,
          position: { x: 12, y: 8 },
        },
        {
          instanceId: monsterUnitId,
          name: 'Sahuagin Raider',
          currentHp: 22,
          maxHp: 22,
          initiative: 14,
          isPlayer: false,
          position: { x: 13, y: 8 }, // adjacent to (12,8) at 5 ft
        },
      ],
    });

    db.prepare(
      'INSERT INTO encounters (id, campaign_id, name, running_state, dm_map_url, grid_config) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(encounterId, campaignId, 'Wavecrest Beach Battle', runningState, '/maps/test-movement-map.png', gridConfig);

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(playerUnitId, encounterId, campaignId, 'Grog Strongjaw', 45, 45, 2, 12, 1, 12, 8);

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(monsterUnitId, encounterId, campaignId, 'Sahuagin Raider', 22, 22, 1, 14, 0, 13, 8);
  });

  it('verifies tool is registered as an authoritative write tool', () => {
    expect(isWriteTool('move_combatant')).toBe(true);
  });

  it('calculateAdjacencies excludes only the mover itself by instanceId, not every combatant sharing its name (N-6)', () => {
    const movingUnit = { instanceId: 'goblin-1', name: 'Goblin', isPlayer: false, faction: 'enemy' };
    const combatants = [
      movingUnit,
      { instanceId: 'goblin-2', name: 'Goblin', isPlayer: false, faction: 'enemy', position: { x: 0, y: 1 } },
      { instanceId: 'grog', name: 'Grog Strongjaw', isPlayer: true, faction: 'ally', position: { x: 1, y: 0 } },
    ];

    // Moving "goblin-1" to (0,0): the other same-named "Goblin" (goblin-2)
    // is adjacent and must still show up as an enemy-side ally, not be
    // hidden just because it shares a name with the mover.
    const adjacencies = calculateAdjacencies({ x: 0, y: 0 }, movingUnit, combatants);
    expect(adjacencies.allies).toContain('Goblin');
    expect(adjacencies.enemies).toContain('Grog Strongjaw');
  });

  it('calculateAdjacencies classifies an allied NPC (isPlayer: false, faction: "ally") correctly from every perspective', () => {
    const goblinMover = { instanceId: 'goblin-1', name: 'Goblin', isPlayer: false, faction: 'enemy' };
    const allyNpc = { instanceId: 'npc-1', name: 'Friendly Scout', isPlayer: false, faction: 'ally', position: { x: 1, y: 0 } };
    const grogMover = { instanceId: 'grog', name: 'Grog Strongjaw', isPlayer: true, faction: 'ally' };

    // An enemy mover (goblin) adjacent to an allied NPC must see the NPC
    // as an enemy, not an ally, even though the NPC's isPlayer is false.
    const fromEnemy = calculateAdjacencies({ x: 0, y: 0 }, goblinMover, [goblinMover, allyNpc]);
    expect(fromEnemy.enemies).toContain('Friendly Scout');
    expect(fromEnemy.allies).not.toContain('Friendly Scout');

    // The allied NPC moving (isMoverEnemy must also exclude 'ally' faction)
    // adjacent to a goblin must see the goblin as an enemy.
    const npcMover = { ...allyNpc, instanceId: 'npc-1', position: undefined };
    const goblinAdjacent = { instanceId: 'goblin-2', name: 'Goblin', isPlayer: false, faction: 'enemy', position: { x: 1, y: 0 } };
    const fromNpc = calculateAdjacencies({ x: 0, y: 0 }, npcMover, [npcMover, goblinAdjacent]);
    expect(fromNpc.enemies).toContain('Goblin');
    expect(fromNpc.allies).not.toContain('Goblin');

    // A player mover adjacent to the allied NPC must see the NPC as an ally.
    const allyNpcAdjacent = { ...allyNpc, position: { x: 1, y: 0 } };
    const fromPlayer = calculateAdjacencies({ x: 0, y: 0 }, grogMover, [grogMover, allyNpcAdjacent]);
    expect(fromPlayer.allies).toContain('Friendly Scout');
    expect(fromPlayer.enemies).not.toContain('Friendly Scout');
  });

  it('stages confirmation proposal with rich origin/dest coordinates, regions, and adjacencies', async () => {
    const result = await executeTool(
      'move_combatant',
      {
        combatantName: 'Grog Strongjaw',
        destination: 'R1', // (17, 0) in Northern Bridge region
        encounterId,
      },
      { campaignId, encounterId }
    );

    expect(result.status).toBe('proposal_staged');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.proposal).toBeDefined();

    const proposal = result.proposal;
    expect(proposal.toolName).toBe('move_combatant');
    expect(proposal.payloadType).toBe('movement');

    const payload = proposal.payload;
    expect(payload.combatantName).toBe('Grog Strongjaw');
    expect(payload.combatantId).toBe(playerUnitId);

    // Origin: (12, 8) -> "M9", region "South Shore"
    expect(payload.origin.x).toBe(12);
    expect(payload.origin.y).toBe(8);
    expect(payload.origin.label).toBe('M9');
    expect(payload.origin.regionName).toBe('South Shore');

    // Destination: (17, 0) -> "R1", region "Northern Bridge"
    expect(payload.destination.x).toBe(17);
    expect(payload.destination.y).toBe(0);
    expect(payload.destination.label).toBe('R1');
    expect(payload.destination.regionName).toBe('Northern Bridge');

    // Origin adjacencies: Sahuagin Raider is at (13, 8), which is 5 ft away from (12, 8)
    expect(payload.originAdjacencies.enemies).toContain('Sahuagin Raider');
    expect(payload.originAdjacencies.allies).toHaveLength(0);

    // Destination adjacencies: at (17, 0), nobody is nearby
    expect(payload.destinationAdjacencies.enemies).toHaveLength(0);
    expect(payload.destinationAdjacencies.allies).toHaveLength(0);

    // Verify DB was NOT modified during Phase 1 staging
    const unitAfterStaging = db
      .prepare('SELECT position_x, position_y FROM encounter_units WHERE instanceId = ?')
      .get(playerUnitId);
    expect(unitAfterStaging.position_x).toBe(12);
    expect(unitAfterStaging.position_y).toBe(8);
  });

  it('executes mutation on approval: updates encounter_units and encounters.running_state', async () => {
    // 1. Stage proposal
    const staged = await executeTool(
      'move_combatant',
      {
        combatantId: playerUnitId,
        destination: 'R1', // { x: 17, y: 0 }
        encounterId,
      },
      { campaignId, encounterId }
    );

    const proposalId = staged.proposal.proposalId;

    // 2. Approve proposal via API
    const response = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'approve' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe('approved');
    expect(response.body.executionSummary).toContain('Moved Grog Strongjaw to R1');

    // 3. Verify SQLite encounter_units table was mutated
    const updatedUnit = db
      .prepare('SELECT position_x, position_y FROM encounter_units WHERE instanceId = ?')
      .get(playerUnitId);
    expect(updatedUnit.position_x).toBe(17);
    expect(updatedUnit.position_y).toBe(0);

    // 4. Verify encounters.running_state JSON was mutated
    const updatedEncounter = db
      .prepare('SELECT running_state FROM encounters WHERE id = ?')
      .get(encounterId);
    const parsedState = JSON.parse(updatedEncounter.running_state);
    const movedCombatant = parsedState.combatants.find((c) => c.instanceId === playerUnitId);
    expect(movedCombatant.position).toEqual({ x: 17, y: 0 });
  });

  it('cancels mutation cleanly on denial: leaves encounter_units and running_state completely unchanged', async () => {
    // 1. Stage proposal
    const staged = await executeTool(
      'move_combatant',
      {
        combatantId: playerUnitId,
        destination: 'R1',
        encounterId,
      },
      { campaignId, encounterId }
    );

    const proposalId = staged.proposal.proposalId;

    // 2. Deny proposal via API
    const response = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'deny' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('denied');
    expect(response.body.cancelled).toBe(true);

    // 3. Verify SQLite encounter_units is untouched
    const unitAfterDeny = db
      .prepare('SELECT position_x, position_y FROM encounter_units WHERE instanceId = ?')
      .get(playerUnitId);
    expect(unitAfterDeny.position_x).toBe(12);
    expect(unitAfterDeny.position_y).toBe(8);

    // 4. Verify running_state JSON is untouched
    const encAfterDeny = db
      .prepare('SELECT running_state FROM encounters WHERE id = ?')
      .get(encounterId);
    const parsedState = JSON.parse(encAfterDeny.running_state);
    const combatant = parsedState.combatants.find((c) => c.instanceId === playerUnitId);
    expect(combatant.position).toEqual({ x: 12, y: 8 });
  });
});
