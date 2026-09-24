import { db } from '../db.js';
import { hitlManager } from './hitlManager.js';
import { getProfileToolNames } from './contextProfiles.js';
import { WRITE_TOOL_NAMES } from './toolController.js';

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
export function getAuthoritativeGameState({
  campaignId,
  encounterId,
  chapterId,
  chapterName,
  worldId,
  worldName,
  includeEncounter = true,
} = {}) {
  let encounter = null;

  // Story/world screens have no use for combat state (and it nudges small models toward combat
  // behavior), so a profile can opt out of the encounter lookup entirely.
  if (!includeEncounter) {
    encounter = null;
  } else if (encounterId && campaignId) {
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

  const effectiveCampaignId = campaignId || encounter?.campaign_id;

  // Retrieve Campaign details
  let campaign = null;
  if (effectiveCampaignId) {
    try {
      campaign = db.prepare('SELECT id, name, description, world_id FROM campaigns WHERE id = ?').get(effectiveCampaignId);
    } catch {}
  }

  // Retrieve Active Chapter details
  let chapter = null;
  if (chapterId) {
    try {
      chapter = effectiveCampaignId
        ? db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE id = ? AND campaign_id = ?').get(chapterId, effectiveCampaignId)
        : db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE id = ?').get(chapterId);
    } catch {}
  }
  if (!chapter && effectiveCampaignId) {
    try {
      if (chapterName) {
        chapter = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE campaign_id = ? AND LOWER(title) = ?').get(effectiveCampaignId, chapterName.toLowerCase());
      }
      if (!chapter) {
        chapter = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE campaign_id = ? ORDER BY order_index LIMIT 1').get(effectiveCampaignId);
      }
    } catch {}
  }

  // Retrieve Active World details
  const effectiveWorldId = worldId || campaign?.world_id;
  let world = null;
  let worldAssetSummary = [];
  if (effectiveWorldId) {
    try {
      world = db.prepare('SELECT id, name, description FROM worlds WHERE id = ?').get(effectiveWorldId);
      const was = db.prepare('SELECT id, type, name FROM world_assets WHERE world_id = ? LIMIT 10').all(effectiveWorldId);
      worldAssetSummary = was.map((w) => ({ id: w.id, type: w.type, name: w.name }));
    } catch {}
  }

  // Retrieve Campaign Assets summary
  let campaignAssetSummary = [];
  if (effectiveCampaignId) {
    try {
      const cas = db.prepare('SELECT id, type, name FROM assets WHERE campaign_id = ? LIMIT 10').all(effectiveCampaignId);
      campaignAssetSummary = cas.map((a) => ({ id: a.id, type: a.type, name: a.name }));
    } catch {}
  }

  let combatants = [];
  let isCombatStarted = false;
  let round = 1;
  let turnIndex = 0;

  if (encounter) {
    const runningState = encounter.running_state ? JSON.parse(encounter.running_state) : null;
    isCombatStarted = runningState?.isCombatStarted ?? false;
    round = runningState?.round ?? 1;
    turnIndex = runningState?.turnIndex ?? 0;

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
        'SELECT instanceId, name, currentHp, maxHp, initiative, isPlayer, position_x, position_y FROM encounter_units WHERE encounter_id = ? AND campaign_id = ?'
      ).all(encounter.id, encounter.campaign_id);

      combatants = units.map((u) => ({
        name: u.name,
        currentHp: u.currentHp,
        maxHp: u.maxHp,
        initiative: u.initiative,
        position: u.position_x !== null && u.position_y !== null ? { x: u.position_x, y: u.position_y } : null,
        isPlayer: !!u.isPlayer,
      }));
    }
  }

  const encounterFields = includeEncounter
    ? {
        activeEncounter: encounter ? encounter.name : null,
        encounterId: encounter ? encounter.id : null,
        isCombatStarted,
        round,
        turnIndex,
        combatants,
        note: !encounter ? 'No active combat encounter loaded.' : undefined,
      }
    : {};

  return {
    campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
    activeChapter: (chapter || chapterId || chapterName) ? {
      id: chapter?.id || chapterId || 'unknown',
      title: chapter?.title || chapterName || 'Current Chapter',
      contentPreview: chapter?.content ? (chapter.content.length > 2000 ? chapter.content.slice(0, 2000) + '...' : chapter.content) : null,
    } : null,
    world: (world || worldName) ? {
      id: effectiveWorldId || null,
      name: world?.name || worldName || 'Active World',
      sampleAssets: worldAssetSummary,
    } : null,
    campaignAssets: campaignAssetSummary.length > 0 ? campaignAssetSummary : undefined,
    ...encounterFields,
  };
}

