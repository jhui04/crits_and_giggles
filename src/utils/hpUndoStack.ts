/**
 * Pure undo-stack logic for manual DM HP changes (EncounterRunner's "Undo
 * last HP change" button / Alt+U). Kept as plain data operations (no React)
 * so the push/pop/description behavior can be unit tested directly.
 */

import type { ActiveCondition } from './conditions';

export interface HpUndoEntry {
  instanceId: string;
  unitName: string;
  /** currentHp/tempHp to restore on undo. */
  prevHp: number;
  prevTempHp: number;
  /**
   * currentHp/tempHp immediately after the change this entry represents.
   * Used only to detect staleness (see isUndoEntryStale) -- if the unit's
   * live HP/temp HP no longer match these, something else (an approved
   * assistant HITL mutation, an external running-state sync, etc.) touched
   * this unit in between, and blindly restoring prevHp/prevTempHp would
   * silently clobber that later change.
   */
  postHp: number;
  postTempHp: number;
  /**
   * Conditions immediately before/after the change, so undoing a manual
   * damage application that triggered a failed concentration check also
   * restores "Concentrating" (see src/utils/concentrationCheck.ts).
   * Undefined when the change didn't touch conditions.
   */
  prevConditions?: ActiveCondition[];
  postConditions?: ActiveCondition[];
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

/** Minimal shape this module needs to read a unit's live HP for staleness checks. */
export interface StaleUndoCheckUnit {
  currentHp?: number;
  tempHp?: number;
}

/**
 * True when the unit's live currentHp/tempHp no longer match what this entry
 * recorded immediately after its own change (postHp/postTempHp) -- meaning
 * some other path mutated this unit's HP in between. Restoring prevHp/
 * prevTempHp in that case would silently overwrite that later change, so the
 * caller should discard the entry instead of applying it.
 */
export function isUndoEntryStale(entry: HpUndoEntry, unit: StaleUndoCheckUnit): boolean {
  const currentHp = unit.currentHp ?? 0;
  const currentTempHp = unit.tempHp ?? 0;
  return currentHp !== entry.postHp || currentTempHp !== entry.postTempHp;
}

/** The screen-reader announcement when an undo entry is discarded as stale, e.g. "Can't undo: Goblin 2's hit points changed since then." */
export function buildStaleUndoAnnouncement(entry: HpUndoEntry): string {
  return `Can't undo: ${entry.unitName}'s hit points changed since then.`;
}
