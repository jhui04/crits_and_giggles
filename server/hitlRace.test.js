import { describe, it, expect, beforeEach } from 'vitest';
import hitlManager from './assistant/hitlManager.js';

describe('HITL resolveProposal concurrency', () => {
  beforeEach(() => hitlManager.clearProposals());

  function stage(toolName, extra = {}) {
    return hitlManager.createProposal({ toolName, description: 'x', context: { campaignId: 'c' }, ...extra });
  }

  it('runs the handler once for concurrent approves; second gets ALREADY_RESOLVED', async () => {
    let calls = 0;
    hitlManager.registerStateHasher('race_tool', async () => 'h');
    hitlManager.registerExecutionHandler('race_tool', async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { executionSummary: 'ok' };
    });
    const p = stage('race_tool', { stateHash: 'h' });
    const results = await Promise.allSettled([
      hitlManager.resolveProposal(p.proposalId, 'approve'),
      hitlManager.resolveProposal(p.proposalId, 'approve'),
    ]);
    expect(calls).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected.reason.code).toBe('ALREADY_RESOLVED');
    expect(hitlManager.listPendingProposals()).toHaveLength(0);
  });

  it('deny during an in-flight approve does not flip state', async () => {
    hitlManager.registerExecutionHandler('race_tool2', async () => {
      await new Promise((r) => setTimeout(r, 10));
      return {};
    });
    const p = stage('race_tool2');
    const approve = hitlManager.resolveProposal(p.proposalId, 'approve');
    await expect(hitlManager.resolveProposal(p.proposalId, 'deny')).rejects.toMatchObject({ code: 'ALREADY_RESOLVED' });
    await approve;
    expect(hitlManager.getProposal(p.proposalId).status).toBe('approved');
  });

  it('releases the claim when the handler fails so it can be retried', async () => {
    let fail = true;
    hitlManager.registerExecutionHandler('race_tool3', async () => {
      if (fail) throw new Error('boom');
      return {};
    });
    const p = stage('race_tool3');
    await expect(hitlManager.resolveProposal(p.proposalId, 'approve')).rejects.toThrow('boom');
    expect(hitlManager.getProposal(p.proposalId).status).toBe('pending');
    fail = false;
    await expect(hitlManager.resolveProposal(p.proposalId, 'approve')).resolves.toMatchObject({ status: 'approved' });
  });

  it('marks stale and rejects concurrent second caller', async () => {
    let calls = 0;
    hitlManager.registerStateHasher('race_tool4', async () => 'changed');
    hitlManager.registerExecutionHandler('race_tool4', async () => { calls++; return {}; });
    const p = stage('race_tool4', { stateHash: 'orig' });
    const results = await Promise.allSettled([
      hitlManager.resolveProposal(p.proposalId, 'approve'),
      hitlManager.resolveProposal(p.proposalId, 'approve'),
    ]);
    expect(calls).toBe(0);
    expect(results.map((r) => r.reason.code).sort()).toEqual(['ALREADY_RESOLVED', 'STALE_STATE']);
    expect(hitlManager.getProposal(p.proposalId).status).toBe('stale');
  });
});
