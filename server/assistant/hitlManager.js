import crypto from 'crypto';

/**
 * @typedef {'pending' | 'approved' | 'denied' | 'stale'} ProposalStatus
 * @typedef {'movement' | 'damage' | 'combatant_config' | 'generic'} ProposalPayloadType
 *
 * @typedef {Object} StagedProposalRecord
 * @property {string} proposalId
 * @property {string} toolName
 * @property {string} description
 * @property {true} requiresConfirmation
 * @property {ProposalStatus} status
 * @property {number} createdAt
 * @property {string|null} [stateHash] Hash of the relevant game state at staging time, used to
 *   detect and reject stale approvals instead of a time-based expiry (see registerStateHasher).
 * @property {string[]|null} [affectedIds] IDs of the specific resources this proposal's mutation
 *   targets, if known at staging time (see createProposal / rebaseOtherPendingProposals).
 * @property {ProposalPayloadType} payloadType
 * @property {Record<string, any>} payload
 * @property {Record<string, any>} executionPayload
 * @property {Record<string, any>} context
 * @property {number} [resolvedAt]
 */

class HitlManager {
  constructor() {
    /** @type {Map<string, StagedProposalRecord>} */
    this.proposals = new Map();

    /** @type {Map<string, Function>} */
    this.mutationHandlers = new Map();

    /**
     * Optional per-tool `(context) => Promise<string|null>` functions that
     * compute a hash of the game state a proposal depends on. Used to detect
     * staleness at approval time instead of a fixed timer: a proposal only
     * ever becomes invalid because the state it targeted actually changed,
     * not because a DM took a while to review it.
     * @type {Map<string, Function>}
     */
    this.stateHashers = new Map();

    /** @type {Array<Object>} */
    this.auditLog = [];

    // Proposals are no longer time-boxed; they stay pending until approved,
    // denied, or found stale. Without a timer, a runaway/adversarial agent
    // could otherwise stage an unbounded number of proposals for one
    // campaign, so pending proposals are still capped per campaign.
    this.maxPendingPerCampaign = 25;

    // Proposals and audit log entries are otherwise never evicted, which
    // would grow both without bound over a long-running server process.
    this.maxAuditLogEntries = 2000;
    this.maxResolvedProposalAgeMs = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Registers a state-hash function for a write tool, used to detect stale
   * approvals (see resolveProposal). Optional: tools that don't register one
   * are never rejected for staleness.
   * @param {string} toolName
   * @param {(context: Record<string, any>) => (string|null|Promise<string|null>)} hasherFn
   */
  registerStateHasher(toolName, hasherFn) {
    if (typeof hasherFn !== 'function') {
      throw new Error(`registerStateHasher: hasher for ${toolName} must be a function`);
    }
    this.stateHashers.set(toolName, hasherFn);
  }

  /**
   * Drops resolved/denied/expired proposals older than maxResolvedProposalAgeMs
   * and trims the audit log to maxAuditLogEntries. Called opportunistically
   * whenever a proposal is created so the store doesn't grow unbounded.
   */
  evictStaleRecords() {
    const now = Date.now();
    for (const [id, record] of this.proposals) {
      if (record.status === 'pending') continue;
      const staleAt = record.resolvedAt ?? record.createdAt;
      if (now - staleAt > this.maxResolvedProposalAgeMs) {
        this.proposals.delete(id);
      }
    }
    if (this.auditLog.length > this.maxAuditLogEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.maxAuditLogEntries);
    }
  }

  /**
   * Generates a collision-resistant, timestamped proposal ID.
   * @returns {string}
   */
  generateProposalId() {
    const timestamp = Date.now();
    const randomHex = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    return `prop_${timestamp}_${randomHex}`;
  }