/** Estimated token cost of a tool-schema list (the tools ride along on every model call). */
export function estimateToolTokens(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return 0;
  return estimateTokenCount(JSON.stringify(tools));
}

const PROMPT_INTRO = `You are the Assistant Oracle for "Crits & Giggles", a high-performance, accessible assistant for Dungeon Masters.
Your top priority is SPEED OF INFORMATION. Be direct, clear, and concise.

STRICT OPERATIONAL RULES:`;

const RULE_GAME_STATE =
  'AUTHORITATIVE GAME STATE: The JSON below is a high-level overview. Never guess or hallucinate stats or positions. For tactical map inspection, distances, spell details, or monster stats, you must use the appropriate tools.';

const RULE_PROPOSE_ALL_WRITES =
  "PROPOSE, NEVER EXECUTE: You have five write tools — move_combatant, apply_combat_damage, configure_encounter_combatants, remove_combatant, and update_combatant. Calling one of them NEVER directly changes HP, positions, rosters, or database records: it only stages a Human-in-the-Loop confirmation proposal that is shown to the DM, who must explicitly approve it before anything is applied. When the DM asks you to move a combatant, apply damage/healing, set up an encounter's roster, delete a single combatant, or rename/reassign a single combatant's faction, call the matching write tool to propose it, then tell the DM the proposal is staged and awaiting their approval. Never claim an action has already happened just because you staged the proposal — it has not, until the DM approves it. If a single request genuinely needs more than one write action (e.g. \"move the goblin to C4 and have it hit Grog for 6\"), you may call multiple write tools in the same turn — each is queued as its own proposal and the DM reviews them one at a time, in order. Be aware that approving an earlier proposal changes the encounter, which can invalidate a later one staged against the old state (it will be rejected as stale rather than silently misapplied); do not stage a long chain of dependent actions when a shorter one will do.";

const RULE_GROUNDING = 'GROUNDING: Base answers on official SRD 5.2.1 rules and provided lore passages.';

const RULE_FAILSAFE =
  'FAILSAFE: If you cannot answer a question based on the available context or tools, you MUST reply with a textual explanation of what information is missing. NEVER return an empty response.';

const BULLET_NO_RETRY =
  '   - NEVER get stuck in retry loops. If an exact lookup yields no matches or suggests semantic search, use semantic_search or answer with the closest verified match. Do not hallucinate stats or abilities.';

/**
 * Tool-selection bullets in their canonical order. A bullet is included when the
 * profile offers at least one of its `any` tools (and none of its `unless` tools).
 * `profileOnly` bullets are skipped for the historical general prompt.
 */
