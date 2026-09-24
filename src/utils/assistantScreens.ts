/**
 * Screen ids the Assistant Oracle understands, and the client-side copy shown for each.
 * The ids must match the allow-list in server/assistant/contextProfiles.js; the server owns
 * what each screen means (tools, prompt), the client only reports where the DM is and shows
 * a plain-text description of the resulting context.
 */
export const ASSISTANT_SCREEN_IDS = [
  'create.no_campaign',
  'create.chapters',
  'create.campaign_overview',
  'create.world',
  'create.encounter_builder',
  'run.story',
  'run.encounter_picker',
  'run.combat',
] as const;

export type AssistantScreenId = (typeof ASSISTANT_SCREEN_IDS)[number];

export interface AssistantScreenInfo {
  /** Where the DM is, e.g. "Create mode, chapters". */
  label: string;
  /** What the assistant is focused on here, e.g. "story and encounter ideas". */
  focus: string;
  welcome: string;
  placeholder: string;
}

const GENERIC_WELCOME =
  '**Greetings, Dungeon Master.** I am your Assistant Oracle, grounded in official **SRD 5.2.1** rules and your active campaign state. Ask any rules question or check live combat HP and initiative.';
const GENERIC_PLACEHOLDER = 'Ask rules, spells, monsters, or live state (Alt+A to focus, Enter to send)...';

const STORY_INFO = {
  focus: 'story and encounter ideas',
  welcome:
    '**Greetings, Dungeon Master.** I can help you plan your story here: plot hooks, scenes, NPCs, and encounter concepts for the active chapter, plus rules lookups. Live combat actions are available from the Combat screen.',
  placeholder: 'Ask for story ideas, NPCs, or encounter concepts (Alt+A to focus, Enter to send)...',
};

export const GENERAL_SCREEN_INFO: AssistantScreenInfo = {
  label: 'General',
  focus: 'rules, lore, and live state',
  welcome: GENERIC_WELCOME,
  placeholder: GENERIC_PLACEHOLDER,
};

const SCREEN_INFO: Record<AssistantScreenId, AssistantScreenInfo> = {
  'create.no_campaign': { ...GENERAL_SCREEN_INFO, label: 'Create mode, no campaign selected' },
  'create.chapters': { label: 'Create mode, chapters', ...STORY_INFO },
  'create.campaign_overview': { label: 'Create mode, campaign overview', ...STORY_INFO },
  'create.world': {
    label: 'Create mode, world',
    focus: 'worldbuilding',
    welcome:
      '**Greetings, Dungeon Master.** I can help you build your world: factions, locations, NPCs, and how they connect, checked against your existing world assets. Live combat actions are available from the Combat screen.',
    placeholder: 'Ask about factions, locations, or NPCs (Alt+A to focus, Enter to send)...',
  },
  'create.encounter_builder': {
    label: 'Create mode, encounter builder',
    focus: 'encounter design',
    welcome:
      '**Greetings, Dungeon Master.** I can help you design this encounter: composition, difficulty for your party, terrain, and tactics. I suggest rosters in text; setting up combatants and live combat actions are available from the Combat screen.',
    placeholder: 'Ask for encounter ideas or balance help (Alt+A to focus, Enter to send)...',
  },
  'run.story': {
    label: 'Run mode, story',
    focus: 'live table support',
    welcome:
      '**Greetings, Dungeon Master.** I can help you run the table: read-aloud text, improvised NPCs, quick rulings, and fast lookups. Live combat actions are available from the Combat screen.',
    placeholder: 'Ask for a ruling, description, or lookup (Alt+A to focus, Enter to send)...',
  },
  'run.encounter_picker': {
    label: 'Run mode, combat, choosing an encounter',
    focus: 'running the encounter',
    welcome:
      '**Greetings, Dungeon Master.** I am ready to help run combat: HP, initiative, positions, the tactical map, and proposed changes for your approval. Load an encounter to get started.',
    placeholder: 'Ask about combat, the map, or rules (Alt+A to focus, Enter to send)...',
  },
  'run.combat': {
    label: 'Run mode, combat',
    focus: 'running the encounter',
    welcome:
      '**Greetings, Dungeon Master.** I am ready to help run combat: HP, initiative, positions, the tactical map, and proposed changes for your approval.',
    placeholder: 'Ask about combat, the map, or rules (Alt+A to focus, Enter to send)...',
  },
};

export function isAssistantScreenId(value: unknown): value is AssistantScreenId {
  return typeof value === 'string' && Object.hasOwn(SCREEN_INFO, value);
}

/** Copy for a screen id; null/unknown ids get the general copy (matches the server fallback). */
export function getScreenInfo(id: string | null | undefined): AssistantScreenInfo {
  return isAssistantScreenId(id) ? SCREEN_INFO[id] : GENERAL_SCREEN_INFO;
}

/** The visible/accessible one-line context under the modal title. Plain text only. */
export function formatContextLine(id: string | null | undefined): string {
  const info = getScreenInfo(id);
  return `Context: ${info.label}. Focus: ${info.focus}.`;
}

/** Message appended to the conversation log when the screen differs from the previous open. */
export function formatContextChangeNotice(id: string | null | undefined): string {
  const info = getScreenInfo(id);
  return `Context changed: now ${info.label}. Answers and available actions are focused on ${info.focus}.`;
}