  /**
   * Stages a new proposal in the centralized HITL registry.
   * @param {Object} params
   * @param {string} params.toolName
   * @param {string} params.description
   * @param {ProposalPayloadType} [params.payloadType='generic']
   * @param {Record<string, any>} [params.payload={}]
   * @param {Record<string, any>} [params.executionPayload]
   * @param {Record<string, any>} [params.context={}]
   * @param {string|null} [params.stateHash] Hash of the game state this proposal depends on,
   *   captured at staging time. Compared against a freshly computed hash at approval time
   *   (see resolveProposal) to reject stale approvals instead of relying on a timer.
   * @param {string[]|null} [params.affectedIds] IDs of the specific resources (e.g. combatant
   *   instanceIds) this proposal's mutation reads or writes, if the tool knows them at staging
   *   time. Used only to decide whether ANOTHER pending proposal can be rebased onto this one's
   *   post-approval state (see rebaseOtherPendingProposals) without masking a genuine conflict —
   *   has no effect on this proposal's own approval.
   * @returns {Object} Public client-facing proposal representation
   */
  createProposal({
    toolName,
    description,
    payloadType = 'generic',
    payload = {},
    executionPayload,
    context = {},
    stateHash = null,
    affectedIds = null,
  }) {
    if (!toolName || typeof toolName !== 'string') {
      throw new Error('createProposal: toolName must be a non-empty string');
    }
    if (!description || typeof description !== 'string') {
      throw new Error('createProposal: description must be a non-empty string');
    }

    // Multiple proposals may be pending at once for the same campaign — the
    // DM reviews them one at a time in a queue rather than only ever seeing
    // the single most recent one. Without a timer to naturally bound the
    // list, a runaway/adversarial agent staging proposal after proposal
    // without any DM response would otherwise grow this without limit.
    if (context.campaignId) {
      let pendingCount = 0;
      for (const existing of this.proposals.values()) {
        if (existing.status === 'pending' && existing.context?.campaignId === context.campaignId) {
          pendingCount++;
        }
      }
      if (pendingCount >= this.maxPendingPerCampaign) {
        throw new Error(
          `Too many actions (${pendingCount}) are already awaiting the Dungeon Master's confirmation for this campaign. Wait for some of them to be approved or denied before proposing more.`
        );
      }
    }

    const proposalId = this.generateProposalId();
    const now = Date.now();

    /** @type {StagedProposalRecord} */
    const record = {
      proposalId,
      toolName,
      description,
      requiresConfirmation: true,
      status: 'pending',
      createdAt: now,
      stateHash,
      affectedIds: Array.isArray(affectedIds) ? affectedIds : null,
      payloadType,
      payload,
      executionPayload: executionPayload !== undefined ? executionPayload : payload,
      context,
    };

    this.proposals.set(proposalId, record);

    this.auditLog.push({
      timestamp: new Date(now).toISOString(),
      event: 'proposal_created',
      proposalId,
      toolName,
      description,
      campaignId: context.campaignId,
    });

    this.evictStaleRecords();

    return this.toClientProposal(record);
  }

  /**
   * Retrieves a proposal by ID.
   * @param {string} proposalId
   * @returns {StagedProposalRecord | null}
   */
  getProposal(proposalId) {
    if (!proposalId) return null;
    return this.proposals.get(proposalId) || null;
  }

  /**
   * Returns a list of currently pending proposals, oldest first (the order
   * the DM should review them in).
   * @returns {Array<Object>}
   */
  listPendingProposals() {
    const pendingList = [];
    for (const record of this.proposals.values()) {
      if (record.status === 'pending') {
        pendingList.push(this.toClientProposal(record));
      }
    }
    return pendingList;
  }

  /**
   * Registers a mutation execution handler for a write tool.
   * @param {string} toolName
   * @param {Function} handlerFn
   */
  registerExecutionHandler(toolName, handlerFn) {
    if (typeof handlerFn !== 'function') {
      throw new Error(`registerExecutionHandler: handler for ${toolName} must be a function`);
    }
    this.mutationHandlers.set(toolName, handlerFn);
  }

