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
- **Rollback on Approval Error**: If an approved mutation fails during execution (e.g. SQLite constraint violation or stale combatant), the SQLite transaction rolls back completely, preserving encounter integrity. Returns HTTP 500 with error details.

---

## 7. HTTP API Reference

### `POST /api/assistant/chat`
- Emits prompt query. If the model invokes a write tool, the response contains:
  ```json
  {
    "answer": "I have staged the movement for Grog Strongjaw. Please confirm above.",
    "proposal": {
      "proposalId": "prop_1790043552_8a7f9b2c",
      "toolName": "move_combatant",
      "description": "Move Grog Strongjaw from L8 (Shoreline) to M9 (Shoreline)",
      "requiresConfirmation": true,
      "status": "pending",
      "createdAt": 1790043552000,
      "payloadType": "movement",
      "payload": { ... }
    }
  }
  ```

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
  - `404 Not Found`: Proposal missing or expired (TTL: 15 minutes).
  - `409 Conflict`: Proposal has already been resolved (replay attack defense).
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
