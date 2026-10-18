/**
 * Multiattack parsing.
 *
 * A monster's "Multiattack" action has no dice of its own; its text refers to
 * the monster's other actions ("makes three attacks: one with its bite and two
 * with its claws"). This module turns that text plus the monster's real action
 * list into structured, rollable options. It is pure and never throws: text it
 * cannot understand degrades to status "unparsed" (or "partial"), and the
 * caller keeps showing the raw text.
 *
 * Design:
 *  1. Split into sentences. The first sentence is the main statement; later
 *     sentences are either alternatives ("Or ...", "Alternatively ...", "In
 *     bear form, ..."), sequence continuations ("It then makes ..."), or notes
 *     (replacement rules and other modifiers, kept verbatim in `notes`).
 *  2. Split a sentence into items at commas / "and" / "or" / ":" and parse each
 *     item into a slot (count + the thing it names).
 *  3. Slots become "combos" (an "or" between counted items starts a new combo),
 *     then each slot's named alternatives are expanded into options.
 *  4. Names are resolved to real actions with plural/possessive tolerant
 *     matching; "melee"/"ranged" resolve by the action's attack type text.
 */

export interface MultiattackActionLike {
  name: string;
  content?: string;
  is_attack?: boolean;
  attack_bonus?: number;
  damage?: { dice: string; type: string }[];
}

export interface MultiattackSegment {
  /** How many times this action is used/rolled. */
  count: number;
  /** Dice formula for the count when the text says e.g. "1d4 attacks" (count is then 1). */
  countDice?: string;
  /** Text as the stat block named it ("claws"), or a description. */
  phrase: string;
  /** Resolved real action name, or null when it matches no action. */
  actionName: string | null;
  /** attack: has to-hit/damage to roll. other: listed, not rolled. unresolved: could not be matched. */
  kind: 'attack' | 'other' | 'unresolved';
}

export interface MultiattackOption {
  /** Spoken name, e.g. "Claw x1, Spear x1". */
  label: string;
  /** Optional condition/form, e.g. "bear form". */
  condition?: string;
  segments: MultiattackSegment[];
}

export type MultiattackStatus = 'parsed' | 'partial' | 'unparsed';

export interface MultiattackParse {
  status: MultiattackStatus;
  options: MultiattackOption[];
  /** Modifier sentences/clauses that are not rolled (replacement rules etc.). */
  notes: string[];
  /** Phrases that did not resolve to a real action. */
  unresolved: string[];
}

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const COUNT_RE = '(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|an?|\\d+)';
const DET_RE = '(?:(?:its|his|her|their|the|a|an|one use of|each) )?';
const MAX_OPTIONS = 24;
const MAX_CATEGORY_ACTIONS = 8;

