import { db } from '../db.js';

/**
 * Accurate and conservative token estimator.
 * Matches word/punctuation/number tokens and enforces a conservative 3.0 chars/token lower bound
 * to guarantee safety for dense JSON game state, numbers, and D&D notation.
 */
export function estimateTokenCount(str) {
  if (!str || typeof str !== 'string') return 0;
  const tokenMatches = str.match(/[a-zA-Z]+|[0-9]+|[^\s\w]|\n/g);
  const tokenCount = tokenMatches ? tokenMatches.length : 0;
  const charBound = Math.ceil(str.length / 3.0);
  return Math.max(tokenCount, charBound);
}

/**
 * Fetches authoritative live game state from SQLite as a clean, read-only JSON object.
 */
export function getAuthoritativeGameState({ campaignId, encounterId } = {}) {
  let encounter = null;

  if (encounterId && campaignId) {
    encounter = db.prepare('SELECT id, name, running_state, campaign_id FROM encounters WHERE id = ? AND campaign_id = ?').get(encounterId, campaignId);
  } else if (encounterId) {
    encounter = db.prepare('SELECT id, name, running_state, campaign_id FROM encounters WHERE id = ?').get(encounterId);
  } else if (campaignId) {
    // Prefer encounter with active running_state
    encounter = db.prepare('SELECT id, name, running_state, campaign_id FROM encounters WHERE campaign_id = ? AND running_state IS NOT NULL ORDER BY id LIMIT 1').get(campaignId)
      || db.prepare('SELECT id, name, running_state, campaign_id FROM encounters WHERE campaign_id = ? ORDER BY id LIMIT 1').get(campaignId);
  } else {
    // If neither campaignId nor encounterId is passed, check if any running encounter exists
    encounter = db.prepare('SELECT id, name, running_state, campaign_id FROM encounters WHERE running_state IS NOT NULL ORDER BY id LIMIT 1').get();
  }

  if (!encounter) {
    return {
      activeEncounter: null,
      combatants: [],
      note: 'No active combat encounter loaded.',
    };
  }

  const effectiveCampaignId = campaignId || encounter.campaign_id;
  const runningState = encounter.running_state ? JSON.parse(encounter.running_state) : null;

  let combatants = [];
  if (runningState && runningState.combatants && runningState.combatants.length > 0) {
    combatants = runningState.combatants.map((c) => ({
      name: c.name,
      currentHp: c.currentHp,
      maxHp: c.maxHp,
      initiative: c.initiative,
      position: c.position || null,
      isPlayer: !!c.isPlayer,
      conditions: c.conditions || [],
    }));
  } else {
    // Read from encounter_units table
    const units = db.prepare(
      'SELECT instanceId, name, currentHp, maxHp, initiative, isPlayer, position_x, position_y FROM encounter_units WHERE encounter_id = ?'
    ).all(encounter.id);

    combatants = units.map((u) => ({
      name: u.name,
      currentHp: u.currentHp,
      maxHp: u.maxHp,
      initiative: u.initiative,
      position: u.position_x !== null && u.position_y !== null ? { x: u.position_x, y: u.position_y } : null,
      isPlayer: !!u.isPlayer,
    }));
  }

  return {
    activeEncounter: encounter.name,
    encounterId: encounter.id,
    isCombatStarted: runningState?.isCombatStarted ?? false,
    round: runningState?.round ?? 1,
    turnIndex: runningState?.turnIndex ?? 0,
    combatants,
  };
}

/**
 * Builds the complete prompt message array with minimal context retrieval and state injection.
 * Enforces strict 8K token budget.
 */
export function buildChatMessages({
  query,
  passages = [],
  gameState = null,
  maxContextTokens = 8192,
}) {
  let systemPrompt = `You are the Assistant Oracle for "Crits & Giggles", a high-performance, accessible assistant for Dungeon Masters.
Your top priority is SPEED OF INFORMATION. Be direct, clear, and concise.

STRICT OPERATIONAL RULES:
1. AUTHORITATIVE GAME STATE: The JSON below is the live, read-only, authoritative state of the current game. Never guess or hallucinate HP or positions.
2. NO STATE MUTATION: You have NO authority to modify HP, positions, or database records. If the DM asks to change anything, inform them it must be done via the app controls.
3. GROUNDING: Base answers on official SRD 5.2.1 rules and provided lore passages.`;

  if (gameState) {
    systemPrompt += `\n\n[AUTHORITATIVE CURRENT GAME STATE (READ-ONLY)]\n${JSON.stringify(gameState, null, 2)}`;
  }

  if (passages && passages.length > 0) {
    systemPrompt += `\n\n[RETRIEVED KNOWLEDGE PASSAGES]`;
    passages.forEach((p, idx) => {
      systemPrompt += `\nPassage ${idx + 1} (${p.title}):\n${p.content}\n`;
    });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: query },
  ];

  // Token count verification and safe step-down pruning
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);
  if (totalTokens > maxContextTokens) {
    console.warn(`Context tokens (${totalTokens}) exceed ${maxContextTokens}. Pruning context...`);
    if (passages && passages.length > 1) {
      return buildChatMessages({ query, passages: passages.slice(0, passages.length - 1), gameState, maxContextTokens });
    } else if (passages && passages.length === 1) {
      return buildChatMessages({ query, passages: [], gameState, maxContextTokens });
    } else {
      // Passages already empty: compact game state and prevent any recursion
      const compactState = gameState ? {
        activeEncounter: gameState.activeEncounter,
        combatants: (gameState.combatants || []).slice(0, 5).map((c) => ({ name: c.name, hp: `${c.currentHp}/${c.maxHp}` })),
      } : null;
      let compactSystem = `You are the Assistant Oracle for "Crits & Giggles". Speed of information is top priority.\nRules: Base answers on SRD 5.2.1. Read-only authoritative state:`;
      if (compactState) {
        compactSystem += `\n[GAME STATE]\n${JSON.stringify(compactState)}`;
      }
      return {
        messages: [
          { role: 'system', content: compactSystem },
          { role: 'user', content: query.slice(0, 1000) },
        ],
        estimatedTokens: estimateTokenCount(compactSystem) + estimateTokenCount(query.slice(0, 1000)),
      };
    }
  }

  return {
    messages,
    estimatedTokens: totalTokens,
  };
}
