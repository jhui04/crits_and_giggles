import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const hitlManagerPath = path.resolve(__dirname, 'hitlManager.js');
const isImplemented = fs.existsSync(hitlManagerPath);

describe('HITL Manager Proposal Lifecycle Unit Tests', () => {
  if (!isImplemented) {
    it('specifies the HITL manager interface and lifecycle contract (M1 pending implementation)', () => {
      // When hitlManager.js is implemented by Milestone 1 backend worker,
      // all unit test suites below will automatically activate and run.
      expect(isImplemented).toBe(false);
    });
    return;
  }

  let hitlManager;

  beforeEach(async () => {
    // Dynamic import to support pre-implementation compilation
    hitlManager = await import('./hitlManager.js');
    if (hitlManager.clearProposals) {
      hitlManager.clearProposals();
    }
  });

  describe('Proposal Creation and Staging', () => {
    it('creates a pending proposal with required fields and unique ID', () => {
      const proposal = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Grog Strongjaw from L8 to M9',
        payloadType: 'movement',
        payload: {
          combatantId: 'c-grog-1',
          origin: { x: 12, y: 8, label: 'L8' },
          destination: { x: 13, y: 9, label: 'M9' },
        },
      });

      expect(proposal).toBeDefined();
      expect(proposal.proposalId).toBeDefined();
      expect(typeof proposal.proposalId).toBe('string');
      expect(proposal.proposalId.length).toBeGreaterThan(0);
      expect(proposal.toolName).toBe('move_combatant');
      expect(proposal.description).toBe('Move Grog Strongjaw from L8 to M9');
      expect(proposal.requiresConfirmation).toBe(true);
      expect(proposal.status).toBe('pending');
      expect(typeof proposal.createdAt).toBe('number');
      expect(proposal.payloadType).toBe('movement');
      expect(proposal.payload.combatantId).toBe('c-grog-1');
    });

    it('generates distinct unique IDs for successive proposals', () => {
      const p1 = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Action 1',
        payloadType: 'generic',
        payload: {},
      });
      const p2 = hitlManager.createProposal({
        toolName: 'apply_combat_damage',
        description: 'Action 2',
        payloadType: 'generic',
        payload: {},
      });

      expect(p1.proposalId).not.toBe(p2.proposalId);
    });

    it('retrieves an existing staged proposal by ID via getProposal', () => {
      const created = hitlManager.createProposal({
        toolName: 'apply_combat_damage',
        description: 'Apply 15 fire damage to Goblin Boss',
        payloadType: 'damage',
        payload: { amount: 15 },
      });

      const retrieved = hitlManager.getProposal(created.proposalId);
      expect(retrieved).toBeDefined();
      expect(retrieved.proposalId).toBe(created.proposalId);
      expect(retrieved.description).toBe(created.description);
    });

    it('returns null or undefined when querying a non-existent proposal ID', () => {
      const result = hitlManager.getProposal('non-existent-prop-999');
      expect(result == null).toBe(true);
    });

    it('includes newly created proposal in listPendingProposals', () => {
      const p1 = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Action A',
        payloadType: 'generic',
        payload: {},
      });

      const pending = hitlManager.listPendingProposals();
      expect(Array.isArray(pending)).toBe(true);
      const found = pending.find((p) => p.proposalId === p1.proposalId);
      expect(found).toBeDefined();
      expect(found.status).toBe('pending');
    });
  });

  describe('Proposal Queueing (multiple pending proposals per campaign)', () => {
    it('keeps an earlier still-pending proposal pending when a new one is staged for the same campaign, instead of superseding it', () => {
      const a = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Goblin to A1',
        payload: {},
        context: { campaignId: 'camp-1' },
      });
      const b = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Goblin to Z9',
        payload: {},
        context: { campaignId: 'camp-1' },
      });

      expect(hitlManager.getProposal(a.proposalId).status).toBe('pending');
      expect(hitlManager.getProposal(b.proposalId).status).toBe('pending');

      // Both are queued, oldest first — the DM reviews them one at a time.
      const pending = hitlManager.listPendingProposals();
      expect(pending).toHaveLength(2);
      expect(pending[0].proposalId).toBe(a.proposalId);
      expect(pending[1].proposalId).toBe(b.proposalId);
    });

    it('does not mix up pending proposals staged for a different campaign', () => {
      const a = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Goblin to A1',
        payload: {},
        context: { campaignId: 'camp-1' },
      });
      const b = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Orc to B2',
        payload: {},
        context: { campaignId: 'camp-2' },
      });

      expect(hitlManager.getProposal(a.proposalId).status).toBe('pending');
      expect(hitlManager.getProposal(b.proposalId).status).toBe('pending');
    });

    it('allows both proposals staged for the same campaign to be individually approved/denied', async () => {
      hitlManager.registerExecutionHandler('queue_probe_tool', async () => ({ executionSummary: 'done' }));

      const a = hitlManager.createProposal({
        toolName: 'queue_probe_tool',
        description: 'Move Goblin to A1',
        payload: {},
        context: { campaignId: 'camp-queue' },
      });
      const b = hitlManager.createProposal({
        toolName: 'queue_probe_tool',
        description: 'Move Goblin to Z9',
        payload: {},
        context: { campaignId: 'camp-queue' },
      });

      const resultA = await hitlManager.resolveProposal(a.proposalId, 'approve');
      expect(resultA.success).toBe(true);

      // Resolving A must not have disturbed B, unlike the old supersede
      // behavior which would have already marked one of them terminal.
      expect(hitlManager.getProposal(b.proposalId).status).toBe('pending');

      const resultB = await hitlManager.resolveProposal(b.proposalId, 'deny');
      expect(resultB.success).toBe(true);
      expect(hitlManager.listPendingProposals()).toHaveLength(0);
    });

    it('rejects staging further proposals for a campaign once maxPendingPerCampaign is reached', () => {
      const campaignId = 'camp-overflow';
      for (let i = 0; i < hitlManager.hitlManager.maxPendingPerCampaign; i++) {
        hitlManager.createProposal({
          toolName: 'move_combatant',
          description: `Action ${i}`,
          payload: {},
          context: { campaignId },
        });
      }

      expect(() =>
        hitlManager.createProposal({
          toolName: 'move_combatant',
          description: 'One too many',
          payload: {},
          context: { campaignId },
        })
      ).toThrow(/too many actions/i);
    });
  });

  describe('Stale State Detection via Hash Comparison (replaces timer-based expiry)', () => {
    it('approves normally when the state hash at approval time matches the one captured at staging', async () => {
      hitlManager.registerExecutionHandler('hash_match_tool', async () => ({ executionSummary: 'applied' }));
      hitlManager.registerStateHasher('hash_match_tool', async () => 'same-hash');

      const proposal = hitlManager.createProposal({
        toolName: 'hash_match_tool',
        description: 'Do the thing',
        payload: {},
        stateHash: 'same-hash',
      });

      const result = await hitlManager.resolveProposal(proposal.proposalId, 'approve');
      expect(result.success).toBe(true);
      expect(result.status).toBe('approved');
    });

    it('rejects approval with STALE_STATE when the current hash no longer matches the staged one, and never invokes the mutation handler', async () => {
      const mutationHandler = vi.fn().mockResolvedValue({ executionSummary: 'should never run' });
      hitlManager.registerExecutionHandler('hash_mismatch_tool', mutationHandler);
      hitlManager.registerStateHasher('hash_mismatch_tool', async () => 'current-hash-after-change');

      const proposal = hitlManager.createProposal({
        toolName: 'hash_mismatch_tool',
        description: 'Do the thing',
        payload: {},
        stateHash: 'hash-at-staging-time',
      });

      await expect(hitlManager.resolveProposal(proposal.proposalId, 'approve')).rejects.toMatchObject({
        code: 'STALE_STATE',
        status: 'stale',
      });

      expect(mutationHandler).not.toHaveBeenCalled();
      expect(hitlManager.getProposal(proposal.proposalId).status).toBe('stale');

      // A proposal rejected as stale is terminal, not retryable.
      await expect(hitlManager.resolveProposal(proposal.proposalId, 'approve')).rejects.toMatchObject({
        code: 'ALREADY_RESOLVED',
      });
    });

    it('still allows denial of a proposal whose state has gone stale, without ever checking the hash', async () => {
      const mutationHandler = vi.fn();
      hitlManager.registerExecutionHandler('hash_deny_tool', mutationHandler);
      hitlManager.registerStateHasher('hash_deny_tool', async () => 'changed-hash');

      const proposal = hitlManager.createProposal({
        toolName: 'hash_deny_tool',
        description: 'Do the thing',
        payload: {},
        stateHash: 'original-hash',
      });

      const result = await hitlManager.resolveProposal(proposal.proposalId, 'deny');
      expect(result.success).toBe(true);
      expect(result.status).toBe('denied');
      expect(mutationHandler).not.toHaveBeenCalled();
    });

    it('does not check staleness for tools with no registered state hasher', async () => {
      const mutationHandler = vi.fn().mockResolvedValue({ executionSummary: 'applied' });
      hitlManager.registerExecutionHandler('no_hasher_tool', mutationHandler);

      const proposal = hitlManager.createProposal({
        toolName: 'no_hasher_tool',
        description: 'Do the thing',
        payload: {},
        // No stateHash provided, and no hasher registered for this tool.
      });

      const result = await hitlManager.resolveProposal(proposal.proposalId, 'approve');
      expect(result.success).toBe(true);
      expect(mutationHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Rebasing queued proposals after an approval (multi-proposal queue + hash staleness)', () => {
    it('rebases another pending proposal onto the post-mutation hash so approving it does not spuriously reject as stale', async () => {
      const campaignId = 'camp-rebase';
      // Simulates a shared piece of state (e.g. "all token positions") whose
      // hash changes once, as a result of approving proposal A.
      let sharedState = 'state-v1';
      hitlManager.registerExecutionHandler('rebase_tool', async () => {
        sharedState = 'state-v2';
        return { executionSummary: 'applied' };
      });
      hitlManager.registerStateHasher('rebase_tool', async () => sharedState);

      const proposalA = hitlManager.createProposal({
        toolName: 'rebase_tool',
        description: 'Move token A',
        payload: {},
        context: { campaignId },
        stateHash: 'state-v1',
        affectedIds: ['token-a'],
      });
      const proposalB = hitlManager.createProposal({
        toolName: 'rebase_tool',
        description: 'Move token B',
        payload: {},
        context: { campaignId },
        stateHash: 'state-v1',
        affectedIds: ['token-b'],
      });

      const resultA = await hitlManager.resolveProposal(proposalA.proposalId, 'approve');
      expect(resultA.status).toBe('approved');

      // Proposal B was staged against the same pre-mutation hash as A. If B's
      // stored hash weren't rebased onto the new state, approving it next
      // would be rejected as stale purely because A ran — not because
      // anything invalid happened to B specifically.
      const resultB = await hitlManager.resolveProposal(proposalB.proposalId, 'approve');
      expect(resultB.status).toBe('approved');
    });

    it('still rejects a rebased proposal as stale if the state changes again after the rebase', async () => {
      const campaignId = 'camp-rebase-then-drift';
      let sharedState = 'state-v1';
      hitlManager.registerExecutionHandler('rebase_drift_tool', async () => {
        sharedState = 'state-v2';
        return { executionSummary: 'applied' };
      });
      hitlManager.registerStateHasher('rebase_drift_tool', async () => sharedState);

      const proposalA = hitlManager.createProposal({
        toolName: 'rebase_drift_tool',
        description: 'Move token A',
        payload: {},
        context: { campaignId },
        stateHash: 'state-v1',
        affectedIds: ['token-a'],
      });
      const proposalB = hitlManager.createProposal({
        toolName: 'rebase_drift_tool',
        description: 'Move token B',
        payload: {},
        context: { campaignId },
        stateHash: 'state-v1',
        affectedIds: ['token-b'],
      });

      await hitlManager.resolveProposal(proposalA.proposalId, 'approve');

      // Something changes the state again after B was rebased (e.g. a manual
      // DM edit, or a third approval) — B should still correctly go stale.
      sharedState = 'state-v3-unexpected-drift';

      await expect(hitlManager.resolveProposal(proposalB.proposalId, 'approve')).rejects.toMatchObject({
        code: 'STALE_STATE',
      });
    });

    it('does not rebase pending proposals belonging to a different campaign', async () => {
      // Each campaign's hash is independent; approving campaign A's proposal
      // (which changes campaign A's state) should never touch campaign B's
      // still-pending proposal.
      const hashesByCampaign = { 'camp-a': 'a-v1', 'camp-b': 'b-v1' };
      hitlManager.registerExecutionHandler('rebase_scope_tool', async (payload, context) => {
        hashesByCampaign[context.campaignId] = 'a-v2';
        return { executionSummary: 'applied' };
      });
      hitlManager.registerStateHasher('rebase_scope_tool', async (context) => hashesByCampaign[context.campaignId]);

      const proposalOtherCampaign = hitlManager.createProposal({
        toolName: 'rebase_scope_tool',
        description: 'Do something in campaign B',
        payload: {},
        context: { campaignId: 'camp-b' },
        stateHash: 'b-v1',
      });
      const proposalThisCampaign = hitlManager.createProposal({
        toolName: 'rebase_scope_tool',
        description: 'Do something in campaign A',
        payload: {},
        context: { campaignId: 'camp-a' },
        stateHash: 'a-v1',
      });

      await hitlManager.resolveProposal(proposalThisCampaign.proposalId, 'approve');

      expect(hitlManager.getProposal(proposalOtherCampaign.proposalId).stateHash).toBe('b-v1');
    });

    it('does NOT rebase a pending proposal that targets the same resource as the just-approved one, so a genuine conflict still goes stale', async () => {
      const campaignId = 'camp-rebase-overlap';
      let sharedState = 'state-v1';
      hitlManager.registerExecutionHandler('rebase_overlap_tool', async () => {
        sharedState = 'state-v2';
        return { executionSummary: 'applied' };
      });
      hitlManager.registerStateHasher('rebase_overlap_tool', async () => sharedState);

      // Both proposals target the same combatant ("hero") — e.g. two queued
      // moves for the same token to different destinations.
      const proposalA = hitlManager.createProposal({
        toolName: 'rebase_overlap_tool',
        description: 'Move hero to A1',
        payload: {},
        context: { campaignId },
        stateHash: 'state-v1',
        affectedIds: ['hero'],
      });
      const proposalB = hitlManager.createProposal({
        toolName: 'rebase_overlap_tool',
        description: 'Move hero to T20',
        payload: {},
        context: { campaignId },
        stateHash: 'state-v1',
        affectedIds: ['hero'],
      });

      await hitlManager.resolveProposal(proposalA.proposalId, 'approve');

      await expect(hitlManager.resolveProposal(proposalB.proposalId, 'approve')).rejects.toMatchObject({
        code: 'STALE_STATE',
      });
    });

    it('does not rebase a pending proposal when either side never declared affectedIds', async () => {
      const campaignId = 'camp-rebase-unknown';
      let sharedState = 'state-v1';
      hitlManager.registerExecutionHandler('rebase_unknown_tool', async () => {
        sharedState = 'state-v2';
        return { executionSummary: 'applied' };
      });
      hitlManager.registerStateHasher('rebase_unknown_tool', async () => sharedState);

      const proposalA = hitlManager.createProposal({
        toolName: 'rebase_unknown_tool',
        description: 'Do something unspecified',
        payload: {},
        context: { campaignId },
        stateHash: 'state-v1',
        // No affectedIds declared.
      });
      const proposalB = hitlManager.createProposal({
        toolName: 'rebase_unknown_tool',
        description: 'Do something else unspecified',
        payload: {},
        context: { campaignId },
        stateHash: 'state-v1',
        // No affectedIds declared.
      });

      await hitlManager.resolveProposal(proposalA.proposalId, 'approve');

      await expect(hitlManager.resolveProposal(proposalB.proposalId, 'approve')).rejects.toMatchObject({
        code: 'STALE_STATE',
      });
    });
  });

  describe('Recent Decisions Recency Window (M-3)', () => {
    it('omits a decision older than maxResolvedProposalAgeMs', async () => {
      hitlManager.registerExecutionHandler('recency_probe_tool', async () => ({ executionSummary: 'done' }));
      const proposal = hitlManager.createProposal({
        toolName: 'recency_probe_tool',
        description: 'Old decision',
        payload: {},
        context: { campaignId: 'camp-recency' },
      });
      await hitlManager.resolveProposal(proposal.proposalId, 'approve');

      // Backdate the audit entry past the recency window instead of waiting.
      const entry = hitlManager.hitlManager.auditLog.find(
        (e) => e.event === 'proposal_approved' && e.campaignId === 'camp-recency'
      );
      entry.timestamp = new Date(Date.now() - (hitlManager.hitlManager.maxResolvedProposalAgeMs + 60000)).toISOString();

      expect(hitlManager.hitlManager.getRecentDecisions('camp-recency')).toEqual([]);
    });

    it('includes a decision within maxResolvedProposalAgeMs', async () => {
      hitlManager.registerExecutionHandler('recency_probe_tool_2', async () => ({ executionSummary: 'done' }));
      const proposal = hitlManager.createProposal({
        toolName: 'recency_probe_tool_2',
        description: 'Fresh decision',
        payload: {},
        context: { campaignId: 'camp-recency-2' },
      });
      await hitlManager.resolveProposal(proposal.proposalId, 'approve');

      const decisions = hitlManager.hitlManager.getRecentDecisions('camp-recency-2');
      expect(decisions).toHaveLength(1);
      expect(decisions[0].description).toBe('Fresh decision');
    });
  });

  describe('Proposal Resolution Lifecycle (Approve & Deny)', () => {
    it('approves a proposal, executes registered handler, and updates status to approved', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
        updatedState: { position: 'M9' },
        executionSummary: 'Grog moved to M9',
      });

      hitlManager.registerExecutionHandler('move_combatant', mockHandler);

      const proposal = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Grog to M9',
        payloadType: 'movement',
        payload: { combatantId: 'c-grog-1', destination: 'M9' },
      });

      const result = await hitlManager.resolveProposal(proposal.proposalId, 'approve');

      expect(result.success).toBe(true);
      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(proposal.payload, expect.anything());

      const updated = hitlManager.getProposal(proposal.proposalId);
      expect(updated.status).toBe('approved');

      // Should no longer appear in pending list
      const pending = hitlManager.listPendingProposals();
      expect(pending.some((p) => p.proposalId === proposal.proposalId)).toBe(false);
    });

    it('denies a proposal cleanly without invoking execution handler and updates status to denied', async () => {
      const mockHandler = vi.fn();
      hitlManager.registerExecutionHandler('move_combatant', mockHandler);

      const proposal = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Grog to M9',
        payloadType: 'movement',
        payload: { combatantId: 'c-grog-1', destination: 'M9' },
      });

      const result = await hitlManager.resolveProposal(proposal.proposalId, 'deny');

      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(result.message).toContain('cancelled');
      expect(mockHandler).not.toHaveBeenCalled();

      const updated = hitlManager.getProposal(proposal.proposalId);
      expect(updated.status).toBe('denied');

      // Should no longer appear in pending list
      const pending = hitlManager.listPendingProposals();
      expect(pending.some((p) => p.proposalId === proposal.proposalId)).toBe(false);
    });

    it('rejects attempt to approve an already approved proposal (replay protection)', async () => {
      const mockHandler = vi.fn().mockResolvedValue({ success: true });
      hitlManager.registerExecutionHandler('move_combatant', mockHandler);

      const proposal = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Action',
        payloadType: 'generic',
        payload: {},
      });

      await hitlManager.resolveProposal(proposal.proposalId, 'approve');

      // Second approval attempt MUST fail
      await expect(
        hitlManager.resolveProposal(proposal.proposalId, 'approve')
      ).rejects.toThrow(/already resolved|not pending/i);
    });

    it('rejects attempt to deny an already denied proposal', async () => {
      const proposal = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Action',
        payloadType: 'generic',
        payload: {},
      });

      await hitlManager.resolveProposal(proposal.proposalId, 'deny');

      // Second deny attempt MUST fail
      await expect(
        hitlManager.resolveProposal(proposal.proposalId, 'deny')
      ).rejects.toThrow(/already resolved|not pending/i);
    });

    it('rejects resolution of unknown proposal ID', async () => {
      await expect(
        hitlManager.resolveProposal('unknown-prop-id-404', 'approve')
      ).rejects.toThrow(/not found/i);
    });

    it('rejects invalid action values (neither approve nor deny)', async () => {
      const proposal = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Action',
        payloadType: 'generic',
        payload: {},
      });

      await expect(
        hitlManager.resolveProposal(proposal.proposalId, 'invalid_action')
      ).rejects.toThrow(/action/i);
    });
  });

  describe('Handler Registration & Direct Write Prevention', () => {
    it('throws when approving a proposal for a tool with no registered handler', async () => {
      const proposal = hitlManager.createProposal({
        toolName: 'unregistered_write_tool',
        description: 'Unregistered mutation',
        payloadType: 'generic',
        payload: {},
      });

      await expect(
        hitlManager.resolveProposal(proposal.proposalId, 'approve')
      ).rejects.toThrow(/no handler registered|unsupported tool/i);
    });
  });

  describe('ToolController Write Tool Integration & Two-Phase Invariant', () => {
    it('registers write tools, verifies classification, and stages proposals via executeTool', async () => {
      const { registerWriteTool, executeTool, isWriteTool, isReadTool, clearWriteTools } = await import('./toolController.js');

      const mockMutationHandler = vi.fn().mockResolvedValue({
        success: true,
        updatedState: { position: { x: 5, y: 5 } },
        executionSummary: 'Unit moved to (5, 5)',
      });

      const writeTool = registerWriteTool({
        name: 'test_tactical_move',
        description: 'Move a token on the grid',
        payloadType: 'movement',
        parameters: {
          type: 'object',
          properties: {
            unitId: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
          },
        },
        async stageProposal(args) {
          const proposal = hitlManager.createProposal({
            toolName: 'test_tactical_move',
            description: `Move unit ${args.unitId} to (${args.x}, ${args.y})`,
            payloadType: 'movement',
            payload: { unitId: args.unitId, destination: { x: args.x, y: args.y } },
            executionPayload: { unitId: args.unitId, x: args.x, y: args.y },
          });
          return { proposal, summary: proposal.description };
        },
        executeMutation: mockMutationHandler,
      });

      expect(isWriteTool('test_tactical_move')).toBe(true);
      expect(isReadTool('test_tactical_move')).toBe(false);
      expect(isReadTool('lookup_spell')).toBe(true);

      // Phase 1: executeTool stages proposal with requiresConfirmation: true
      const result = await executeTool('test_tactical_move', { unitId: 'u-1', x: 5, y: 5 });

      expect(result.status).toBe('proposal_staged');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal.proposalId).toBeDefined();
      expect(result.proposal.status).toBe('pending');

      // Crucial Safety Invariant: mutation handler MUST NOT have been called during executeTool!
      expect(mockMutationHandler).not.toHaveBeenCalled();

      // Phase 2: Approve executes mutation handler
      const resolveResult = await hitlManager.resolveProposal(result.proposal.proposalId, 'approve');
      expect(resolveResult.success).toBe(true);
      expect(resolveResult.status).toBe('approved');
      expect(mockMutationHandler).toHaveBeenCalledTimes(1);
      expect(mockMutationHandler).toHaveBeenCalledWith({ unitId: 'u-1', x: 5, y: 5 }, expect.anything());

      clearWriteTools();
    });
  });
});