const NOTE_CUES = [
  /\breplace/, /\bin place of\b/, /\binstead of\b/, /can['’]t make both/, /\bonly one of which\b/,
  /\bif that attack\b/, /\bfor each of (?:these|those)\b/, /\bwhile flying\b/, /\bcan also\b/,
  /\bdifferent weapon\b/, /\beach of which\b/, /\bcannot\b/, /\bcan['’]t\b/, /\bmust\b/,
  /\bagainst the same target\b/, /\bdrawn\b/, /\bany combination\b.*\bcan\b/,
  /\battack like\b/, /\bif (?:both|either|the|that|any)\b.*\bhits?\b/,
];

function toCount(word: string | undefined): number {
  if (!word) return 1;
  const w = word.toLowerCase();
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return COUNT_WORDS[w] ?? 1;
}

/** Lowercase, straighten quotes, drop parentheticals and punctuation noise. */
function clean(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameKeys(s: string): Set<string> {
  const base = s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const keys = new Set<string>();
  if (!base) return keys;
  const words = base.split(' ');
  const last = words[words.length - 1];
  const variants = new Set<string>([last]);
  if (last.endsWith('ies')) variants.add(last.slice(0, -3) + 'y');
  if (last.endsWith('ves')) { variants.add(last.slice(0, -3) + 'f'); variants.add(last.slice(0, -3) + 'fe'); }
  if (last.endsWith('es')) variants.add(last.slice(0, -2));
  if (last.endsWith('s')) variants.add(last.slice(0, -1));
  if (last === 'hooves') variants.add('hoof');
  if (last === 'teeth') variants.add('tooth');
  if (last === 'feet') variants.add('foot');
  if (last === 'talons' || last === 'talon') variants.add('talon');
  for (const v of variants) keys.add([...words.slice(0, -1), v].join(' '));
  return keys;
}

function actionBaseName(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ').replace(/[.:]+\s*$/, '').replace(/\s+/g, ' ').trim();
}

function isRollable(a: MultiattackActionLike): boolean {
  return a.attack_bonus !== undefined || (Array.isArray(a.damage) && a.damage.length > 0);
}

function isMultiattackName(name: string): boolean {
  return /^multiattack/i.test(name.trim());
}

function attackType(a: MultiattackActionLike): string {
  const m = (a.content || '').match(/^([A-Za-z ]*?Attack)\b/i);
  return m ? m[1].toLowerCase() : '';
}

interface Ref {
  phrase: string;
  category?: 'melee' | 'ranged' | 'any';
}

interface Slot {
  verb: 'attack' | 'use';
  count: number;
  countExplicit: boolean;
  /** Names/categories this slot may be. Empty = generic ("two attacks"). */
  choices: Ref[];
  /** Counted-by-a-list head like "three attacks:" that a list follows. */
  head: boolean;
  /** Dice formula when the count is rolled ("1d4 attacks"). */
  countDice?: string;
  /** Free text with no resolvable meaning (e.g. "casts one spell"). */
  textOnly?: string;
}

interface Item {
  delim: 'or' | 'and' | ',' | ':' | 'start';
  slot: Slot | null;
  /** A bare name continuing the previous slot as an alternative. */
  bare?: Ref;
  note?: string;
  raw: string;
}

function makeRef(phrase: string): Ref {
  const p = phrase.replace(/\battacks?\b/g, '').replace(/\s+/g, ' ').trim();
  if (p === 'melee' || p === 'melee weapon') return { phrase: p, category: 'melee' };
  if (p === 'ranged' || p === 'ranged weapon') return { phrase: p, category: 'ranged' };
  if (p === 'weapon') return { phrase: p, category: 'any' };
  return { phrase: p };
}

function stripDet(s: string): string {
  return s.replace(new RegExp(`^${DET_RE}`), '').replace(/^(?:its|his|her|their|the) /, '').trim();
}

/** Parses one already-delimited item into a slot / bare name / note. */
function parseItem(rawItem: string, delim: Item['delim']): Item {
  const dm = rawItem.trim().match(/(?:^|\s)(\d+d\d+) /i);
  if (!dm) return parseItemInner(rawItem, delim);
  const item = parseItemInner(rawItem.trim().replace(dm[0], (dm[0].startsWith(' ') ? ' ' : '') + 'one '), delim);
  if (item.slot) item.slot.countDice = dm[1].toLowerCase();
  return item;
}

function parseItemInner(rawItem: string, delim: Item['delim']): Item {
  let t = rawItem.toLowerCase().trim().replace(/[.;]+$/, '').trim();
  const raw = rawItem.trim();
  if (!t) return { delim, slot: null, raw };

  if (NOTE_CUES.some(re => re.test(t))) return { delim, slot: null, note: raw, raw };

  t = t.replace(/\bin any combination\b/, '').replace(/\beither\b/, '').replace(/\s+/g, ' ').trim();
  // Strip subject up to the verb when the item starts with one ("the ogre makes ...").
  let verb: 'make' | 'use' | 'cast' | null = null;
  const vm = t.match(/(?:^|\b)(?:(?:it|he|she|they|then|also|can|and) )*(makes?|uses?|casts?)\b ?/);
  if (vm && vm.index !== undefined) {
    const before = t.slice(0, vm.index);
    // Only treat as verb if everything before is a subject (short, no count/with).
    if (!/\b(with|using|to hit)\b/.test(before) && before.split(' ').length <= 8 && !new RegExp(`\\b${COUNT_RE}\\b`).test(before.replace(/\bthe\b/g, ''))) {
      verb = vm[1].startsWith('make') ? 'make' : vm[1].startsWith('use') ? 'use' : 'cast';
      t = t.slice(vm.index + vm[0].length).trim();
    }
  }
  t = t.replace(/\s+/g, ' ').trim();

  if (verb === 'cast') {
    const spell = t.replace(new RegExp(`^${DET_RE}`), '');
    if (/^(?:one |a |an )?spells?\b/.test(t) || /^(?:one |a |an )?spell\b/.test(spell)) {
      return { delim, slot: { verb: 'use', count: toCount(t.match(new RegExp(`^${COUNT_RE}`))?.[1]), countExplicit: true, choices: [], head: false, textOnly: `cast ${t}` }, raw };
    }
    verb = 'use';
  }

  if (verb === 'use') {
    let count = 1;
    let explicit = false;
    const tm = t.match(/\s+(twice|once|thrice|(\w+) times)$/);
    if (tm) {
      count = tm[1] === 'twice' ? 2 : tm[1] === 'thrice' ? 3 : tm[1] === 'once' ? 1 : toCount(tm[2]);
      explicit = true;
      t = t.slice(0, tm.index).trim();
    }
    const name = stripDet(t);
    if (!name) return { delim, slot: null, raw };
    return { delim, slot: { verb: 'use', count, countExplicit: explicit, choices: [makeRef(name)], head: false }, raw };
  }

  // each one once / one of each / combination: handled by caller via raw text.
  let m: RegExpMatchArray | null;
  // "<count> <name> attack(s) [with its <name>]"
  if ((m = t.match(new RegExp(`^${COUNT_RE} (.+?) attacks?(?: (?:with|using) ${DET_RE}(.+))?$`)))) {
    const ref = m[3] ? makeRef(stripDet(m[3])) : makeRef(m[2]);
    if (m[3]) {
      // "melee attacks with its claws": the named weapon wins.
      return { delim, slot: { verb: 'attack', count: toCount(m[1]), countExplicit: true, choices: [ref], head: false }, raw };
    }
    // "three melee attacks: ..." may only be a total that a list follows.
    return { delim, slot: { verb: 'attack', count: toCount(m[1]), countExplicit: true, choices: [ref], head: !!ref.category }, raw };
  }
  // "<count> attack(s) [with its <name>]"
  if ((m = t.match(new RegExp(`^${COUNT_RE} attacks?(?: (?:with|using) ${DET_RE}(.+))?$`)))) {
    const choices = m[2] ? [makeRef(stripDet(m[2]))] : [];
    return { delim, slot: { verb: 'attack', count: toCount(m[1]), countExplicit: true, choices, head: choices.length === 0 }, raw };
  }
  // "<count> with its <name>"
  if ((m = t.match(new RegExp(`^${COUNT_RE} (?:attacks? )?(?:with|using) ${DET_RE}(.+)$`)))) {
    return { delim, slot: { verb: 'attack', count: toCount(m[1]), countExplicit: true, choices: [makeRef(stripDet(m[2]))], head: false }, raw };
  }
  // "one to constrict"
  if ((m = t.match(new RegExp(`^${COUNT_RE} to (\\w+)`)))) {
    return { delim, slot: { verb: 'attack', count: toCount(m[1]), countExplicit: true, choices: [makeRef(m[2])], head: false }, raw };
  }
  // "with its X" / "using X" without a count.
  if ((m = t.match(new RegExp(`^(?:with|using) ${DET_RE}(.+)$`)))) {
    return { delim, slot: null, bare: makeRef(stripDet(m[1])), raw };
  }
  // "two claw" (count + name, no "attack" word)
  if ((m = t.match(new RegExp(`^${COUNT_RE} (.+)$`)))) {
    return { delim, slot: { verb: 'attack', count: toCount(m[1]), countExplicit: true, choices: [makeRef(stripDet(m[2]))], head: false }, raw };
  }
  // Bare name ("its glaive", "nightmare ray attacks", "melee").
  const bare = stripDet(t).replace(/\battacks?$/, '').trim();
  if (bare && bare.split(' ').length <= 5) return { delim, slot: null, bare: makeRef(bare), raw };
  return { delim, slot: null, raw };
}

function tokenize(sentence: string): { text: string; delim: Item['delim'] }[] {
  sentence = sentence.replace(/\s*(?:--|—|–)\s*/g, ', ');
  const parts = sentence.split(/(,\s*or\s+|,\s*and\s+|\s+or\s+|\s+and\s+|,\s*|:\s*|;\s*|\s+then\s+)/i);
  const out: { text: string; delim: Item['delim'] }[] = [];
  let delim: Item['delim'] = 'start';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const d = parts[i].toLowerCase();
      delim = /\bor\b/.test(d) ? 'or' : /\band\b|then/.test(d) ? 'and' : d.startsWith(':') ? ':' : ',';
    } else if (parts[i].trim()) {
      out.push({ text: parts[i], delim });
    }
  }
  return out;
}

interface Combo {
  slots: Slot[];
  /** Delimiters joining slot i-1 to slot i (index 0 unused). */
  joins: Item['delim'][];
  mix: boolean;
  condition?: string;
}

interface SentenceResult {
  combos: Combo[];
  notes: string[];
}

function parseSentenceItems(sentence: string): SentenceResult {
  const notes: string[] = [];
  const mix = /\bin any combination\b|\bcombination thereof\b/i.test(sentence);
  const eachOnce = /\bor (?:one of each|each one once|each once)\b/i.test(sentence);
  let s = sentence
    .replace(/\bor (?:one of each|each one once|each once)\b/gi, '')
    .replace(/\bor a combination thereof\b/gi, '')
    .replace(/[.!]+$/, '');
  s = clean(s)
    .replace(/,?\s*\bif it can\b,?/gi, ' ')
    .replace(/,?\s*\bif available\b,?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop the subject ("The dragon", "Oracs the Enduring", "It then") up to the first verb.
  const vm0 = s.match(/\b(?:can (?:also )?)?(?:makes?|uses?|casts?)\b/i);
  if (vm0 && vm0.index !== undefined && vm0.index > 0 && s.slice(0, vm0.index).split(' ').length <= 10) {
    s = s.slice(vm0.index);
  }
  // Leading "In X form," / "If ..., " conditions are handled by the caller.

  const combos: Combo[] = [];
  let cur: Combo = { slots: [], joins: [], mix };
  const items = tokenize(s).map(tk => parseItem(tk.text, tk.delim));

  const pushCurrent = () => { if (cur.slots.length) combos.push(cur); };

  for (const it of items) {
    if (it.note) { notes.push(it.note); continue; }
    if (it.slot) {
      const startsNewCombo =
        it.delim === 'or' && cur.slots.length > 0 &&
        (it.slot.countExplicit || it.slot.verb === 'use' || it.slot.verb === 'attack');
      if (startsNewCombo) {
        // "a, b, or c": a comma-only list ending in "or" means every item is an alternative.
        const allCommas = cur.slots.length >= 2 && cur.joins.slice(1).every(j => j === ',');
        if (allCommas) {
          for (const sl of cur.slots) combos.push({ slots: [sl], joins: [',' ], mix });
          cur = { slots: [], joins: [], mix };
        } else {
          pushCurrent();
          cur = { slots: [], joins: [], mix };
        }
      }
      cur.joins.push(it.delim);
      cur.slots.push(it.slot);
      continue;
    }
    if (it.bare) {
      const prev = cur.slots[cur.slots.length - 1];
      if (prev && !prev.textOnly) {
        if (prev.head && prev.choices.length === 0) prev.head = false;
        prev.choices.push(it.bare);
      } else {
        cur.joins.push(it.delim);
        cur.slots.push({ verb: 'attack', count: 1, countExplicit: false, choices: [it.bare], head: false });
      }
      continue;
    }
    if (it.raw && !/^(?:the |it |he |she |they )?\w+$/i.test(it.raw)) notes.push(it.raw);
  }
  pushCurrent();

  // "A twice, B twice, or one of each" / "..., or a combination thereof": the comma
  // list before the trailing "or" is a list of ALTERNATIVES, not a sequence.
  const combThereof = /\bor a combination thereof\b/i.test(sentence);
  if ((eachOnce || combThereof) && combos.length > 0) {
    const first = combos[0];
    if (first.slots.length >= 2 && first.joins.slice(1).every(j => j === ',')) {
      if (combThereof && first.slots.every(sl => sl.count === first.slots[0].count && !sl.head)) {
        // One slot with several choices; `mix` expands the splits.
        combos[0] = { ...first, slots: [{ ...first.slots[0], choices: first.slots.flatMap(sl => sl.choices) }], joins: [','], mix: true };
      } else {
        combos.splice(0, 1, ...first.slots.map(sl => ({ slots: [sl], joins: [','] as Item['delim'][], mix })));
      }
    }
  }
  if (eachOnce && combos.length > 0) {
    const all = combos.flatMap(c => c.slots).filter(sl => !sl.head)
      .flatMap(sl => sl.choices.length > 1 ? sl.choices.map(ch => ({ ...sl, choices: [ch] })) : [sl]);
    combos.push({ slots: all.map(sl => ({ ...sl, count: 1 })), joins: all.map(() => 'and' as const), mix: false });
  }

  // A "three attacks:" head followed by counted items is only a total.
  for (const c of combos) {
    const hasCounted = c.slots.some(sl => !sl.head && sl.countExplicit && sl.choices.some(ch => !ch.category));
    if (hasCounted) {
      const keep: number[] = [];
      c.slots.forEach((sl, i) => { if (!(sl.head && sl.choices.every(ch => ch.category))) keep.push(i); });
      c.joins = keep.map(i => c.joins[i]);
      c.slots = keep.map(i => c.slots[i]);
    }
  }
  return { combos, notes };
}

interface Resolver {
  resolve(ref: Ref): MultiattackActionLike[];
  attackActions: MultiattackActionLike[];
}

function makeResolver(actions: MultiattackActionLike[], extra: MultiattackActionLike[]): Resolver {
  const pool = actions.filter(a => a && typeof a.name === 'string' && !isMultiattackName(a.name));
  const attackActions = pool.filter(isRollable);
  const extraPool = extra.filter(a => a && typeof a.name === 'string');
  const keyed = (list: MultiattackActionLike[]) => list.map(a => ({ a, keys: nameKeys(actionBaseName(a.name)), words: actionBaseName(a.name).toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean) }));
  const poolK = keyed(pool);
  const extraK = keyed(extraPool);

  const find = (phrase: string): MultiattackActionLike[] => {
    const pk = nameKeys(phrase);
    if (pk.size === 0) return [];
    const pWords = phrase.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
    const tiers: ((e: ReturnType<typeof keyed>[number]) => boolean)[] = [
      e => [...pk].some(k => e.keys.has(k)),
      e => pWords.length > 0 && pWords.every(w => e.words.some(x => nameKeys(x).has([...nameKeys(w)][0]) || [...nameKeys(w)].some(k => nameKeys(x).has(k)))),
      e => e.words.length > 0 && e.words.every(w => pWords.some(x => [...nameKeys(w)].some(k => nameKeys(x).has(k)))),
      // Stem prefix: "stinger" ~ "Sting", "claws" ~ "Claw".
      e => pWords.length > 0 && e.words.length > 0 && pWords[pWords.length - 1].length >= 4 && e.words[e.words.length - 1].length >= 4 &&
        (pWords[pWords.length - 1].startsWith(e.words[e.words.length - 1]) || e.words[e.words.length - 1].startsWith(pWords[pWords.length - 1])) &&
        pWords.slice(0, -1).join(' ') === e.words.slice(0, -1).join(' '),
    ];
    for (const list of [poolK, extraK]) {
      for (const tier of tiers) {
        const hits = list.filter(tier);
        if (hits.length > 0) {
          // Prefer a rollable action when several share a name (forms).
          const rollable = hits.filter(h => isRollable(h.a));
          return [(rollable[0] ?? hits[0]).a];
        }
      }
    }
    return [];
  };

  return {
    attackActions,
    resolve(ref: Ref) {
      if (ref.category) {
        const wanted = ref.category;
        if (wanted === 'any') {
          // "weapon attacks": only actual weapon attacks (not breath, gaze, spell-like actions).
          const weapons = attackActions.filter(a => /weapon/.test(attackType(a)));
          return weapons.length > 0 ? weapons : attackActions;
        }
        return attackActions.filter(a => {
          const t = attackType(a);
          return t.startsWith(wanted) || (wanted === 'ranged' && /^melee or ranged/.test(t)) || (wanted === 'melee' && /^melee or ranged/.test(t));
        });
      }
      return find(ref.phrase);
    },
  };
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function seg(count: number, phrase: string, action: MultiattackActionLike | null, countDice?: string): MultiattackSegment {
  const base = countDice ? { countDice } : {};
  if (!action) return { count, ...base, phrase, actionName: null, kind: 'unresolved' };
  return { count, ...base, phrase, actionName: actionBaseName(action.name), kind: isRollable(action) ? 'attack' : 'other' };
}

/** All ways to split `n` into `k` positive parts. */
function compositions(n: number, k: number): number[][] {
  if (k === 1) return [[n]];
  const out: number[][] = [];
  for (let first = 1; first <= n - (k - 1); first++) {
    for (const rest of compositions(n - first, k - 1)) out.push([first, ...rest]);
  }
  return out;
}

/** Expands one slot into its alternative segment lists. */
const genericUsed = { value: false };

function expandSlot(slot: Slot, mix: boolean, resolver: Resolver): MultiattackSegment[][] {
  if (slot.textOnly) {
    return [[{ count: slot.count, phrase: slot.textOnly, actionName: null, kind: 'other' }]];
  }
  let choices: { phrase: string; action: MultiattackActionLike | null }[] = [];
  if (slot.choices.length === 0) {
    // Generic "two attacks": only resolvable when the monster has exactly one attack action.
    if (resolver.attackActions.length >= 1 && resolver.attackActions.length <= 4) {
      // Which attacks is not stated: offer each of the monster's attacks.
      choices = resolver.attackActions.map(a => ({ phrase: 'attack', action: a }));
      if (resolver.attackActions.length > 1) genericUsed.value = true;
    } else {
      return [[{ count: slot.count, phrase: `${slot.count} attack${slot.count === 1 ? '' : 's'}`, actionName: null, kind: 'unresolved' }]];
    }
  } else {
    for (const ref of slot.choices) {
      const found = resolver.resolve(ref);
      if (found.length === 0) {
        choices.push({ phrase: ref.phrase, action: null });
      } else if (found.length > MAX_CATEGORY_ACTIONS) {
        choices.push({ phrase: ref.phrase, action: null });
      } else {
        for (const a of found) if (!choices.some(c => c.action === a)) choices.push({ phrase: ref.phrase, action: a });
      }
    }
  }
  const variants: MultiattackSegment[][] = choices.map(c => [seg(slot.count, c.phrase, c.action, slot.countDice)]);
  if (mix && choices.length >= 2 && slot.count >= 2 && choices.length <= 3 && slot.count <= 4) {
    // Mixed splits across exactly the first two choices (e.g. 2 attacks of A or B in any combination).
    for (const parts of compositions(slot.count, 2)) {
      variants.push([seg(parts[0], choices[0].phrase, choices[0].action), seg(parts[1], choices[1].phrase, choices[1].action)]);
    }
  }
  return variants;
}

function segmentLabel(s: MultiattackSegment): string {
  const name = s.actionName ?? s.phrase;
  const shown = s.actionName ? name : capitalizeFirst(name);
  const times = s.countDice ?? String(s.count);
  if (s.kind === 'other') return s.actionName ? `${shown}${s.count > 1 ? ` x${s.count}` : ''} (no roll)` : `${shown} (no roll)`;
  if (s.kind === 'unresolved') return `${shown} x${times} (unmatched)`;
  if (s.countDice) return `${s.countDice} ${shown}`;
  return `${shown} x${times}`;
}

export function optionLabel(segments: MultiattackSegment[]): string {
  return segments.map(segmentLabel).join(', ');
}

/** Spoken name of an option, with its condition/form first: "bear form: Claw x2". */
export function optionName(o: MultiattackOption): string {
  return o.condition ? `${o.condition}: ${o.label}` : o.label;
}

/** "A, B, C" -> "A, B and C" (the option label separates its segments with commas). */
function spokenList(label: string): string {
  const parts = label.split(', ');
  return parts.length < 2 ? label : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const SUMMARY_MAX_LENGTH = 110;

/**
 * Compact text for the Multiattack button's accessible name, e.g.
 * "Claw x2, or Bite x1 and Claw x2". Lists options while they fit, then
 * ", or N more options". Empty when there is nothing parsed to list.
 */
export function multiattackSummary(options: MultiattackOption[]): string {
  const names = options.map(o => spokenList(optionName(o)));
  let text = '';
  let shown = 0;
  for (const n of names) {
    const next = shown === 0 ? n : `${text}, or ${n}`;
    if (shown > 0 && next.length > SUMMARY_MAX_LENGTH) break;
    text = next;
    shown++;
  }
  const more = names.length - shown;
  if (more > 0) text += `, or ${more} more option${more === 1 ? '' : 's'}`;
  return text;
}

function mergeSegments(segs: MultiattackSegment[]): MultiattackSegment[] {
  // Merge adjacent same-action attacks ("Claw x1, Claw x1" -> "Claw x2").
  const out: MultiattackSegment[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && s.actionName && prev.actionName === s.actionName && prev.kind === s.kind && !prev.countDice && !s.countDice) {
      out[out.length - 1] = { ...prev, count: prev.count + s.count };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

function expandCombo(combo: Combo, resolver: Resolver): MultiattackSegment[][] {
  let acc: MultiattackSegment[][] = [[]];
  for (const slot of combo.slots) {
    const variants = expandSlot(slot, combo.mix, resolver);
    const next: MultiattackSegment[][] = [];
    for (const a of acc) for (const v of variants) {
      next.push([...a, ...v]);
      if (next.length >= MAX_OPTIONS * 2) break;
    }
    acc = next;
  }
  return acc;
}

/** Splits text into sentences without breaking on abbreviations like "5 ft.". */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).map(s => s.trim()).filter(Boolean);
}

/**
 * Parses a Multiattack action's text against the monster's actions.
 * `extraActions` (e.g. traits like Spellcasting) are used to resolve
 * non-attack segments only after the real actions.
 */
export function parseMultiattack(
  text: string,
  actions: MultiattackActionLike[],
  extraActions: MultiattackActionLike[] = [],
): MultiattackParse {
  const empty: MultiattackParse = { status: 'unparsed', options: [], notes: [], unresolved: [] };
  try {
    if (typeof text !== 'string' || !text.trim() || !Array.isArray(actions)) return empty;
    const resolver = makeResolver(actions, extraActions);
    genericUsed.value = false;
    const sentences = splitSentences(text.replace(/\s+/g, ' ').trim());
    const notes: string[] = [];
    const groups: { segs: MultiattackSegment[][]; condition?: string }[] = [];
    let primaryDone = false;

    for (let si = 0; si < sentences.length; si++) {
      let sentence = sentences[si];
      let condition: string | undefined;
      let alt = false;

      const formM = sentence.match(/^(?:in|while in|when in) (.+? form|.+? shape),\s*/i);
      if (formM) { condition = formM[1]; sentence = sentence.slice(formM[0].length); alt = si > 0; }
      const ifM = sentence.match(/^(?:if|while|when) ([^,]+),\s*(.*)$/i);
      if (ifM && !/\bcan\b|\balso\b|\bhits?\b/i.test(ifM[2]) && /\bmakes?\b|\buses?\b/i.test(ifM[2])) {
        condition = condition ?? `if ${ifM[1]}`;
        sentence = ifM[2];
      }
      const baM = sentence.match(/^(?:before|after)(?: or (?:before|after))?[^,]*,\s*/i);
      if (baM) { notes.push(baM[0].replace(/,\s*$/, '')); sentence = sentence.slice(baM[0].length); }
      const altM = sentence.match(/^(?:or|alternatively),?\s*/i);
      if (altM) { alt = true; sentence = sentence.slice(altM[0].length); }

      if (primaryDone && !alt && NOTE_CUES.some(re => re.test(sentence.toLowerCase()))) { notes.push(sentences[si]); continue; }
      if (/attack like/i.test(sentence)) { notes.push(sentences[si]); continue; }
      if (!/\b(makes?|uses?|casts?|attacks?)\b/i.test(sentence)) { notes.push(sentences[si]); continue; }

      const { combos, notes: itemNotes } = parseSentenceItems(sentence);
      notes.push(...itemNotes);
      const expanded: MultiattackSegment[][] = [];
      for (const c of combos) expanded.push(...expandCombo(c, resolver));
      if (expanded.length === 0) { if (!itemNotes.length) notes.push(sentences[si]); continue; }

      if (!primaryDone) {
        groups.push({ segs: expanded, condition });
        primaryDone = true;
      } else if (alt) {
        groups.push({ segs: expanded, condition });
      } else {
        // Sequence continuation ("It then makes three attacks"): prepend/append to the last group.
        const last = groups[groups.length - 1];
        const onlyOther = last.segs.every(v => v.every(s => s.kind === 'other'));
        const merged: MultiattackSegment[][] = [];
        const before = onlyOther ? last.segs : null;
        if (before) {
          for (const b of before) for (const e of expanded) merged.push([...b, ...e]);
        } else {
          for (const b of last.segs) for (const e of expanded) merged.push([...b, ...e]);
        }
        last.segs = merged;
      }
    }

    const options: MultiattackOption[] = [];
    const seen = new Set<string>();
    let truncated = false;
    for (const g of groups) {
      for (const raw of g.segs) {
        const segs = mergeSegments(raw);
        const label = optionLabel(segs);
        const key = `${g.condition ?? ''}|${label}`;
        if (seen.has(key) || segs.length === 0) continue;
        if (options.length >= MAX_OPTIONS) { truncated = true; continue; }
        seen.add(key);
        options.push({ label, condition: g.condition ? capitalizeFirst(g.condition) : undefined, segments: segs });
      }
    }
    if (genericUsed.value) notes.push('The text does not say which attacks; each of the monster attacks is offered.');
    if (truncated) notes.push('More combinations are possible than are listed; see the full text.');

    if (options.length === 0) return { ...empty, notes };
    const unresolved = [...new Set(options.flatMap(o => o.segments.filter(s => s.kind === 'unresolved').map(s => s.phrase)))];
    const anyRollable = options.some(o => o.segments.some(s => s.kind === 'attack'));
    const status: MultiattackStatus = !anyRollable ? 'unparsed' : unresolved.length > 0 || truncated || genericUsed.value ? 'partial' : 'parsed';
    if (status === 'unparsed') return { ...empty, notes, unresolved };
    return { status, options, notes, unresolved };
  } catch {
    return empty;
  }
}

/** True for an action that is a Multiattack (also "Multiattack (Humanoid Form Only)"). */
export function isMultiattackAction(a: { name: string }): boolean {
  return typeof a?.name === 'string' && isMultiattackName(a.name);
}
