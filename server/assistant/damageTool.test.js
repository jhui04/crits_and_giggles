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
} from './toolController.js';
import { projectHpApplication } from './combatHpUtils.js';

describe('R3: apply_combat_damage Tool Backend & State Integration', () => {
  const campaignId = 'test-damage-camp';
  const encounterId = 'test-damage-enc';
  const grogId = 'test-dmg-grog';
  const goblinId = 'test-dmg-goblin';
  const tieflingId = 'test-dmg-tiefling';

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
      'Damage Test Campaign',
      'Combat damage application testing'
    );

    const runningState = JSON.stringify({
      isCombatStarted: true,
      round: 1,
      combatants: [
        {
          instanceId: grogId,
          name: 'Grog Strongjaw',
          currentHp: 40,
          maxHp: 50,
          tempHp: 10,
          initiative: 12,
          isPlayer: true,
        },
        {
          instanceId: goblinId,
          name: 'Goblin Scout',
          currentHp: 7,
          maxHp: 7,
          tempHp: 0,
          initiative: 14,
          isPlayer: false,
        },
        {
          instanceId: tieflingId,
          name: 'Tiefling Mercenary',
          currentHp: 25,
          maxHp: 30,
          tempHp: 5,
          initiative: 10,
          isPlayer: false,
          fullData: {
            resistances: ['fire'],
            immunities: { damage: ['poison'] },
          },
        },
      ],
      combatLog: [],
    });

    db.prepare(
      'INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)'
    ).run(encounterId, campaignId, 'Cavern Skirmish', runningState);

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, tempHp, dexMod, initiative, isPlayer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(grogId, encounterId, campaignId, 'Grog Strongjaw', 50, 40, 10, 2, 12, 1);

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, tempHp, dexMod, initiative, isPlayer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(goblinId, encounterId, campaignId, 'Goblin Scout', 7, 7, 0, 1, 14, 0);

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, tempHp, dexMod, initiative, isPlayer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(tieflingId, encounterId, campaignId, 'Tiefling Mercenary', 30, 25, 5, 2, 10, 0);
  });

  it('verifies apply_combat_damage is registered as an authoritative write tool', () => {
    expect(isWriteTool('apply_combat_damage')).toBe(true);
  });

  it('stages confirmation proposal with accurate HP projection (temp HP absorption and zero clamp)', async () => {
    const result = await executeTool(
      'apply_combat_damage',
      {
        targets: [
          {
            combatantName: 'Grog Strongjaw',
            amount: 15,
            actionType: 'damage',
          },
          {
            combatantName: 'Goblin Scout',
            amount: 20,
            actionType: 'damage',
          },
        ],
        encounterId,
      },
      { campaignId, encounterId }
    );

    expect(result.status).toBe('proposal_staged');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.proposal).toBeDefined();

    const proposal = result.proposal;
    expect(proposal.toolName).toBe('apply_combat_damage');
    expect(proposal.payloadType).toBe('damage');

    const payload = proposal.payload;
    expect(payload.targets).toHaveLength(2);

    // Grog: 40 HP, 10 temp HP. 15 damage -> 0 temp HP, 35 HP
    const grogTarget = payload.targets.find((t) => t.combatantId === grogId);
    expect(grogTarget).toBeDefined();
    expect(grogTarget.currentHp).toBe(40);
    expect(grogTarget.currentTempHp).toBe(10);
    expect(grogTarget.projectedTempHp).toBe(0);
    expect(grogTarget.projectedHp).toBe(35);

    // Goblin: 7 HP, 0 temp HP. 20 damage -> 0 HP (clamped at 0)
    const goblinTarget = payload.targets.find((t) => t.combatantId === goblinId);
    expect(goblinTarget).toBeDefined();
    expect(goblinTarget.currentHp).toBe(7);
    expect(goblinTarget.projectedHp).toBe(0);
  });

  it('handles damage resistances and immunities correctly during proposal staging', async () => {
    const result = await executeTool(
      'apply_combat_damage',
      {
        targets: [
          {
            combatantName: 'Tiefling Mercenary',
            amount: 12,
            actionType: 'damage',
            damageType: 'fire', // resistant: half damage = 6; 5 absorbed by temp, 1 from HP
          },
        ],
        encounterId,
      },
      { campaignId, encounterId }
    );

    const payload = result.proposal.payload;
    const tiefling = payload.targets[0];
    expect(tiefling.currentHp).toBe(25);
    expect(tiefling.currentTempHp).toBe(5);
    expect(tiefling.projectedTempHp).toBe(0);
    expect(tiefling.projectedHp).toBe(24);
    expect(tiefling.effectiveChange).toContain('(resisted)');
  });

  it('stages healing proposal correctly clamping to maxHp and leaving temp HP untouched', async () => {
    const result = await executeTool(
      'apply_combat_damage',
      {
        targets: [
          {
            combatantName: 'Grog Strongjaw',
            amount: 25,
            actionType: 'healing',
          },
        ],
        encounterId,
      },
      { campaignId, encounterId }
    );

    const payload = result.proposal.payload;
    const grog = payload.targets[0];
    // Grog current HP: 40, maxHp: 50. Healing 25 restores to 50 (maxHp)
    expect(grog.currentHp).toBe(40);
    expect(grog.maxHp).toBe(50);
    expect(grog.projectedHp).toBe(50);
    expect(grog.projectedTempHp).toBe(10); // temp HP remains 10
  });

  it('stages temp_hp proposal adhering to non-stacking rule (takes Math.max)', async () => {
    const result = await executeTool(
      'apply_combat_damage',
      {
        targets: [
          {
            combatantName: 'Grog Strongjaw',
            amount: 8, // lower than existing 10
            actionType: 'temp_hp',
          },
          {
            combatantName: 'Goblin Scout',
            amount: 5, // higher than existing 0
            actionType: 'temp_hp',
          },
        ],
        encounterId,
      },
      { campaignId, encounterId }
    );

    const payload = result.proposal.payload;
    const grog = payload.targets[0];
    expect(grog.currentTempHp).toBe(10);
    expect(grog.projectedTempHp).toBe(10); // retains 10

    const goblin = payload.targets[1];
    expect(goblin.currentTempHp).toBe(0);
    expect(goblin.projectedTempHp).toBe(5); // updated to 5
  });

  it('executes mutation on approval: updates encounter_units and encounters.running_state', async () => {
    const result = await executeTool(
      'apply_combat_damage',
      {
        targets: [
          {
            combatantName: 'Grog Strongjaw',
            amount: 15,
            actionType: 'damage',
          },
        ],
        encounterId,
      },
      { campaignId, encounterId }
    );

    const proposalId = result.proposal.proposalId;

    // 1. Resolve proposal via POST /api/assistant/confirm with 'approve'
    const confirmRes = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'approve' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);
    expect(confirmRes.body.status).toBe('approved');

    // 2. Verify SQLite encounter_units table was mutated
    const updatedGrogUnit = db
      .prepare('SELECT currentHp, tempHp FROM encounter_units WHERE instanceId = ?')
      .get(grogId);

    expect(updatedGrogUnit.currentHp).toBe(35);
    expect(updatedGrogUnit.tempHp).toBe(0);

    // 3. Verify encounters.running_state was updated and event logged in combatLog
    const updatedEnc = db
      .prepare('SELECT running_state FROM encounters WHERE id = ?')
      .get(encounterId);

    const rs = JSON.parse(updatedEnc.running_state);
    const grogCombatant = rs.combatants.find((c) => c.instanceId === grogId);
    expect(grogCombatant.currentHp).toBe(35);
    expect(grogCombatant.tempHp).toBe(0);

    expect(rs.combatLog).toBeDefined();
    expect(rs.combatLog.length).toBeGreaterThan(0);
    const lastLog = rs.combatLog[rs.combatLog.length - 1];
    expect(lastLog.type).toBe('combat_damage');
    expect(lastLog.targets[0].combatantId).toBe(grogId);
  });

  it('rejects approval as stale when HP changed between staging and approval, instead of silently re-projecting onto the new value', async () => {
    // Stage a proposal while Grog is at 40 HP / 10 temp HP.
    const result = await executeTool(
      'apply_combat_damage',
      {
        targets: [{ combatantName: 'Grog Strongjaw', amount: 15, actionType: 'damage' }],
        encounterId,
      },
      { campaignId, encounterId }
    );
    const proposalId = result.proposal.proposalId;
    // The staged description reflects the HP snapshot at staging time.
    expect(result.proposal.description).toMatch(/HP: 40 \(\+10 temp\) -> 35/);

    // Simulate a change that happens between staging and approval (e.g.
    // another approved proposal, or a manual edit): Grog is now at 20 HP
    // with no temp HP left, not the 40/10 the proposal was staged against.
    db.prepare('UPDATE encounter_units SET currentHp = ?, tempHp = ? WHERE instanceId = ?').run(20, 0, grogId);
    const enc = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(enc.running_state);
    const grog = rs.combatants.find((c) => c.instanceId === grogId);
    grog.currentHp = 20;
    grog.tempHp = 0;
    db.prepare('UPDATE encounters SET running_state = ? WHERE id = ?').run(JSON.stringify(rs), encounterId);

    const confirmRes = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'approve' });

    // The encounter's state hash no longer matches what was captured at
    // staging time, so the approval is rejected outright rather than
    // silently re-projecting the damage onto Grog's new HP.
    expect(confirmRes.status).toBe(409);
    expect(confirmRes.body.status).toBe('stale');

    // Grog's HP is exactly what the out-of-band edit set it to — untouched
    // by this proposal.
    const updatedGrogUnit = db
      .prepare('SELECT currentHp FROM encounter_units WHERE instanceId = ?')
      .get(grogId);
    expect(updatedGrogUnit.currentHp).toBe(20);

    // No combat log entry was written for this rejected approval.
    const finalEnc = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const finalRs = JSON.parse(finalEnc.running_state);
    expect(finalRs.combatLog.some((l) => l.type === 'combat_damage')).toBe(false);
  });

  it('rejects approval as stale when a target is removed from the encounter between staging and approval, rather than silently skipping it', async () => {
    const result = await executeTool(
      'apply_combat_damage',
      {
        targets: [
          { combatantName: 'Grog Strongjaw', amount: 5, actionType: 'damage' },
          { combatantName: 'Goblin Scout', amount: 7, actionType: 'damage' },
        ],
        encounterId,
      },
      { campaignId, encounterId }
    );
    const proposalId = result.proposal.proposalId;

    // The goblin is removed from the encounter before the DM approves.
    db.prepare('DELETE FROM encounter_units WHERE instanceId = ?').run(goblinId);
    const enc = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(enc.running_state);
    rs.combatants = rs.combatants.filter((c) => c.instanceId !== goblinId);
    db.prepare('UPDATE encounters SET running_state = ? WHERE id = ?').run(JSON.stringify(rs), encounterId);

    const confirmRes = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'approve' });

    // The roster changed since staging (the goblin is gone), so the state
    // hash no longer matches and the whole proposal is rejected — including
    // Grog's half, even though he's untouched — rather than partially
    // applying it and reporting the goblin as skipped.
    expect(confirmRes.status).toBe(409);
    expect(confirmRes.body.status).toBe('stale');

    const updatedGrogUnit = db
      .prepare('SELECT currentHp, tempHp FROM encounter_units WHERE instanceId = ?')
      .get(grogId);
    expect(updatedGrogUnit.currentHp).toBe(40);
    expect(updatedGrogUnit.tempHp).toBe(10);
  });

  it('cancels mutation cleanly on denial: leaves encounter_units and running_state completely unchanged', async () => {
    const beforeUnit = db
      .prepare('SELECT currentHp, tempHp FROM encounter_units WHERE instanceId = ?')
      .get(grogId);

    const result = await executeTool(
      'apply_combat_damage',
      {
        targets: [
          {
            combatantName: 'Grog Strongjaw',
            amount: 20,
            actionType: 'damage',
          },
        ],
        encounterId,
      },
      { campaignId, encounterId }
    );

    const proposalId = result.proposal.proposalId;

    // Resolve proposal via POST /api/assistant/confirm with 'deny'
    const denyRes = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'deny' });

    expect(denyRes.status).toBe(200);
    expect(denyRes.body.cancelled).toBe(true);
    expect(denyRes.body.status).toBe('denied');

    // Verify SQLite encounter_units is untouched
    const afterUnit = db
      .prepare('SELECT currentHp, tempHp FROM encounter_units WHERE instanceId = ?')
      .get(grogId);

    expect(afterUnit.currentHp).toBe(beforeUnit.currentHp);
    expect(afterUnit.tempHp).toBe(beforeUnit.tempHp);

    // Verify running_state is untouched
    const enc = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(enc.running_state);
    const grogCombatant = rs.combatants.find((c) => c.instanceId === grogId);
    expect(grogCombatant.currentHp).toBe(beforeUnit.currentHp);
    expect(grogCombatant.tempHp).toBe(beforeUnit.tempHp);
  });
});
