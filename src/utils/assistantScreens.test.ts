import { describe, it, expect } from 'vitest';
import {
  ASSISTANT_SCREEN_IDS,
  getScreenInfo,
  GENERAL_SCREEN_INFO,
  formatContextLine,
  formatContextChangeNotice,
  isAssistantScreenId,
} from './assistantScreens';

describe('assistantScreens', () => {
  it('has copy for every screen id', () => {
    for (const id of ASSISTANT_SCREEN_IDS) {
      const info = getScreenInfo(id);
      expect(info.label).toBeTruthy();
      expect(info.focus).toBeTruthy();
      expect(info.welcome).toBeTruthy();
      expect(info.placeholder).toBeTruthy();
    }
  });

  it('falls back to the general copy for null, undefined, and unknown ids (including prototype keys)', () => {
    for (const bad of [null, undefined, '', 'nope', '__proto__', 'constructor', 'toString']) {
      expect(getScreenInfo(bad)).toBe(GENERAL_SCREEN_INFO);
      expect(isAssistantScreenId(bad)).toBe(false);
    }
  });

  it('formats the context line as plain text', () => {
    expect(formatContextLine('create.chapters')).toBe('Context: Create mode, chapters. Focus: story and encounter ideas.');
    expect(formatContextLine('run.combat')).toBe('Context: Run mode, combat. Focus: running the encounter.');
    expect(formatContextLine(null)).toBe('Context: General. Focus: rules, lore, and live state.');
  });

  it('formats the context-change notice', () => {
    expect(formatContextChangeNotice('run.combat')).toBe(
      'Context changed: now Run mode, combat. Answers and available actions are focused on running the encounter.'
    );
  });

  it('never puts markup in the labels', () => {
    for (const id of ASSISTANT_SCREEN_IDS) {
      expect(formatContextLine(id)).not.toMatch(/[<>]/);
    }
  });
});
