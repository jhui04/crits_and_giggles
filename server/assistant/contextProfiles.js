/**
 * Screen-aware context profiles for the Assistant Oracle.
 * See docs/CONTEXT_AWARE_ASSISTANT.md.
 *
 * The client sends ONE untrusted string (`screen`). The server owns everything
 * else: the allow-list below maps it to a profile, and the profile decides the
 * prompt addendum, the game-state scope, and which tools the model is shown.
 *
 * Invariants (do not weaken):
 * - Profiles only SUBTRACT tools. The effective tool set is always
 *   `profile tools ∩ ALLOWED_TOOL_NAMES`; a profile cannot add a tool, register
 *   a handler, or reach executeMutation. The HITL stage -> confirm flow in
 *   toolController.js / hitlManager.js is untouched.
 * - The raw `screen` string is never interpolated into a prompt. Only the
 *   server-side constants in this file (labels, addenda) are.
 * - Unknown/missing/invalid screens fall back to `general` (today's behavior).
 */
import { ASSISTANT_TOOLS, ALLOWED_TOOL_NAMES, TOOL_GROUPS } from './toolController.js';

const MAX_SCREEN_LENGTH = 40;

export const SCREEN_TO_PROFILE = Object.freeze({
  'create.no_campaign': 'general',
  'create.chapters': 'create_story',
  'create.campaign_overview': 'create_story',
  'create.world': 'create_world',
  'create.encounter_builder': 'create_encounter',
  'run.story': 'run_story',
  'run.encounter_picker': 'run_combat',
  'run.combat': 'run_combat',
});

/** Server-side labels, used only in tool-rejection messages (never from client input). */
export const SCREEN_LABELS = Object.freeze({
  'create.no_campaign': 'Create > No campaign selected',
  'create.chapters': 'Create > Chapters',
  'create.campaign_overview': 'Create > Campaign overview',
  'create.world': 'Create > World',
  'create.encounter_builder': 'Create > Encounter Builder',
  'run.story': 'Run > Story',
  'run.encounter_picker': 'Run > Combat, choosing an encounter',
  'run.combat': 'Run > Combat',
});

const SCOPE_NO_COMBAT =
  'SCOPE: Live combat actions (HP changes, movement, the tactical map, initiative) are only available when the Assistant is opened from the Combat screen. If asked for one, say so in one sentence and tell the DM to open the Assistant (Alt+A) from the encounter tab. Do not guess combat state.';

/**
 * Profile registry. `groups` are keys of TOOL_GROUPS; `extraTools` are individual
 * tool names added on top. `general` has `toolNames: null` meaning "every tool
 * currently registered" (today's behavior, including future tools).
 */
const PROFILES = Object.freeze({
  general: Object.freeze({
    id: 'general',
    groups: null,
    extraTools: [],
    gameState: 'full',
    addendum: '',
  }),
  create_story: Object.freeze({
    id: 'create_story',
    groups: ['reference', 'campaign'],
    extraTools: [],
    gameState: 'story',
    addendum: `FOCUS: Story and encounter ideation while the DM is building the campaign. Help with plots, scenes, NPC voices, hooks, and encounter concepts with rough balance for this party, using the active chapter. Suggest ideas; do not try to change anything. Point out where a concept could become an encounter in the Encounter Builder.\n${SCOPE_NO_COMBAT}`,
  }),
  create_world: Object.freeze({
    id: 'create_world',
    groups: ['reference', 'campaign'],
    extraTools: [],
    gameState: 'story',
    addendum: `FOCUS: Worldbuilding. Help with factions, locations, NPCs, and the connections between them, staying consistent with existing world assets. Prefer search_assets_and_lore to check for conflicts before inventing something new.\n${SCOPE_NO_COMBAT}`,
  }),
  create_encounter: Object.freeze({
    id: 'create_encounter',
    groups: ['reference', 'campaign'],
    // No write tools here: the builder never supplies an encounter target, so a write tool would
    // fall back to an arbitrary saved encounter (resolveEncounterForWrite).
    extraTools: ['get_monster_hp'],
    gameState: 'encounter',
    addendum:
      'FOCUS: Encounter design. Help with composition, CR/XP budget versus the party (5e DMG method), terrain, and tactics. You cannot change any encounter from here; describe suggested rosters in text. Roster setup and live combat actions (damage, movement, removing units, the tactical map) are only available from the Combat screen; if asked, say so in one sentence.',
  }),
  run_story: Object.freeze({
    id: 'run_story',
    groups: ['reference', 'campaign'],
    extraTools: [],
    gameState: 'story',
    addendum: `FOCUS: Live table support during a session. Read-aloud text, improvisation, quick rulings, room descriptions, NPC reactions, and fast lookups. Keep answers short.\n${SCOPE_NO_COMBAT}`,
  }),
  run_combat: Object.freeze({
    id: 'run_combat',
    groups: ['reference', 'campaign', 'combat_read', 'combat_write', 'encounter_setup_write'],
    extraTools: [],
    gameState: 'full',
    addendum:
      'FOCUS: Running the fight. HP, conditions, initiative, positions, adjacency and cover, monster tactics, and map questions (always call get_current_map for those). Moves, damage, and roster changes are proposed for DM approval, never applied. Be terse: numbers first.',
  }),
});

export const PROFILE_IDS = Object.freeze(Object.keys(PROFILES));

const warnedClasses = new Set();
function warnOnce(kind) {
  if (warnedClasses.has(kind)) return;
  warnedClasses.add(kind);
  console.warn(`[ContextProfiles] Ignoring invalid screen value (${kind}); using the general profile.`);
}

/**
 * Allow-list validation of the untrusted client `screen` value. Exact match
 * only (no trim/lowercase leniency). Returns the screen id, or null.
 */
export function normalizeScreen(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') {
    warnOnce(`non-string ${Array.isArray(input) ? 'array' : typeof input}`);
    return null;
  }
  if (input.length > MAX_SCREEN_LENGTH) {
    warnOnce('too long');
    return null;
  }
  if (!Object.hasOwn(SCREEN_TO_PROFILE, input)) {
    warnOnce('unknown id');
    return null;
  }
  return input;
}

/**
 * Resolves a (possibly untrusted) screen value to a profile. Never throws.
 * The returned object carries the normalized `screen` (or null) and a
 * server-defined `screenLabel`.
 */
export function resolveProfile(screen) {
  const normalized = normalizeScreen(screen);
  const profile = PROFILES[normalized ? SCREEN_TO_PROFILE[normalized] : 'general'];
  return {
    ...profile,
    screen: normalized,
    screenLabel: normalized ? SCREEN_LABELS[normalized] : null,
  };
}

/**
 * Tool names the profile may offer: the profile's groups/extras intersected with
 * what is actually registered (ALLOWED_TOOL_NAMES). `general` = everything.
 */
export function getProfileToolNames(profile) {
  if (!profile || profile.groups === null || profile.groups === undefined) {
    return new Set(ALLOWED_TOOL_NAMES);
  }
  const names = new Set();
  for (const group of profile.groups) {
    for (const name of TOOL_GROUPS[group] || []) names.add(name);
  }
  for (const name of profile.extraTools || []) names.add(name);
  return new Set([...names].filter((n) => ALLOWED_TOOL_NAMES.has(n)));
}

/** Tool definitions (OpenAI format) the model should see for this profile. */
export function getToolsForProfile(profile, allTools = ASSISTANT_TOOLS) {
  const names = getProfileToolNames(profile);
  return allTools.filter((t) => names.has(t.function?.name));
}
