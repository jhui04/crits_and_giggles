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

describe('remove_combatant Tool Backend & State Integration', () => {
  const campaignId = 'test-remove-camp';
  const encounterId = 'test-remove-enc';
  const grogId = 'test-remove-grog';
  const goblinId = 'test-remove-goblin';

  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();

    db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);

    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
      campaignId,
      'Remove Combatant Test Campaign',
      'Testing precise combatant removal'
    );

    const runningState = JSON.stringify({
      isCombatStarted: true,
      round: 2,
      turnIndex: 1,
      combatants: [
        { instanceId: grogId, name: 'Grog Strongjaw', currentHp: 40, maxHp: 50, initiative: 12, isPlayer: true, faction: 'ally', position: { x: 1, y: 1 } },
        { instanceId: goblinId, name: 'Goblin Scout', currentHp: 0, maxHp: 7, initiative: 14, isPlayer: false, faction: 'enemy', position: { x: 2, y: 2 } },
      ],
    });

    db.prepare(
      'INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)'
    ).run(encounterId, campaignId, 'Ambush Cleanup', runningState);

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, faction, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(grogId, encounterId, campaignId, 'Grog Strongjaw', 50, 40, 2, 12, 1, 'ally', 1, 1);

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, faction, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(goblinId, encounterId, campaignId, 'Goblin Scout', 7, 0, 1, 14, 0, 'enemy', 2, 2);
  });

  it('verifies tool is registered as an authoritative write tool', () => {
    expect(isWriteTool('remove_combatant')).toBe(true);
  });

  it('stages a confirmation proposal describing the target combatant without mutating state', async () => {
    const result = await executeTool(
      'remove_combatant',
      { combatantName: 'Goblin Scout', encounterId },
      { campaignId, encounterId }
    );

    expect(result.status).toBe('proposal_staged');
    expect(result.requiresConfirmation).toBe(true);

    const proposal = result.proposal;
    expect(proposal.toolName).toBe('remove_combatant');
    expect(proposal.payloadType).toBe('generic');
    expect(proposal.payload.Combatant).toBe('Goblin Scout');
    expect(proposal.payload.Faction).toBe('enemy');
    expect(proposal.payload.HP).toBe('0/7');
    expect(proposal.description).toMatch(/Remove Goblin Scout/);

    // Verify nothing was mutated during staging
    const stillThere = db.prepare('SELECT instanceId FROM encounter_units WHERE instanceId = ?').get(goblinId);
    expect(stillThere).toBeDefined();
  });

  it('throws a clear error when neither combatantId nor combatantName is supplied', async () => {
    await expect(
      executeTool('remove_combatant', { encounterId }, { campaignId, encounterId })
    ).rejects.toThrow(/combatantId or combatantName is required/);
  });

  it('throws a clear error when the combatant cannot be found', async () => {
    await expect(
      executeTool('remove_combatant', { combatantName: 'Nonexistent Ghost', encounterId }, { campaignId, encounterId })
    ).rejects.toThrow(/not found/);
  });

  it('refuses to guess when the name is ambiguous, rather than silently removing one of several same-named combatants', async () => {
    const secondGoblinId = 'test-remove-goblin-2';
    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, faction, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(secondGoblinId, encounterId, campaignId, 'Goblin Scout', 7, 7, 1, 10, 0, 'enemy', 3, 3);
    const enc = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(enc.running_state);
    rs.combatants.push({ instanceId: secondGoblinId, name: 'Goblin Scout', currentHp: 7, maxHp: 7, initiative: 10, isPlayer: false, faction: 'enemy', position: { x: 3, y: 3 } });
    db.prepare('UPDATE encounters SET running_state = ? WHERE id = ?').run(JSON.stringify(rs), encounterId);

    await expect(
      executeTool('remove_combatant', { combatantName: 'Goblin Scout', encounterId }, { campaignId, encounterId })
    ).rejects.toThrow(/ambiguous/);

    // Neither same-named combatant was removed
    const survivors = db.prepare('SELECT instanceId FROM encounter_units WHERE encounter_id = ?').all(encounterId);
    expect(survivors.map((s) => s.instanceId)).toEqual(expect.arrayContaining([goblinId, secondGoblinId]));
  });

  it('executes mutation on approval: deletes from encounter_units, running_state, and clamps turnIndex', async () => {
    const staged = await executeTool(
      'remove_combatant',
      { combatantId: goblinId, encounterId },
      { campaignId, encounterId }
    );
    const proposalId = staged.proposal.proposalId;

    const response = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'approve' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.executionSummary).toContain('Removed Goblin Scout');

    // encounter_units no longer has the removed combatant
    const deletedUnit = db.prepare('SELECT instanceId FROM encounter_units WHERE instanceId = ?').get(goblinId);
    expect(deletedUnit).toBeUndefined();

    // running_state.combatants no longer includes it, and the surviving
    // combatant (Grog) is untouched
    const updatedEncounter = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(updatedEncounter.running_state);
    expect(rs.combatants.find((c) => c.instanceId === goblinId)).toBeUndefined();
    expect(rs.combatants.find((c) => c.instanceId === grogId)).toBeDefined();

    // turnIndex was pointing at index 1 (the goblin); after removal there is
    // only 1 combatant left, so it must clamp to a valid index (0).
    expect(rs.turnIndex).toBe(0);
  });

  it('cancels cleanly on denial: leaves encounter_units and running_state completely unchanged', async () => {
    const staged = await executeTool(
      'remove_combatant',
      { combatantId: goblinId, encounterId },
      { campaignId, encounterId }
    );
    const proposalId = staged.proposal.proposalId;

    const response = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'deny' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('denied');

    const stillThere = db.prepare('SELECT instanceId FROM encounter_units WHERE instanceId = ?').get(goblinId);
    expect(stillThere).toBeDefined();

    const encAfterDeny = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(encAfterDeny.running_state);
    expect(rs.combatants.find((c) => c.instanceId === goblinId)).toBeDefined();
  });

  it('rejects approval as stale if the combatant was already removed before approval executes, rather than reporting a false no-op success', async () => {
    const staged = await executeTool(
      'remove_combatant',
      { combatantId: goblinId, encounterId },
      { campaignId, encounterId }
    );
    const proposalId = staged.proposal.proposalId;

    // Simulate the combatant being removed out-of-band between staging and approval
    db.prepare('DELETE FROM encounter_units WHERE instanceId = ?').run(goblinId);
    const enc = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(enc.running_state);
    rs.combatants = rs.combatants.filter((c) => c.instanceId !== goblinId);
    db.prepare('UPDATE encounters SET running_state = ? WHERE id = ?').run(JSON.stringify(rs), encounterId);

    const response = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'approve' });

    // The roster changed since staging, so the state hash no longer
    // matches and the approval is rejected as stale.
    expect(response.status).toBe(409);
    expect(response.body.status).toBe('stale');
  });
});