  /**
   * Resolves a pending proposal by approving or denying it.
   * Enforces replay protection and idempotency.
   *
   * @param {string} proposalId
   * @param {'approve' | 'deny'} action
   * @returns {Promise<Object>}
   */
  async resolveProposal(proposalId, action) {
    if (action !== 'approve' && action !== 'deny') {
      const err = new Error(`Invalid action "${action}". Must be "approve" or "deny".`);
      err.code = 'INVALID_ACTION';
      throw err;
    }

    const record = this.getProposal(proposalId);
    if (!record) {
      const err = new Error(`Proposal "${proposalId}" not found or has expired.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (record.status !== 'pending') {
      const err = new Error(`Proposal "${proposalId}" is already resolved (${record.status}).`);
      err.code = 'ALREADY_RESOLVED';
      err.status = record.status;
      throw err;
    }

    if (action === 'deny') {
      record.status = 'denied';
      record.resolvedAt = Date.now();
      this.auditLog.push({
        timestamp: new Date().toISOString(),
        event: 'proposal_denied',
        proposalId,
        toolName: record.toolName,
        description: record.description,
        campaignId: record.context?.campaignId,
      });

      return {
        success: true,
        proposalId,
        action: 'deny',
        status: 'denied',
        cancelled: true,
        message: 'Action cancelled by user. No state was modified.',
      };
    }

    // action === 'approve'
    const handler = this.mutationHandlers.get(record.toolName);
    if (!handler) {
      const err = new Error(`No handler registered for tool "${record.toolName}". Unsupported tool.`);
      err.code = 'NO_HANDLER';
      throw err;
    }

    // Claim the proposal SYNCHRONOUSLY (no await between the status check
    // above and this line) so a concurrent approve/deny sees a non-pending
    // status and gets ALREADY_RESOLVED instead of also running the handler.
    // 'approved' is what clients see while in flight; it is released back to
    // 'pending' if the staleness hasher or the handler throws (or to 'stale').
    record.status = 'approved';
    record.inFlight = true;

    let mutationResult;
    try {
      // Staleness check: reject the approval if the game state this proposal
      // depended on has actually changed since it was staged, rather than
      // relying on a fixed timer.
      const stateHasher = this.stateHashers.get(record.toolName);
      if (stateHasher && record.stateHash != null) {
        const currentHash = await stateHasher(record.context);
        if (currentHash !== record.stateHash) {
          record.status = 'stale';
          record.resolvedAt = Date.now();
          this.auditLog.push({
            timestamp: new Date().toISOString(),
            event: 'proposal_stale_rejected',
            proposalId,
            toolName: record.toolName,
            description: record.description,
            campaignId: record.context?.campaignId,
          });

          const err = new Error(
            `This action can no longer be applied: the game state it was based on has changed since it was proposed (e.g. combatants moved, HP changed, or the roster was edited). Ask the Oracle to propose the action again against the current state.`
          );
          err.code = 'STALE_STATE';
          err.status = 'stale';
          throw err;
        }
      }

      // Execute registered mutation handler
      mutationResult = await handler(record.executionPayload, record.context);
    } catch (err) {
      // Release the claim; revert to pending (unless found stale) so it can be retried or inspected
      if (record.status === 'approved') record.status = 'pending';
      throw err;
    } finally {
      record.inFlight = false;
    }

    record.resolvedAt = Date.now();

    this.auditLog.push({
      timestamp: new Date().toISOString(),
      event: 'proposal_approved',
      proposalId,
      toolName: record.toolName,
      description: record.description,
      summary: mutationResult?.executionSummary,
      campaignId: record.context?.campaignId,
    });

    // This mutation just legitimately changed the state that OTHER still-
    // pending proposals for this campaign were hashed against (e.g. this
    // was one of several queued map moves), which would otherwise make
    // every one of them fail the staleness check on its own approval even
    // though nothing invalid happened to it. Rebase the ones that provably
    // don't target the same resource(s) this mutation touched onto the
    // post-mutation state now, synchronously, before this call returns and
    // any other request can run — see rebaseOtherPendingProposals.
    await this.rebaseOtherPendingProposals(record);

    return {
      success: true,
      proposalId,
      action: 'approve',
      status: 'approved',
      executionSummary: mutationResult?.executionSummary || record.description,
      updatedState: mutationResult?.updatedState || null,
    };
  }

  /**
   * Recomputes and stores a fresh state-hash baseline for other pending
   * proposals in the same campaign, right after a mutation commits — but
   * ONLY for the ones that provably don't target the same resource(s) this
   * mutation just touched. Without this, once the LLM queues several
   * proposals against the same encounter-wide hash (e.g. two queued moves
   * for two different tokens on the same map) approving the first one
   * would make its own side effect look identical to an actual conflict,
   * and the staleness check in resolveProposal would deny the second one
   * purely because the first was applied — not because anything invalid
   * happened to IT between staging and review.
   *
   * The overlap check is deliberately conservative: it only rebases a
   * pending proposal when BOTH it and the just-resolved one declared
   * `affectedIds` (see createProposal) and those id sets don't intersect.
   * If either side didn't declare its affected resources, or they share an
   * id (e.g. two proposals both targeting the same combatant — see
   * docs/HITL_WRITE_TOOLS.md §8's "same combatant" example), the pending
   * proposal is left alone and keeps failing staleness the old way, since
   * there's no way to prove applying it on top of the new state wouldn't
   * silently misapply a plan computed against the combatant's old values.
   *
   * This only runs from inside resolveProposal, synchronously after that
   * mutation's handler has already returned and before resolveProposal
   * itself returns to its caller. Node's single-threaded event loop means
   * no other request's mutation can interleave and change state in
   * between, so "the hash right after this approval" is unambiguous.
   * @param {StagedProposalRecord} resolvedRecord The just-approved proposal.
   */
  async rebaseOtherPendingProposals(resolvedRecord) {
    const campaignId = resolvedRecord.context?.campaignId;
    if (!campaignId) return;
    const resolvedIds = resolvedRecord.affectedIds;
    if (!Array.isArray(resolvedIds)) return;

    for (const other of this.proposals.values()) {
      if (other.status !== 'pending') continue;
      if (other.context?.campaignId !== campaignId) continue;
      const hasher = this.stateHashers.get(other.toolName);
      if (!hasher || other.stateHash == null) continue;

      const otherIds = other.affectedIds;
      if (!Array.isArray(otherIds)) continue;
      const overlaps = otherIds.some((id) => resolvedIds.includes(id));
      if (overlaps) continue;

      try {
        other.stateHash = await hasher(other.context);
      } catch {
        // Leave the existing hash in place; if recomputation is failing
        // the approval-time check will surface that failure when this
        // proposal itself is resolved.
      }
    }
  }

  /**
   * Returns the most recent approve/deny decisions for a campaign, most
   * recent first. Used to tell the assistant what the DM just decided (see
   * G-16 partial fix) without needing a full conversation-history
   * subsystem: the audit log already records every resolution server-side.
   *
   * Only decisions within maxResolvedProposalAgeMs are returned — the audit
   * log itself is trimmed by count, not age, so without this a decision
   * from days earlier on a long-lived server could be presented to the
   * model under a heading that says "RECENT" when it no longer is (see
   * M-3). Each entry also carries its own timestamp so the caller can
   * present exactly how old it is rather than just trusting the heading.
   * @param {string} campaignId
   * @param {number} [limit=5]
   * @returns {Array<{event: 'proposal_approved'|'proposal_denied', toolName: string, description: string, timestamp: string}>}
   */
  getRecentDecisions(campaignId, limit = 5) {
    if (!campaignId) return [];
    const cutoff = Date.now() - this.maxResolvedProposalAgeMs;
    const decisions = this.auditLog.filter(
      (entry) =>
        (entry.event === 'proposal_approved' || entry.event === 'proposal_denied') &&
        entry.campaignId === campaignId &&
        new Date(entry.timestamp).getTime() >= cutoff
    );
    return decisions.slice(-limit).reverse();
  }

  /**
   * Converts internal record to client-safe representation.
   * @param {StagedProposalRecord} record
   * @returns {Object}
   */
  toClientProposal(record) {
    return {
      proposalId: record.proposalId,
      toolName: record.toolName,
      description: record.description,
      requiresConfirmation: true,
      status: record.status,
      createdAt: record.createdAt,
      payloadType: record.payloadType,
      payload: record.payload,
      context: {
        campaignId: record.context?.campaignId ?? null,
        encounterId: record.context?.encounterId ?? null,
      },
    };
  }

  /**
   * Resets proposal store and audit logs (used for test isolation).
   */
  clearProposals() {
    this.proposals.clear();
    this.auditLog.length = 0;
  }
}

export const hitlManager = new HitlManager();

export const createProposal = hitlManager.createProposal.bind(hitlManager);
export const getProposal = hitlManager.getProposal.bind(hitlManager);
export const listPendingProposals = hitlManager.listPendingProposals.bind(hitlManager);
export const registerExecutionHandler = hitlManager.registerExecutionHandler.bind(hitlManager);
export const registerStateHasher = hitlManager.registerStateHasher.bind(hitlManager);
export const resolveProposal = hitlManager.resolveProposal.bind(hitlManager);
export const clearProposals = hitlManager.clearProposals.bind(hitlManager);
export const generateProposalId = hitlManager.generateProposalId.bind(hitlManager);

export default hitlManager;
