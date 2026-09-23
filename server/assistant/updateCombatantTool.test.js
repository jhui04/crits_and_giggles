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

describe('update_combatant Tool Backend & State Integration', () => {
  const campaignId = 'test-update-camp';
  const encounterId = 'test-update-enc';
  const goblinId = 'test-update-goblin';

  beforeEach(() => {
    clearProposals();
    clearWriteTools();
    registerBuiltInWriteTools();

    db.prepare('DELETE FROM encounter_units WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM encounters WHERE campaign_id = ?').run(campaignId);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);

    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
      campaignId,
      'Update Combatant Test Campaign',
      'Testing precise combatant rename/faction edits'
    );

    const runningState = JSON.stringify({
      isCombatStarted: true,
      round: 1,
      turnIndex: 0,
      combatants: [
        { instanceId: goblinId, name: 'Goblin Scout', currentHp: 7, maxHp: 7, initiative: 14, isPlayer: false, faction: 'enemy', position: { x: 2, y: 2 } },
      ],
    });

    db.prepare(
      'INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)'
    ).run(encounterId, campaignId, 'Charm Event', runningState);

    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, faction, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(goblinId, encounterId, campaignId, 'Goblin Scout', 7, 7, 1, 14, 0, 'enemy', 2, 2);
  });

  it('verifies tool is registered as an authoritative write tool', () => {
    expect(isWriteTool('update_combatant')).toBe(true);
  });

  it('stages a proposal describing a rename without mutating state', async () => {
    const result = await executeTool(
      'update_combatant',
      { combatantName: 'Goblin Scout', newName: 'Bandit Scout', encounterId },
      { campaignId, encounterId }
    );

    expect(result.status).toBe('proposal_staged');
    const proposal = result.proposal;
    expect(proposal.toolName).toBe('update_combatant');
    expect(proposal.payloadType).toBe('generic');
    expect(proposal.payload.Name).toBe('Goblin Scout → Bandit Scout');
    expect(proposal.payload.Faction).toBeUndefined();
    expect(proposal.description).toMatch(/renamed to "Bandit Scout"/);

    const stillOriginal = db.prepare('SELECT name FROM encounter_units WHERE instanceId = ?').get(goblinId);
    expect(stillOriginal.name).toBe('Goblin Scout');
  });

  it('stages a proposal describing a faction change without mutating state', async () => {
    const result = await executeTool(
      'update_combatant',
      { combatantId: goblinId, faction: 'ally', encounterId },
      { campaignId, encounterId }
    );

    const proposal = result.proposal;
    expect(proposal.payload.Faction).toBe('enemy → ally');
    expect(proposal.payload.Name).toBeUndefined();
    expect(proposal.description).toMatch(/faction changed to "ally"/);
  });

  it('stages a proposal describing both a rename and a faction change together', async () => {
    const result = await executeTool(
      'update_combatant',
      { combatantId: goblinId, newName: 'Bandit Scout', faction: 'ally', encounterId },
      { campaignId, encounterId }
    );

    const proposal = result.proposal;
    expect(proposal.payload.Name).toBe('Goblin Scout → Bandit Scout');
    expect(proposal.payload.Faction).toBe('enemy → ally');
  });

  it('throws a clear error when neither newName nor faction is provided', async () => {
    await expect(
      executeTool('update_combatant', { combatantId: goblinId, encounterId }, { campaignId, encounterId })
    ).rejects.toThrow(/at least one of newName or faction/);
  });

  it('throws a clear error for an invalid faction value', async () => {
    await expect(
      executeTool('update_combatant', { combatantId: goblinId, faction: 'chaotic-neutral', encounterId }, { campaignId, encounterId })
    ).rejects.toThrow(/invalid faction/);
  });

  it('throws a clear error when the requested values are identical to the current ones (no-op rejection)', async () => {
    await expect(
      executeTool('update_combatant', { combatantId: goblinId, faction: 'enemy', encounterId }, { campaignId, encounterId })
    ).rejects.toThrow(/no changes to make/);
  });

  it('throws a clear error when the combatant cannot be found', async () => {
    await expect(
      executeTool('update_combatant', { combatantName: 'Nonexistent Ghost', newName: 'X', encounterId }, { campaignId, encounterId })
    ).rejects.toThrow(/not found/);
  });

  it('refuses to guess when the name is ambiguous, rather than silently renaming one of several same-named combatants', async () => {
    const secondGoblinId = 'test-update-goblin-2';
    db.prepare(
      'INSERT INTO encounter_units (instanceId, encounter_id, campaign_id, name, maxHp, currentHp, dexMod, initiative, isPlayer, faction, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(secondGoblinId, encounterId, campaignId, 'Goblin Scout', 7, 7, 1, 10, 0, 'enemy', 3, 3);
    const enc = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(enc.running_state);
    rs.combatants.push({ instanceId: secondGoblinId, name: 'Goblin Scout', currentHp: 7, maxHp: 7, initiative: 10, isPlayer: false, faction: 'enemy', position: { x: 3, y: 3 } });
    db.prepare('UPDATE encounters SET running_state = ? WHERE id = ?').run(JSON.stringify(rs), encounterId);

    await expect(
      executeTool('update_combatant', { combatantName: 'Goblin Scout', newName: 'Bandit Scout', encounterId }, { campaignId, encounterId })
    ).rejects.toThrow(/ambiguous/);

    // Neither same-named combatant was renamed
    const survivors = db.prepare('SELECT name FROM encounter_units WHERE encounter_id = ?').all(encounterId);
    expect(survivors.every((s) => s.name === 'Goblin Scout')).toBe(true);
  });

  it('executes mutation on approval: updates encounter_units and running_state for both fields', async () => {
    const staged = await executeTool(
      'update_combatant',
      { combatantId: goblinId, newName: 'Bandit Scout', faction: 'ally', encounterId },
      { campaignId, encounterId }
    );
    const proposalId = staged.proposal.proposalId;

    const response = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'approve' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.executionSummary).toContain('name -> "Bandit Scout"');
    expect(response.body.executionSummary).toContain('faction -> "ally"');

    const updatedUnit = db.prepare('SELECT name, faction FROM encounter_units WHERE instanceId = ?').get(goblinId);
    expect(updatedUnit.name).toBe('Bandit Scout');
    expect(updatedUnit.faction).toBe('ally');

    const updatedEncounter = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);
    const rs = JSON.parse(updatedEncounter.running_state);
    const updatedCombatant = rs.combatants.find((c) => c.instanceId === goblinId);
    expect(updatedCombatant.name).toBe('Bandit Scout');
    expect(updatedCombatant.faction).toBe('ally');
  });

  it('cancels cleanly on denial: leaves encounter_units and running_state completely unchanged', async () => {
    const staged = await executeTool(
      'update_combatant',
      { combatantId: goblinId, newName: 'Bandit Scout', encounterId },
      { campaignId, encounterId }
    );
    const proposalId = staged.proposal.proposalId;

    const response = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId, action: 'deny' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('denied');

    const unitAfterDeny = db.prepare('SELECT name, faction FROM encounter_units WHERE instanceId = ?').get(goblinId);
    expect(unitAfterDeny.name).toBe('Goblin Scout');
    expect(unitAfterDeny.faction).toBe('enemy');
  });
});
