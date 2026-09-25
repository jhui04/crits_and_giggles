/**
 * Predefined Live-Data Evaluation Test Cases.
 * Each test case specifies:
 * - id: unique test case identifier
 * - query: user prompt given to the assistant
 * - campaignId / encounterId: contextual authoritative state
 * - expectedTool: the tool that the model MUST execute (deterministic assertion), or null for
 *   judge-only cases (e.g. ideation) where no particular tool is required
 * - screen: optional client screen id (see server/assistant/contextProfiles.js) the request is
 *   sent from; omitted = general profile (today's behavior)
 * - chapterId: optional active chapter id
 * - forbiddenTools: optional tools that MUST NOT be executed (e.g. hidden by the screen profile)
 * - expectedFact: the core truth that the judge model must verify in the final answer
 * - category: grouping (e.g. 'core', 'bonus-tool')
 */

export const BASE_EVAL_CASES = [
  {
    id: 'eval-1-map',
    query: 'Look at the tactical map for Palma Flora. Who is closest to Grog?',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    screen: 'run.combat',
    expectedTool: 'get_current_map',
    expectedFact: 'A Sahuagin Raider is closest to Grog.',
    category: 'core',
  },
  {
    id: 'eval-2-spell',
    query: 'What is the casting time for Fireball?',
    campaignId: 'test-campaign',
    expectedTool: 'lookup_spell',
    expectedFact: 'The casting time is 1 action.',
    category: 'core',
  },
];

export const BONUS_EVAL_CASES = [
  {
    id: 'eval-3-monster',
    query: 'Look up the stat block for an Adult Red Dragon. What is its Armor Class and Hit Points?',
    campaignId: 'test-campaign',
    expectedTool: 'lookup_monster',
    expectedFact: 'Armor Class is 19 and Hit Points are 256.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-4-monster-hp',
    query: 'What is the current hit points of the Sahuagin Raider in Palma Flora Shoreline Ambush?',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    expectedTool: 'get_monster_hp',
    acceptableTools: ['get_character_hp'],
    expectedFact: 'The Sahuagin Raider has 22 hit points.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-5-character-hp',
    query: 'How many hit points does Grog have left in Palma Flora Shoreline Ambush?',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    expectedTool: 'get_character_hp',
    expectedFact: 'Grog has 68 hit points.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-6-initiative',
    query: 'What is the initiative order for Palma Flora Shoreline Ambush?',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    expectedTool: 'get_initiative_order',
    expectedFact: 'Grog Strongjaw has initiative 14 and Sahuagin Raider has initiative 11.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-7-magic-item',
    query: 'Look up the magic item Bag of Holding. What is its rarity and weight capacity?',
    campaignId: 'test-campaign',
    expectedTool: 'lookup_magic_item',
    expectedFact: 'Bag of Holding is an Uncommon magic item and can hold up to 500 pounds.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-8-campaign-asset',
    query: 'Look up the campaign asset Wavechaser. What kind of asset is it and where is it located?',
    campaignId: 'test-campaign',
    expectedTool: 'get_campaign_asset',
    expectedFact: 'Wavechaser is a Ship located in Palma Flora.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-9-chapter-outline',
    query: 'What is the chapter outline or list of chapters for this campaign?',
    campaignId: 'test-campaign',
    expectedTool: 'get_chapter_outline',
    expectedFact: 'Chapter 1: The Shoreline Ambush.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-10-entity-position',
    query: 'What is the position of Grog on the tactical grid in Palma Flora Shoreline Ambush?',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    expectedTool: 'get_entity_position',
    acceptableTools: ['get_current_map'],
    expectedFact: 'Grog is at position (26, 17) or cell AA18.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-11-search-lore',
    query: 'Search campaign assets and lore for the ship named Wavechaser.',
    campaignId: 'test-campaign',
    expectedTool: 'search_assets_and_lore',
    acceptableTools: ['get_campaign_asset'],
    expectedFact: 'Wavechaser is a Ship located in Palma Flora, captained by Three Earrings.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-12-semantic',
    query: 'Perform a semantic search to find thematic monsters that lurk in coastal reefs or underwater ambushes.',
    campaignId: 'test-campaign',
    expectedTool: 'semantic_search',
    expectedFact: 'Sahuagin Raider is an aquatic creature suited for coastal and underwater ambushes.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-13-read-section',
    query: 'Read the section titled Arrival at the Docks from Chapter 1.',
    campaignId: 'test-campaign',
    expectedTool: 'read_chapter_section',
    expectedFact: 'The party arrives in Palma Flora just as sea raiders emerge from the tides along the docks.',
    category: 'bonus-tool',
  },
  {
    id: 'eval-14-place-at-water-edge',
    query: "Move the Sahuagin Raider to P1, right at the water's edge but still on the beach.",
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    screen: 'run.combat',
    expectedTool: 'find_positions',
    acceptableTools: ['move_combatant'],
    expectedFact: 'The answer picks a sand cell in P1 South Shore that touches water and stages (or proposes) moving the Sahuagin Raider there, awaiting DM approval.',
    category: 'map',
  },
  {
    id: 'eval-15-surroundings-and-cover',
    query: 'What terrain is around the Sahuagin Raider, and what can it use for cover?',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    screen: 'run.combat',
    expectedTool: 'describe_surroundings',
    expectedFact: 'The answer names the ground the Sahuagin Raider stands on and the nearest terrain changes or objects that give cover, using the tool result.',
    category: 'map',
  },
  {
    id: 'eval-16-areas-by-water',
    query: 'Which areas of the map are next to the water?',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    screen: 'run.combat',
    expectedTool: 'get_map_overview',
    expectedFact: 'The answer lists map areas (such as P1 South Shore) whose borders include water.',
    category: 'map',
  },
  {
    id: 'eval-17-hide-from-grog',
    query: 'Hide the Sahuagin Raider from Grog.',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    screen: 'run.combat',
    expectedTool: 'find_positions',
    acceptableTools: ['move_combatant'],
    expectedFact: 'The answer finds a cell with no line of sight from Grog and proposes moving the Sahuagin Raider there for DM approval.',
    category: 'map',
  },
  {
    id: 'eval-18-correct-map-terrain',
    query: 'The map data is wrong: cells M4 and M5 are mud, not sand. Please fix that.',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    screen: 'run.combat',
    expectedTool: 'propose_map_patch',
    expectedFact: 'The answer stages a map correction marking M4 and M5 as mud and says it awaits DM approval.',
    category: 'map',
  },
];

