# Developer Guide: Centralized Human-in-the-Loop (HITL) Write-Tool Framework

## 1. Core Philosophy: Two-Phase Write Architecture

In **Crits & Giggles**, the AI Assistant Oracle acts as an interactive co-DM for visually impaired and blind Dungeon Masters running live Dungeons & Dragons 5e sessions. In this environment, an unverified or hallucinated modification to game state—such as moving a combatant to an incorrect grid coordinate, subtracting wrong hit points, or mutating combatant rosters—can derail an active combat session and disorient screen reader users.

To guarantee safety, predictability, and total DM agency:
- **Direct state mutation during the chat loop is strictly prohibited.**
- Every tool capable of mutating state (campaign, encounter, combatants, tokens, or maps) must pass through the **Centralized Human-in-the-Loop (HITL) Protocol**.

### The Two-Phase Write Lifecycle

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 1: LLM Tool Staging (Read-Only Invariant)                                        │
│                                                                                        │
│ User Prompt ──► handleAssistantChat() ──► executeTool(writeTool)                      │
│                                                   │                                    │
│                   ┌───────────────────────────────┴──────────────────────────────┐     │
│                   ▼                                                              ▼     │
│        Validate State & Args                                      Stage Proposal in    │
│        (No DB writes allowed)                                     hitlManager (UUID)   │
│                   │                                                              │     │
│                   └───────────────────────────────┬──────────────────────────────┘     │
│                                                   ▼                                    │
│                LLM receives acknowledgment: "Proposal Staged for DM Confirmation"      │
│                API returns: { answer, proposal: ConfirmationProposal }                 │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 2: Human Confirmation & Atomic Execution                                         │
│                                                                                        │
│ DM reviews proposal in dedicated UI card (Approve Alt+Y / Deny Alt+N)                  │
│                                                   │                                    │
│                   ┌───────────────────────────────┴──────────────────────────────┐     │
│                   ▼                                                              ▼     │
│       POST /api/assistant/confirm                                POST /api/assistant/confirm  │
│         { proposalId, action: 'deny' }                             { proposalId, action: 'approve' } │
│                   │                                                              │     │
│                   ▼                                                              ▼     │
│          Clean No-Op Cancellation                                   Atomic Transaction │
│          - Status -> 'denied'                                       - Execute Handler  │
│          - 0 DB mutations                                           - Mutate SQLite DB │
│          - Screen reader feedback                                   - Status -> 'approved' │
│          - Focus -> #assistant-oracle-input                         - Return updatedState │
│                                                                     - Focus -> #assistant-oracle-input │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Write Tool Registration & Interface Contract

All write tools register with the tool controller via `registerWriteTool()`. When registered, tools are whitelisted for LLM tool calling, routed to staging during Phase 1, and bound to `hitlManager` for execution in Phase 2.

### Registration Signature

```javascript
import { registerWriteTool } from '../assistant/toolController.js';
import { db } from '../db.js';

registerWriteTool({
  name: 'example_write_tool',
  description: 'Human-in-the-loop write tool description for the LLM.',
  payloadType: 'generic', // 'movement' | 'damage' | 'combatant_config' | 'generic'
  parameters: {
    type: 'object',
    properties: {
      entityId: { type: 'string', description: 'ID of target entity' },
      newValue: { type: 'number', description: 'Proposed value' },
    },
    required: ['entityId', 'newValue'],
  },

  /**
   * Phase 1: Proposal Staging Handler
   * Validates arguments against authoritative state and stages proposal.
   * MUST NOT perform database mutations.
   */
  async stageProposal(args, context) {
    const { campaignId, encounterId } = context;

    // 1. Validate arguments & pre-conditions
    if (typeof args.newValue !== 'number') {
      throw new Error('newValue must be a number.');
    }

    // 2. Stage proposal in centralized hitlManager
    const proposal = hitlManager.createProposal({
      toolName: 'example_write_tool',
      description: `Update entity ${args.entityId} to value ${args.newValue}`,
      payloadType: 'generic',
      payload: {
        entityId: args.entityId,
        newValue: args.newValue,
      },
      executionPayload: {
        entityId: args.entityId,
        newValue: args.newValue,
      },
      context: { campaignId, encounterId },
    });

    return {
      proposal,
      summary: proposal.description,
    };
  },

  /**
   * Phase 2: Mutation Execution Handler
   * Invoked ONLY when human DM clicks "Approve" (Alt+Y).
   * Executes atomic database update.
   */
  async executeMutation(executionPayload, context) {
    const { entityId, newValue } = executionPayload;

    // Atomic SQLite mutation inside transaction
    const updateTx = db.transaction(() => {
      // Execute SQL writes...
    });
    updateTx();

    return {
      updatedState: { entityId, value: newValue },
      executionSummary: `Successfully updated entity ${entityId} to ${newValue}.`,
    };
  },
});
```

