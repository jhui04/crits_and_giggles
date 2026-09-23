import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import hitlManager, {
  createProposal,
  getProposal,
  registerExecutionHandler,
  resolveProposal,
  clearProposals,
} from './hitlManager.js';
import {
  registerWriteTool,
  executeTool,
  clearWriteTools,
} from './toolController.js';
import { db } from '../db.js';

describe('Adversarial Backend Verification: Security & Invariants', () => {
  beforeEach(() => {
    clearProposals();
    clearWriteTools();
  });

  it('PROBE 1: Zero-Mutation Guarantee on Denial against SQLite state', async () => {
    const campaignId = 'zero-mut-camp';
    const encounterId = 'zero-mut-enc';
    const unitId = 'zero-mut-unit';

    // Clean up
    db.prepare('DELETE FROM encounter_units WHERE instanceId = ?').run(unitId);
    db.prepare('DELETE FROM encounters WHERE id = ?').run(encounterId);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);

    // Setup valid records
    db.prepare('INSERT INTO campaigns (id, name, description) VALUES (?, ?, ?)').run(
      campaignId,
      'Test Campaign',
      'Test Desc'
    );
    const initialRunningState = JSON.stringify({ isCombatStarted: true, round: 1, combatants: [{ id: unitId, hp: 30 }] });
    db.prepare('INSERT INTO encounters (id, campaign_id, name, running_state) VALUES (?, ?, ?, ?)').run(
      encounterId,
      campaignId,
      'Test Encounter',
      initialRunningState
    );
    db.prepare(`
      INSERT INTO encounter_units (
        instanceId, encounter_id, campaign_id, name, currentHp, maxHp, dexMod, isPlayer, position_x, position_y
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(unitId, encounterId, campaignId, 'Target Unit', 30, 30, 2, 0, 5, 5);

    // Snapshot DB state before proposal
    const beforeUnit = db.prepare('SELECT * FROM encounter_units WHERE instanceId = ?').get(unitId);
    const beforeEncounter = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);

    let handlerInvoked = false;
    registerWriteTool({
      name: 'lethal_damage_tool',
      description: 'Deal 30 damage to target unit',
      payloadType: 'damage',
      parameters: { type: 'object' },
      async stageProposal(args) {
        const proposal = createProposal({
          toolName: 'lethal_damage_tool',
          description: 'Deal lethal damage',
          payloadType: 'damage',
          payload: args,
        });
        return { proposal, summary: proposal.description };
      },
      async executeMutation(payload) {
        handlerInvoked = true;
        db.prepare('UPDATE encounter_units SET currentHp = 0 WHERE instanceId = ?').run(payload.unitId);
        return { executionSummary: 'Target unit reduced to 0 HP' };
      },
    });

    // 1. Stage proposal
    const staged = await executeTool('lethal_damage_tool', { unitId });
    expect(staged.status).toBe('proposal_staged');
    expect(handlerInvoked).toBe(false);

    // Verify DB still unchanged after staging
    const midUnit = db.prepare('SELECT currentHp FROM encounter_units WHERE instanceId = ?').get(unitId);
    expect(midUnit.currentHp).toBe(30);

    // 2. Deny proposal
    const denyRes = await resolveProposal(staged.proposal.proposalId, 'deny');
    expect(denyRes.success).toBe(true);
    expect(denyRes.status).toBe('denied');
    expect(handlerInvoked).toBe(false);

    // 3. Verify zero mutation: state must match snapshot identically
    const afterUnit = db.prepare('SELECT * FROM encounter_units WHERE instanceId = ?').get(unitId);
    const afterEncounter = db.prepare('SELECT running_state FROM encounters WHERE id = ?').get(encounterId);

    expect(afterUnit).toEqual(beforeUnit);
    expect(afterEncounter.running_state).toBe(beforeEncounter.running_state);

    // Cleanup
    db.prepare('DELETE FROM encounter_units WHERE instanceId = ?').run(unitId);
    db.prepare('DELETE FROM encounters WHERE id = ?').run(encounterId);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);
  });

  it('PROBE 2: Replay Attack - Confirming already approved or denied proposals', async () => {
    registerExecutionHandler('test_replay', async () => ({ executionSummary: 'Executed' }));

    const proposalApproved = createProposal({
      toolName: 'test_replay',
      description: 'Approved Replay Test',
    });

    // Approve once -> 200
    const res1 = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId: proposalApproved.proposalId, action: 'approve' });
    expect(res1.status).toBe(200);

    // Replay approval -> 409 Conflict
    const res2 = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId: proposalApproved.proposalId, action: 'approve' });
    expect(res2.status).toBe(409);
    expect(res2.body.status).toBe('approved');

    // Deny an already approved proposal -> 409 Conflict
    const res3 = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId: proposalApproved.proposalId, action: 'deny' });
    expect(res3.status).toBe(409);

    // Test proposal denied
    const proposalDenied = createProposal({
      toolName: 'test_replay',
      description: 'Denied Replay Test',
    });

    // Deny once -> 200
    const res4 = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId: proposalDenied.proposalId, action: 'deny' });
    expect(res4.status).toBe(200);

    // Approve an already denied proposal -> 409 Conflict
    const res5 = await request(app)
      .post('/api/assistant/confirm')
      .send({ proposalId: proposalDenied.proposalId, action: 'approve' });
    expect(res5.status).toBe(409);
    expect(res5.body.status).toBe('denied');
  });

  it('PROBE 3: Malformed Action Payloads & Invalid IDs', async () => {
    // Missing ID
    const res1 = await request(app).post('/api/assistant/confirm').send({ action: 'approve' });
    expect(res1.status).toBe(400);

    // Non-string ID
    const res2 = await request(app).post('/api/assistant/confirm').send({ proposalId: 12345, action: 'approve' });
    expect(res2.status).toBe(400);

    // Non-existent ID
    const res3 = await request(app).post('/api/assistant/confirm').send({ proposalId: 'prop_does_not_exist', action: 'approve' });
    expect(res3.status).toBe(404);

    // Invalid action string
    const res4 = await request(app).post('/api/assistant/confirm').send({ proposalId: 'prop_123', action: 'delete' });
    expect(res4.status).toBe(400);

    // Extra properties / payload tampering attempts
    const proposal = createProposal({
      toolName: 'test_tamper',
      description: 'Tamper Test',
      payload: { safeAmount: 5 },
      executionPayload: { safeAmount: 5 },
    });
    registerExecutionHandler('test_tamper', async (payload) => {
      // Must receive server-staged payload, NOT client-supplied overrides
      expect(payload.safeAmount).toBe(5);
      expect(payload.overrideAmount).toBeUndefined();
      return { executionSummary: 'Tamper resisted' };
    });

    const res5 = await request(app).post('/api/assistant/confirm').send({
      proposalId: proposal.proposalId,
      action: 'approve',
      overrideAmount: 99999, // Attempted client payload injection
      executionPayload: { safeAmount: 99999 },
    });
    expect(res5.status).toBe(200);
  });

  it('PROBE 4: Concurrency Race Condition - Asynchronous Double Execution Vulnerability', async () => {
    let executionCount = 0;
    // Simulate an async operation with I/O delay (e.g., 30ms)
    registerExecutionHandler('async_concurrency_probe', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      executionCount++;
      return { executionSummary: `Run #${executionCount}` };
    });

    const proposal = createProposal({
      toolName: 'async_concurrency_probe',
      description: 'Concurrency race probe',
    });

    // Send 3 concurrent HTTP approval requests at the same instant
    const [resA, resB, resC] = await Promise.all([
      request(app).post('/api/assistant/confirm').send({ proposalId: proposal.proposalId, action: 'approve' }),
      request(app).post('/api/assistant/confirm').send({ proposalId: proposal.proposalId, action: 'approve' }),
      request(app).post('/api/assistant/confirm').send({ proposalId: proposal.proposalId, action: 'approve' }),
    ]);

    const statuses = [resA.status, resB.status, resC.status];
    // Verify TOCTOU concurrency race condition is prevented:
    // Exactly 1 request succeeds with 200 and executes the handler;
    // The other 2 concurrent requests receive 409 Conflict.
    expect(executionCount).toBe(1);
    expect(statuses.filter((s) => s === 200).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(2);
  });

  describe('GET /api/assistant/proposals/pending (N-7 recovery endpoint)', () => {
    it('lets a client recover a pending proposal it lost local state for, scoped to its campaign', async () => {
      const campaignId = 'pending-recovery-camp';
      const otherCampaignId = 'pending-recovery-other-camp';

      const mine = createProposal({
        toolName: 'move_combatant',
        description: 'Move Goblin to B3.',
        payload: {},
        context: { campaignId },
      });
      createProposal({
        toolName: 'move_combatant',
        description: 'Move Orc to C4.',
        payload: {},
        context: { campaignId: otherCampaignId },
      });

      const res = await request(app).get('/api/assistant/proposals/pending').query({ campaignId });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].proposalId).toBe(mine.proposalId);
      expect(res.body[0].description).toBe('Move Goblin to B3.');
    });

    it('never returns an already-resolved proposal', async () => {
      const campaignId = 'pending-recovery-resolved-camp';
      registerExecutionHandler('move_combatant', async () => ({ executionSummary: 'done' }));

      const proposal = createProposal({
        toolName: 'move_combatant',
        description: 'Move Goblin to B3.',
        payload: {},
        context: { campaignId },
      });
      await resolveProposal(proposal.proposalId, 'deny');

      const res = await request(app).get('/api/assistant/proposals/pending').query({ campaignId });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