const TOOL_BULLETS = [
  { any: ['lookup_spell', 'lookup_monster', 'lookup_magic_item'], text: '   - For EXACT NAMES of spells, monsters, or magic items: use lookup_spell, lookup_monster, or lookup_magic_item.' },
  { any: ['get_character_hp', 'get_entity_position', 'get_initiative_order'], text: '   - For LIVE COMBATANT state (HP, conditions, positions): use get_character_hp, get_entity_position, or get_initiative_order.' },
  { any: ['get_monster_hp'], unless: ['get_character_hp'], profileOnly: true, text: '   - For the LIVE HP of a monster in an encounter: use get_monster_hp.' },
  { any: ['search_assets_and_lore'], text: '   - For EXACT KEYWORD or typo searches across campaign notes and assets: use search_assets_and_lore.' },
  { any: ['semantic_search'], text: '   - For CONCEPTUAL, BIOME, THEMATIC, or DESCRIPTIVE queries (e.g. "desert monster that burrows into sand", "spells to slow down enemies", "stealthy ambush tactics"): use the semantic_search tool.' },
  { any: ['get_chapter_outline'], text: '   - For CHAPTER STRUCTURE and section outline: use get_chapter_outline.' },
  { any: ['read_chapter_section'], text: '   - For READING SPECIFIC SECTIONS of a chapter: use read_chapter_section.' },
  { any: ['get_current_map'], text: '   - For SPATIAL, TACTICAL, or MAP queries (e.g., "where are the tokens", "look at the map", "look at the tactical map", "show me the map", "tactical map", "closest", "who is closest"): use the get_current_map tool. CRITICAL: Whenever the user query mentions "tactical map" or asks to look at the map, you MUST call get_current_map before answering. Do not answer a tactical map query without calling get_current_map.' },
  { any: ['move_combatant'], text: '   - To MOVE a combatant on the battlemap (e.g. "move Grog to C4", "have the goblin retreat"): use move_combatant.' },
  { any: ['apply_combat_damage'], text: '   - To APPLY DAMAGE, HEALING, or TEMPORARY HP to one or more combatants (e.g. "the fireball deals 22 fire damage to the goblins", "heal Grog for 10"): use apply_combat_damage.' },
  { any: ['configure_encounter_combatants'], text: '   - To SET UP or ADD TO an encounter\'s roster and starting positions from narrative text or an explicit list (e.g. "set up the ambush described in this room", "add 3 goblins at B3 and B4"): use configure_encounter_combatants.' },
  { any: ['remove_combatant'], text: '   - To DELETE a single combatant from the encounter entirely (e.g. "remove the dead goblin", "take Grog\'s hireling off the map"): use remove_combatant. Do not use this to set HP to 0 — that is apply_combat_damage; remove_combatant takes the unit off the map and out of initiative completely.' },
  { any: ['update_combatant'], text: '   - To RENAME a combatant or CHANGE ITS FACTION/ALLEGIANCE without moving it or changing its HP (e.g. "rename Goblin 3 to Bandit Scout", "the charmed guard is now fighting for the party"): use update_combatant.' },
];

const WRITE_TOOL_ORDER = ['move_combatant', 'apply_combat_damage', 'configure_encounter_combatants', 'remove_combatant', 'update_combatant'];

/** PROPOSE-NEVER-EXECUTE rule for a profile that offers only a subset of the write tools. */
function buildProposeRule(writeNames) {
  const one = writeNames.length === 1;
  return `PROPOSE, NEVER EXECUTE: Your only write tool${one ? ' is' : 's are'} ${writeNames.join(', ')}. Calling ${one ? 'it' : 'one of them'} NEVER directly changes HP, positions, rosters, or database records: it only stages a Human-in-the-Loop confirmation proposal that is shown to the DM, who must explicitly approve it before anything is applied. Call ${one ? 'it' : 'one'} only when the DM asks for that action, then tell the DM the proposal is staged and awaiting their approval. Never claim an action has already happened just because you staged the proposal — it has not, until the DM approves it.`;
}

/**
 * Composes the operating rules. With no profile (or `general`) this is the
 * historical prompt, verbatim. Other profiles get only the rules and tool
 * bullets for the tools they actually offer, plus their addendum.
 */
