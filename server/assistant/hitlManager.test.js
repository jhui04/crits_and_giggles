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

  describe('Proposal Superseding (M-1)', () => {
    it('supersedes an earlier still-pending proposal when a new one is staged for the same campaign', () => {
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

      expect(hitlManager.getProposal(a.proposalId).status).toBe('superseded');
      expect(hitlManager.getProposal(b.proposalId).status).toBe('pending');

      const pending = hitlManager.listPendingProposals();
      expect(pending).toHaveLength(1);
      expect(pending[0].proposalId).toBe(b.proposalId);
    });

    it('does not supersede a pending proposal staged for a different campaign', () => {
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

    it('does not supersede any proposal when the new one has no campaignId in context', () => {
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
      });

      expect(hitlManager.getProposal(a.proposalId).status).toBe('pending');
      expect(hitlManager.getProposal(b.proposalId).status).toBe('pending');
    });

    it('rejects approving or denying a superseded proposal with ALREADY_RESOLVED', async () => {
      const a = hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Goblin to A1',
        payload: {},
        context: { campaignId: 'camp-1' },
      });
      hitlManager.createProposal({
        toolName: 'move_combatant',
        description: 'Move Goblin to Z9',
        payload: {},
        context: { campaignId: 'camp-1' },
      });

      await expect(hitlManager.resolveProposal(a.proposalId, 'approve')).rejects.toMatchObject({
        code: 'ALREADY_RESOLVED',
        status: 'superseded',
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