---

## 3. Security: Zero-Trust Client Execution Payload

To prevent client-side parameter tampering or race conditions:
1. The authoritative `executionPayload` is kept strictly server-side in `hitlManager`.
2. The client receives only visual presentation data (`payload`) and an immutable UUID (`proposalId`).
3. Confirmation requests submit only `{ proposalId, action: 'approve' | 'deny' }`.
4. The server looks up the original staged parameters from memory. Client tampering is prevented by design.

---

## 4. Custom Presentation Payloads

The framework standardizes the confirmation container shell while allowing custom presentation sub-cards via `payloadType`:

### Subsystem Payload Types
- **`movement` (`MovementProposalPayload`)**:
  - `combatantId`, `combatantName`
  - `origin`: `{ x, y, label, regionName }`
  - `destination`: `{ x, y, label, regionName }`
  - `originAdjacencies`: `{ allies: string[], enemies: string[], neutral: string[] }`
  - `destinationAdjacencies`: `{ allies: string[], enemies: string[], neutral: string[] }`
- **`damage` (`DamageProposalPayload`)**:
  - `targets`: Array of `{ combatantId, combatantName, amount, actionType, damageType, currentHp, currentTempHp, maxHp, projectedHp, projectedTempHp, effectiveChange }`
- **`map_patch` (`MapPatchProposalPayload`)** (`propose_map_patch`):
  - `map`, `Change`, and the detail lines for that change (cells, terrain, object kind, cover, region, new name). Approval appends operations to the `map_overrides` table; `buildMapModel` applies them in order. The generated `public/data/maps/*.json` is never modified. The state hash is a fingerprint of the map id and its stored corrections, so approving one correction makes other pending ones for the same map stale. Corrections belong to the map, not to a campaign: every campaign that uses that map sees them.
- **`combatant_config` (`CombatantConfigProposalPayload`)**:
  - `encounterId`, `encounterName`, `scenarioTextSummary`
  - `combatants`: Array of `{ name, coordinates: { x, y, label, regionName }, phase, faction, hp }`
- **`generic` (`GenericProposalPayload`)**:
  - Flexible key-value table fallback for general administrative mutations.

---

## 5. Accessibility & Focus Integrity Standards

In accordance with `GEMINI.md` and WCAG 2.1/2.2 AAA guidelines:

1. **Exact DOM Mounting Location**:
   - `HitlConfirmationBox` must be mounted strictly between the chat history log (`<div role="log">`) and the prompt input form (`<form onSubmit={handleSend}>`).
   - Ensures natural tab order and keeps proposals visible outside scrolling chat history.
2. **Landmark Semantics & Hierarchy**:
   - Container has `role="region"` with `aria-labelledby="hitl-proposal-title"`.
   - Heading is level 3 (`<h3 id="hitl-proposal-title" tabIndex={-1}>`), preserving semantic structure under `<h2>Oracle AI</h2>`.
3. **Standardized Decision Controls**:
   - Standard "Approve" (`Alt+Y`) and "Deny" (`Alt+N`) buttons.
   - Includes `aria-keyshortcuts="Alt+Y"` and `aria-keyshortcuts="Alt+N"`.
   - Using the `Alt` modifier prevents conflicts with screen reader cursor keys.
4. **Predictable Focus Transitions (Zero Teleportation)**:
   - On proposal appearance: focus lands immediately on `#hitl-proposal-title` or Approve button.
   - On proposal resolution (Approve or Deny): focus is unconditionally restored to `#assistant-oracle-input`. Focus is never dropped to `document.body`.
5. **Persistent Screen Reader Announcements**:
   - Dedicated persistent live region `<div id="hitl-live-announcement" role="status" aria-live="polite" aria-atomic="true" className="sr-only">`.
   - Politeness rules:
     - Proposal arrival: `polite` ("Action proposed: ... Press Alt+Y to approve, Alt+N to deny.")
     - Approval execution: `assertive` / `polite` ("Action approved: ... Game state updated successfully.")
     - Denial cancellation: `polite` ("Action denied. Action cancelled by user.")

---

## 6. Clean Denial & Rollback Semantics