function buildRulesPrompt(profile) {
  const isGeneral = !profile || profile.id === 'general';
  let rules;
  if (isGeneral) {
    const bullets = TOOL_BULLETS.filter((b) => !b.profileOnly).map((b) => b.text);
    rules = [RULE_GAME_STATE, RULE_PROPOSE_ALL_WRITES, RULE_GROUNDING, `TOOL SELECTION STRATEGY:\n${[...bullets, BULLET_NO_RETRY].join('\n')}`, RULE_FAILSAFE];
  } else {
    const names = getProfileToolNames(profile);
    const writeNames = WRITE_TOOL_ORDER.filter((n) => names.has(n) && WRITE_TOOL_NAMES.has(n));
    const bullets = TOOL_BULLETS.filter((b) => b.any.some((n) => names.has(n)) && !(b.unless || []).some((n) => names.has(n))).map((b) => b.text);
    rules = [RULE_GAME_STATE];
    if (writeNames.length === WRITE_TOOL_ORDER.length) rules.push(RULE_PROPOSE_ALL_WRITES);
    else if (writeNames.length > 0) rules.push(buildProposeRule(writeNames));
    rules.push(RULE_GROUNDING, `TOOL SELECTION STRATEGY:\n${[...bullets, BULLET_NO_RETRY].join('\n')}`, RULE_FAILSAFE);
  }
  let prompt = `${PROMPT_INTRO}\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  if (!isGeneral && profile.addendum) {
    prompt += `\n\n[SCREEN CONTEXT: ${profile.id}]\n${profile.addendum}`;
  }
  return prompt;
}

/**
 * Builds the complete prompt message array with minimal context retrieval and state injection.
 * Enforces strict 8K token budget on the message text (pruning behavior is unchanged from before
 * profiles existed). `toolTokens`, the estimated cost of the tool schemas sent alongside, is NOT
 * charged against that budget but is included in the reported `estimatedTokens`.
 */
export function buildChatMessages({
  query,
  passages = [],
  gameState = null,
  maxContextTokens = 8192,
  campaignId = null,
  profile = null,
  toolTokens = 0,
}) {
  const isGeneral = !profile || profile.id === 'general';
  let systemPrompt = buildRulesPrompt(profile);

  if (gameState) {
    // The historical general prompt pretty-prints the state; profiles use compact JSON to save tokens.
    const stateJson = isGeneral ? JSON.stringify(gameState, null, 2) : JSON.stringify(gameState);
    systemPrompt += `\n\n[AUTHORITATIVE CURRENT GAME STATE (READ-ONLY)]\n${stateJson}`;
    if (gameState.activeChapter) {
      systemPrompt += `\n\n[ACTIVE CHAPTER FOCUS]\nActive Chapter ID: "${gameState.activeChapter.id}", Title: "${gameState.activeChapter.title}".`;
      if (gameState.activeChapter.contentPreview) {
        systemPrompt += `\nChapter Notes Preview: ${gameState.activeChapter.contentPreview}`;
      }
    }
    if (gameState.world) {
      systemPrompt += `\n\n[ACTIVE WORLD CONTEXT]\nActive World: "${gameState.world.name}" (ID: ${gameState.world.id}).`;
    }
  }

  // Tell the model what the DM already decided on recent write-tool
  // proposals, most recent first, so a denied action isn't silently
  // re-proposed and an approved one is acknowledged instead of repeated.
  // This reads the server-side HITL audit log rather than requiring any
  // conversation-history/session subsystem (see G-16).
  const effectiveCampaignId = campaignId || gameState?.campaign?.id || null;
  const recentDecisions = effectiveCampaignId ? hitlManager.getRecentDecisions(effectiveCampaignId) : [];
  if (recentDecisions.length > 0) {
    systemPrompt += `\n\n[RECENT DM DECISIONS] (most recent first, within the last hour — do not re-propose a denied action unless the DM asks again)`;
    recentDecisions.forEach((d) => {
      const verdict = d.event === 'proposal_approved' ? 'APPROVED' : 'DENIED';
      const minutesAgo = Math.max(0, Math.round((Date.now() - new Date(d.timestamp).getTime()) / 60000));
      const ageLabel = minutesAgo <= 1 ? 'just now' : `${minutesAgo} min ago`;
      systemPrompt += `\n- ${verdict} (${ageLabel}): ${d.description}`;
    });
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
      return buildChatMessages({ query, passages: passages.slice(0, passages.length - 1), gameState, maxContextTokens, campaignId, profile, toolTokens });
    } else if (passages && passages.length === 1) {
      return buildChatMessages({ query, passages: [], gameState, maxContextTokens, campaignId, profile, toolTokens });
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
      // The pruned fallback must never drop the HITL rule while write tools are offered.
      const offeredWrites = isGeneral
        ? WRITE_TOOL_ORDER.filter((n) => WRITE_TOOL_NAMES.has(n))
        : WRITE_TOOL_ORDER.filter((n) => getProfileToolNames(profile).has(n) && WRITE_TOOL_NAMES.has(n));
      if (offeredWrites.length > 0) {
        compactSystem += `
PROPOSE, NEVER EXECUTE: the write tools (${offeredWrites.join(', ')}) only stage a Human-in-the-Loop proposal that the DM must approve; nothing changes until they do. Never claim an action happened before approval.`;
      }
      // Keep the screen focus/scope even in the pruned fallback.
      if (!isGeneral && profile.addendum) {
        compactSystem += `\n[SCREEN CONTEXT: ${profile.id}]\n${profile.addendum}`;
      }
      return {
        messages: [
          { role: 'system', content: compactSystem },
          { role: 'user', content: query.slice(0, 1000) },
        ],
        estimatedTokens: estimateTokenCount(compactSystem) + estimateTokenCount(query.slice(0, 1000)) + toolTokens,
      };
    }
  }

  return {
    messages,
    estimatedTokens: totalTokens + toolTokens,
  };
}
