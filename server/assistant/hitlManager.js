import crypto from 'crypto';

/**
 * @typedef {'pending' | 'approved' | 'denied' | 'expired' | 'superseded'} ProposalStatus
 * @typedef {'movement' | 'damage' | 'combatant_config' | 'generic'} ProposalPayloadType
 *
 * @typedef {Object} StagedProposalRecord
 * @property {string} proposalId
 * @property {string} toolName
 * @property {string} description
 * @property {true} requiresConfirmation
 * @property {ProposalStatus} status
 * @property {number} createdAt
 * @property {number} expiresAt
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

    /** @type {Array<Object>} */
    this.auditLog = [];

    this.defaultTtlMs = 15 * 60 * 1000; // 15 minutes

    // Proposals and audit log entries are otherwise never evicted, which
    // would grow both without bound over a long-running server process.
    this.maxAuditLogEntries = 2000;
    this.maxResolvedProposalAgeMs = 60 * 60 * 1000; // 1 hour
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
      const staleAt = record.resolvedAt ?? record.expiresAt ?? record.createdAt;
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
   * @param {number} [params.ttlMs]
   * @returns {Object} Public client-facing proposal representation
   */
  createProposal({
    toolName,
    description,
    payloadType = 'generic',
    payload = {},
    executionPayload,
    context = {},
    ttlMs = this.defaultTtlMs,
  }) {
    if (!toolName || typeof toolName !== 'string') {
      throw new Error('createProposal: toolName must be a non-empty string');
    }
    if (!description || typeof description !== 'string') {
      throw new Error('createProposal: description must be a non-empty string');
    }

    const proposalId = this.generateProposalId();
    const now = Date.now();

    // Supersede any still-pending proposal for the same campaign. The
    // confirmation UI only ever surfaces one proposal at a time, and the
    // proposal-recovery endpoint (see N-7) would otherwise hand back
    // whichever abandoned proposal happens to be oldest — not what the DM
    // most recently asked for. Superseding (a terminal status, kept in the
    // audit trail rather than deleted) means at most one proposal per
    // campaign is ever pending, so recovery and listPendingProposals can't
    // return a stale one (see M-1). Only proposals with a known matching
    // campaignId are superseded; a proposal staged with no campaign context
    // is left alone since there is no reliable way to tell it apart from
    // proposals staged for a different conversation entirely.
    if (context.campaignId) {
      for (const existing of this.proposals.values()) {
        if (existing.status === 'pending' && existing.context?.campaignId === context.campaignId) {
          existing.status = 'superseded';
          existing.resolvedAt = now;
          this.auditLog.push({
            timestamp: new Date(now).toISOString(),
            event: 'proposal_superseded',
            proposalId: existing.proposalId,
            toolName: existing.toolName,
            description: existing.description,
            campaignId: context.campaignId,
          });
        }
      }
    }

    /** @type {StagedProposalRecord} */
    const record = {
      proposalId,
      toolName,
      description,
      requiresConfirmation: true,
      status: 'pending',
      createdAt: now,
      expiresAt: now + ttlMs,
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
   * Retrieves a proposal by ID, checking expiration.
   * @param {string} proposalId
   * @returns {StagedProposalRecord | null}
   */
  getProposal(proposalId) {
    if (!proposalId) return null;
    const record = this.proposals.get(proposalId);
    if (!record) return null;

    if (record.status === 'pending' && Date.now() > record.expiresAt) {
      record.status = 'expired';
      this.auditLog.push({
        timestamp: new Date().toISOString(),
        event: 'proposal_expired',
        proposalId,
      });
    }

    return record;
  }

  /**
   * Returns a list of currently pending, non-expired proposals.
   * @returns {Array<Object>}
   */
  listPendingProposals() {
    const now = Date.now();
    const pendingList = [];

    for (const record of this.proposals.values()) {
      if (record.status === 'pending') {
        if (now > record.expiresAt) {
          record.status = 'expired';
          this.auditLog.push({
            timestamp: new Date().toISOString(),
            event: 'proposal_expired',
            proposalId: record.proposalId,
          });
        } else {
          pendingList.push(this.toClientProposal(record));
        }
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
      const message =
        record.status === 'superseded'
          ? `Proposal "${proposalId}" was superseded by a newer proposal staged for the same campaign and can no longer be resolved.`
          : `Proposal "${proposalId}" is already resolved (${record.status}).`;
      const err = new Error(message);
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

    // Mark status as approved synchronously BEFORE yielding to event loop in handler
    record.status = 'approved';

    let mutationResult;
    try {
      // Execute registered mutation handler
      mutationResult = await handler(record.executionPayload, record.context);
    } catch (err) {
      // Revert status to pending if mutation handler fails so it can be retried or inspected
      record.status = 'pending';
      throw err;
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
export const resolveProposal = hitlManager.resolveProposal.bind(hitlManager);
export const clearProposals = hitlManager.clearProposals.bind(hitlManager);
export const generateProposalId = hitlManager.generateProposalId.bind(hitlManager);

export default hitlManager;