- **Denial (`Alt+N`)**: Discards the staged proposal from memory. 0 database queries or modifications occur. Clean confirmation is returned to the client and logged to the chat log.
- **Stale Rejection**: If the game state a proposal was staged against has changed by approval time, it is rejected before the mutation handler ever runs — 0 database queries or modifications occur, same as a denial. See §8 for the hash-based mechanism that replaced the old fixed-TTL expiry.
- **Rollback on Approval Error**: If an approved mutation fails during execution (e.g. SQLite constraint violation), the SQLite transaction rolls back completely, preserving encounter integrity. Returns HTTP 500 with error details.

---

## 7. HTTP API Reference

### `POST /api/assistant/chat`
- Emits prompt query. A single turn may invoke more than one write tool (e.g. "move the goblin to C4 and have it hit Grog for 6"); each staged proposal is returned in a `proposals` array, oldest first, rather than only surfacing the first one:
  ```json
  {
    "answer": "I've staged the move and the damage. Please confirm above.",
    "proposals": [
      {
        "proposalId": "prop_1790043552_8a7f9b2c",
        "toolName": "move_combatant",
        "description": "Move Grog Strongjaw from L8 (Shoreline) to M9 (Shoreline)",
        "requiresConfirmation": true,
        "status": "pending",
        "createdAt": 1790043552000,
        "payloadType": "movement",
        "payload": { ... }
      },
      { "proposalId": "prop_...", "toolName": "apply_combat_damage", "...": "..." }
    ]
  }
  ```
  Multiple proposals for the same campaign can be pending at once (capped at `hitlManager.maxPendingPerCampaign`, currently 25, to bound memory if an agent stages faster than the DM resolves); the client shows them to the DM one at a time and advances the queue as each is approved or denied. `GET /api/assistant/proposals/pending?campaignId=` returns the full queue, not just the most recent proposal.

### `POST /api/assistant/confirm`
- **Request Body**:
  ```json
  {
    "proposalId": "prop_1790043552_8a7f9b2c",
    "action": "approve" // or "deny"
  }
  ```
- **Responses**:
  - `200 OK`: Successful approval (`{ success: true, status: 'approved', executionSummary, updatedState }`) or denial (`{ success: true, status: 'denied', cancelled: true, message }`).
  - `400 Bad Request`: Missing `proposalId` or invalid `action`.
  - `404 Not Found`: Proposal missing.
  - `409 Conflict`, `status: '<terminal-status>'`: either the proposal has already been resolved (replay attack defense), or — for `status: 'stale'` — the game state it was staged against has changed since (see §8, "Staleness Detection" below, which replaces the old fixed-TTL expiry).
  - `500 Internal Server Error`: Mutation execution failed (rolled back).

> **No auth/campaign scoping (by design, for now).** This endpoint has no
> authentication and does not check that the caller has access to the
> proposal's campaign/encounter: anyone who knows (or guesses/enumerates) a
> `proposalId` can approve or deny it, and any `context` sent in the request
> body is ignored — resolution always uses the context captured when the
> proposal was staged. This is acceptable for the app's current local,
> single-user deployment model, but would need real request-level
> authorization (session/user identity checked against the proposal's
> campaign) before this endpoint could be exposed to multiple users or over
> an untrusted network.

---

## 8. Staleness Detection (Hash Comparison, Not a Timer)

Proposals do **not** expire on a fixed timer. A staged proposal stays pending — potentially indefinitely — until the DM approves it, denies it, or it is rejected as stale. This is a deliberate choice: a proposal a DM took twenty minutes to get back to and one they resolved in twenty seconds are equally valid to apply, *provided the state it was staged against hasn't actually changed*. What matters is not how much time passed, but whether the game state moved.

### How it works
1. **At staging time**, a write tool that opts in computes a hash of the game state it depends on and passes it to `hitlManager.createProposal({ ..., stateHash })`. For the five built-in combatant tools this is `computeEncounterStateHash(encounterId)` in `toolController.js`: a SHA-256 hash over every `encounter_units` row for that encounter (name, HP, position, faction, initiative, etc.) plus the combat-progress fields of `running_state` (round, turnIndex, isCombatStarted).
2. **At approval time**, `hitlManager.resolveProposal` recomputes the hash via the same tool's registered hasher (`registerWriteTool({ ..., getStateHash })` → `hitlManager.registerStateHasher`) and compares it to the one captured at staging. If they differ, the proposal's status becomes `'stale'` (terminal — it cannot be retried), the mutation handler is never invoked, and the confirm endpoint returns `409 { status: 'stale' }` with a message telling the DM/model to ask again against current state.
3. **If a tool never registers a hasher** (or a proposal was staged with no `stateHash`), it is never rejected for staleness — this mechanism is opt-in per tool, not a blanket gate.

