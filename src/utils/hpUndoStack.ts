/**
 * Pure undo-stack logic for manual DM HP changes (EncounterRunner's "Undo
 * last HP change" button / Alt+U). Kept as plain data operations (no React)
 * so the push/pop/description behavior can be unit tested directly.
 */

export interface HpUndoEntry {
  instanceId: string;
  unitName: string;
  /** currentHp/tempHp to restore on undo. */
  prevHp: number;
  prevTempHp: number;
  /** e.g. "3 fire damage to Goblin 2" -- used in both the button's accessible name and the announcement. */
  description: string;
}

export const HP_UNDO_STACK_CAP = 20;

/** Appends an entry, dropping the oldest once the stack exceeds `cap`. */
export function pushUndoEntry(stack: HpUndoEntry[], entry: HpUndoEntry, cap: number = HP_UNDO_STACK_CAP): HpUndoEntry[] {
  const next = [...stack, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export interface PopUndoResult {
  entry: HpUndoEntry | undefined;
  rest: HpUndoEntry[];
}

/** Removes and returns the most recently pushed entry, if any. */
export function popUndoEntry(stack: HpUndoEntry[]): PopUndoResult {
  if (stack.length === 0) return { entry: undefined, rest: stack };
  return { entry: stack[stack.length - 1], rest: stack.slice(0, -1) };
}

/**
 * Builds the "3 fire damage to Goblin 2" / "5 healing to Goblin 2" phrase
 * shared by the undo button's accessible name ("Undo: 3 fire damage to
 * Goblin 2") and the post-undo announcement ("Undid 3 fire damage to
 * Goblin 2. 7 of 7 HP.").
 */
export function buildUndoDescription(amount: number, actionType: 'damage' | 'healing', damageType: string | undefined, unitName: string): string {
  const typeWord = actionType === 'damage' && damageType ? ` ${damageType}` : '';
  const actionWord = actionType === 'damage' ? 'damage' : 'healing';
  return `${amount}${typeWord} ${actionWord} to ${unitName}`;
}

/** The undo button's accessible name, e.g. "Undo: 3 fire damage to Goblin 2". */
export function describeUndoAction(entry: HpUndoEntry): string {
  return `Undo: ${entry.description}`;
}

/** The screen-reader announcement after undoing, e.g. "Undid 3 fire damage to Goblin 2. 7 of 7 HP." */
export function buildUndoAnnouncement(entry: HpUndoEntry, restoredHp: number, maxHp: number): string {
  return `Undid ${entry.description}. ${restoredHp} of ${maxHp} HP.`;
}