/** Combat tools that story/world/encounter-builder screens must never execute. */
export const LIVE_COMBAT_TOOLS = [
  'move_combatant',
  'apply_combat_damage',
  'remove_combatant',
  'update_combatant',
  'get_character_hp',
  'get_entity_position',
  'get_initiative_order',
  'get_current_map',
  'get_map_overview',
  'describe_surroundings',
  'find_positions',
  'propose_map_patch',
];

/** Screen-aware context profile cases (docs/CONTEXT_AWARE_ASSISTANT.md, section 6.3). */
export const CONTEXT_EVAL_CASES = [
  {
    id: 'ctx-1a-hp-from-combat',
    query: 'How much HP does the Sahuagin Raider have right now?',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    screen: 'run.combat',
    expectedTool: 'get_monster_hp',
    acceptableTools: ['get_character_hp'],
    expectedFact: 'The Sahuagin Raider has 22 hit points.',
    category: 'context',
  },
  {
    id: 'ctx-1b-hp-from-story',
    query: 'How much HP does the Sahuagin Raider have?',
    campaignId: 'test-campaign',
    screen: 'create.chapters',
    expectedTool: 'lookup_monster',
    forbiddenTools: ['get_monster_hp', 'get_character_hp'],
    expectedFact: 'The answer gives stat block hit points for the Sahuagin Raider and does not claim a live current HP.',
    category: 'context',
  },
  {
    id: 'ctx-2-ideate-twist',
    query: "Ideate a twist for this chapter's ambush.",
    campaignId: 'test-campaign',
    screen: 'create.chapters',
    expectedTool: null,
    forbiddenTools: LIVE_COMBAT_TOOLS,
    expectedFact: 'The answer offers story twist ideas for the ambush without changing any combat state.',
    category: 'context',
  },
  {
    id: 'ctx-3-move-from-story',
    query: 'Move Grog to C4.',
    campaignId: 'test-campaign',
    screen: 'create.chapters',
    expectedTool: null,
    forbiddenTools: ['move_combatant'],
    expectedFact: 'The answer tells the DM to open the Assistant from the Combat screen to move Grog.',
    category: 'context',
  },
  {
    id: 'ctx-4-move-from-combat',
    query: 'Move Grog to C4.',
    campaignId: 'test-campaign',
    encounterId: 'enc-palma-flora',
    screen: 'run.combat',
    expectedTool: 'move_combatant',
    expectedFact: 'A move for Grog to C4 is staged and awaiting DM approval.',
    category: 'context',
  },
  {
    id: 'ctx-5-design-encounter',
    query: 'Design a fair encounter for four level-3 PCs.',
    campaignId: 'test-campaign',
    screen: 'create.encounter_builder',
    expectedTool: null,
    forbiddenTools: ['move_combatant', 'apply_combat_damage', 'remove_combatant', 'update_combatant', 'configure_encounter_combatants'],
    expectedFact: 'The answer proposes an encounter composition suited to four level-3 characters.',
    category: 'context',
  },
];

export const ALL_EVAL_CASES = [...BASE_EVAL_CASES, ...BONUS_EVAL_CASES, ...CONTEXT_EVAL_CASES];
