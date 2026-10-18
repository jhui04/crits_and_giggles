import { describe, it, expect } from 'vitest';
import {
  getConcentrationDC,
  needsConcentrationCheck,
  buildConcentrationDownAnnouncement,
  buildConcentrationSaveAnnouncement,
} from './concentrationCheck';

describe('getConcentrationDC', () => {
  it('floors at the DC 10 minimum for small damage', () => {
    expect(getConcentrationDC(1)).toBe(10);
  });
  it('still floors at 10 just under the next whole-number threshold', () => {
    expect(getConcentrationDC(19)).toBe(10);
  });
  it('is exactly 10 at damage 20', () => {
    expect(getConcentrationDC(20)).toBe(10);
  });
  it('floors down from a half-point at damage 21', () => {
    expect(getConcentrationDC(21)).toBe(10);
  });
  it('rises above the minimum for large damage', () => {
    expect(getConcentrationDC(50)).toBe(25);
  });
  it('is 10 at damage 0 (minimum applies even with no damage)', () => {
    expect(getConcentrationDC(0)).toBe(10);
  });
});

describe('needsConcentrationCheck', () => {
  it('requires a check when damage was actually taken', () => {
    expect(needsConcentrationCheck(1)).toBe(true);
  });
  it('requires a check for damage absorbed entirely by temp HP (still "taken")', () => {
    expect(needsConcentrationCheck(5)).toBe(true);
  });
  it('does not require a check for zero damage (e.g. immunity)', () => {
    expect(needsConcentrationCheck(0)).toBe(false);
  });
});

describe('buildConcentrationDownAnnouncement', () => {
  it('announces concentration ending (the base HP announcement already says "is down.")', () => {
    expect(buildConcentrationDownAnnouncement()).toBe('Concentration ends.');
  });
});

describe('buildConcentrationSaveAnnouncement', () => {
  it('announces a maintained save', () => {
    expect(buildConcentrationSaveAnnouncement('Goblin shaman', 14, 10, true)).toBe(
      'Concentration save: 14 against DC 10, maintained.'
    );
  });
  it('announces a failed save and the loss of concentration', () => {
    expect(buildConcentrationSaveAnnouncement('Goblin shaman', 7, 12, false)).toBe(
      'Concentration save: 7 against DC 12, failed. Goblin shaman is no longer concentrating.'
    );
  });
});