### Rebasing the rest of the queue after an approval
Because the hash covers the *whole* encounter, approving one proposal changes the serialized state every *other* still-pending proposal for the same encounter was hashed against — even one that doesn't touch the same combatant. Left alone, that would make the second proposal in a queued multi-tool turn (see §9) fail its own staleness check purely because the first one was approved, not because anything invalid happened to it. That defeats the point of queueing: since the assistant has no chat history to fall back on and lost the ability to re-stage anything it couldn't call in the same turn, silently rejecting the rest of its own queue on the DM's first approval would be exactly the tool-call loss queueing was built to avoid.

But a blanket "rebase everything on every approval" would be wrong too: it would just as happily paper over a *genuine* conflict, e.g. two queued proposals that both move the same combatant to different destinations — approving the first should still make the second go stale, because applying it now means re-applying a plan that was computed against that combatant's old position/HP/etc. The two cases (harmless side effect on the shared encounter hash vs. an actual conflict) look identical from the whole-encounter hash alone; telling them apart needs to know *which specific resource(s)* each proposal actually targets.

That's what `affectedIds` is for. A write tool can optionally pass `affectedIds: string[]` (e.g. `[combatantId]`, or the list of target ids for a multi-target damage call) to `hitlManager.createProposal`. After a successful approval, `resolveProposal` calls `rebaseOtherPendingProposals(resolvedRecord)`, which walks every other still-`pending` proposal for the same campaign and rebases (recomputes and overwrites its stored `stateHash`) **only** the ones where both proposals declared `affectedIds` and those id sets don't intersect. If either side never declared `affectedIds`, or they share an id, the pending proposal is left untouched and keeps failing staleness the old way — the conservative default, since there's no way to prove the overlap is safe. `configure_encounter_combatants` declares `affectedIds: []` (not `null`) because it only ever creates brand-new combatants with freshly generated ids and never reads or writes an existing one, so it's provably safe to rebase everything else around it.

This all runs synchronously before `resolveProposal` returns, so — given Node's single-threaded event loop and `better-sqlite3`'s synchronous transactions — nothing else can mutate state in the gap between the handler finishing and the rebase running; "the hash right after this approval" is unambiguous. A rebased proposal is therefore only ever rejected as stale for a change that happens *after* that point.

### Writing a new stateful write tool
If a new write tool mutates encounter/combatant state, register a `getStateHash: (context) => computeEncounterStateHash(context.encounterId)` alongside its `stageProposal`/`executeMutation` (see any of the five built-in tools in `toolController.js` for the pattern), pass the same `computeEncounterStateHash(encounterId)` value as `stateHash` when calling `hitlManager.createProposal`, and — if the tool knows which specific combatant(s) it targets at staging time — also pass `affectedIds` so unrelated queued proposals aren't needlessly invalidated by this one's approval (see "Rebasing the rest of the queue" above). A tool whose state lives outside `encounter_units`/`running_state` should write its own hash function over whatever it actually depends on instead of reusing `computeEncounterStateHash`.

---

## 8b. Screen-Aware Context Profiles Do Not Affect HITL

The assistant filters the tools it shows the model per screen (see `docs/CONTEXT_AWARE_ASSISTANT.md`). This is strictly subtractive: the effective set is the profile's tools intersected with `ALLOWED_TOOL_NAMES`, `executeTool` rejects (before dispatch, with an audit-log entry) any tool the orchestrator did not offer, and `/api/assistant/confirm` ignores `screen` entirely. A new write tool must be assigned to a `TOOL_GROUPS` entry in `toolController.js`; unassigned tools are offered to the `general` profile only.

---

## 9. Proposal Queueing (Multiple Pending Proposals Per Campaign)

A single chat turn can invoke more than one write tool, and separate turns can each stage more proposals before the DM gets to any of them. Rather than only ever keeping the single most recent proposal alive (superseding older ones), every staged proposal for a campaign stays pending until it's individually approved, denied, or found stale. `hitlManager.listPendingProposals()` / `GET /api/assistant/proposals/pending?campaignId=` return the full queue, oldest first, and `AssistantOracleModal` shows the DM one at a time via `HitlConfirmationBox`, advancing to the next as each is resolved. A capped `maxPendingPerCampaign` (25) still bounds how many can accumulate if the DM falls behind an active agent.
