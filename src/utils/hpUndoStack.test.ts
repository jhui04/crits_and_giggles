import { describe, it, expect } from 'vitest';
import {
  pushUndoEntry,
  popUndoEntry,
  buildUndoDescription,
  describeUndoAction,
  buildUndoAnnouncement,
  HP_UNDO_STACK_CAP,
  type HpUndoEntry,
} from './hpUndoStack';

function makeEntry(n: number): HpUndoEntry {
  return {
    instanceId: `unit-${n}`,
    unitName: `Goblin ${n}`,
    prevHp: 7,
    prevTempHp: 0,
    description: `${n} damage to Goblin ${n}`,
  };
}

describe('pushUndoEntry / popUndoEntry', () => {
  it('pushes and pops in LIFO order', () => {
    let stack: HpUndoEntry[] = [];
    stack = pushUndoEntry(stack, makeEntry(1));
    stack = pushUndoEntry(stack, makeEntry(2));

    const first = popUndoEntry(stack);
    expect(first.entry?.unitName).toBe('Goblin 2');
    expect(first.rest).toHaveLength(1);

    const second = popUndoEntry(first.rest);
    expect(second.entry?.unitName).toBe('Goblin 1');
    expect(second.rest).toHaveLength(0);
  });

  it('popping an empty stack returns undefined and the same empty stack', () => {
    const { entry, rest } = popUndoEntry([]);
    expect(entry).toBeUndefined();
    expect(rest).toEqual([]);
  });

  it('caps the stack, dropping the oldest entries first', () => {
    let stack: HpUndoEntry[] = [];
    for (let i = 0; i < HP_UNDO_STACK_CAP + 5; i++) {
      stack = pushUndoEntry(stack, makeEntry(i));
    }
    expect(stack).toHaveLength(HP_UNDO_STACK_CAP);
    // Oldest 5 (0..4) dropped; stack starts at 5.
    expect(stack[0].unitName).toBe('Goblin 5');
    // Most recent push is last.
    expect(stack[stack.length - 1].unitName).toBe(`Goblin ${HP_UNDO_STACK_CAP + 4}`);
  });

  it('respects a custom cap', () => {
    let stack: HpUndoEntry[] = [];
    for (let i = 0; i < 5; i++) {
      stack = pushUndoEntry(stack, makeEntry(i), 3);
    }
    expect(stack).toHaveLength(3);
    expect(stack.map((e) => e.unitName)).toEqual(['Goblin 2', 'Goblin 3', 'Goblin 4']);
  });
});

describe('buildUndoDescription', () => {
  it('includes the damage type for typed damage', () => {
    expect(buildUndoDescription(3, 'damage', 'fire', 'Goblin 2')).toBe('3 fire damage to Goblin 2');
  });

  it('omits the type for untyped damage', () => {
    expect(buildUndoDescription(3, 'damage', undefined, 'Goblin 2')).toBe('3 damage to Goblin 2');
  });

  it('never includes a type for healing', () => {
    expect(buildUndoDescription(5, 'healing', undefined, 'Goblin 2')).toBe('5 healing to Goblin 2');
  });
});

describe('describeUndoAction / buildUndoAnnouncement', () => {
  const entry: HpUndoEntry = {
    instanceId: 'unit-1',
    unitName: 'Goblin 2',
    prevHp: 7,
    prevTempHp: 0,
    description: '3 fire damage to Goblin 2',
  };

  it('builds the button accessible name', () => {
    expect(describeUndoAction(entry)).toBe('Undo: 3 fire damage to Goblin 2');
  });

  it('builds the post-undo announcement', () => {
    expect(buildUndoAnnouncement(entry, 7, 7)).toBe('Undid 3 fire damage to Goblin 2. 7 of 7 HP.');
  });
});
