import { describe, it, expect } from 'vitest';
import { buildHpChangeAnnouncement, formatTrackerHp, getHpStatusTransition, isBloodied } from './combatDamageAnnouncements';

describe('formatTrackerHp', () => {
  it('shows plain HP while healthy', () => {
    expect(formatTrackerHp(7, 7)).toBe('HP: 7/7');
    expect(formatTrackerHp(4, 7)).toBe('HP: 4/7');
  });
  it('flags bloodied at or below half', () => {
    expect(formatTrackerHp(3, 7)).toBe('HP: 3/7, bloodied');
    expect(formatTrackerHp(3, 6)).toBe('HP: 3/6, bloodied');
  });
  it('flags down at 0 instead of bloodied', () => {
    expect(formatTrackerHp(0, 7)).toBe('HP: 0/7, down');
  });
});

describe('isBloodied', () => {
  it('true exactly at half', () => {
    expect(isBloodied(3, 6)).toBe(true);
  });
  it('false just above half', () => {
    expect(isBloodied(4, 6)).toBe(false);
  });
  it('false at 0 (that is "down", not "bloodied")', () => {
    expect(isBloodied(0, 6)).toBe(false);
  });
});

describe('getHpStatusTransition', () => {
  it('detects crossing into bloodied', () => {
    expect(getHpStatusTransition(40, 25, 59)).toEqual({ crossedBloodied: true, wentDown: false });
  });
  it('does not re-announce bloodied if already bloodied', () => {
    expect(getHpStatusTransition(25, 20, 59)).toEqual({ crossedBloodied: false, wentDown: false });
  });
  it('detects going down, which takes priority over bloodied', () => {
    expect(getHpStatusTransition(5, 0, 59)).toEqual({ crossedBloodied: false, wentDown: true });
  });
  it('healing from down into a still-bloodied range reports the bloodied crossing', () => {
    // Was at 0 (down, which is not "bloodied"); healed to 10/59, which is <= half: now bloodied.
    expect(getHpStatusTransition(0, 10, 59)).toEqual({ crossedBloodied: true, wentDown: false });
  });

  it('healing from bloodied to above-half HP crosses out of bloodied without a new flag', () => {
    expect(getHpStatusTransition(20, 40, 59)).toEqual({ crossedBloodied: false, wentDown: false });
  });
});

describe('buildHpChangeAnnouncement', () => {
  it('announces resisted damage', () => {
    const msg = buildHpChangeAnnouncement({
      name: 'Goblin 2',
      actionType: 'damage',
      amount: 3,
      damageType: 'fire',
      isImmune: false,
      isResistant: true,
      isVulnerable: false,
      prevHp: 7,
      newHp: 4,
      maxHp: 7,
      newTempHp: 0,
    });
    expect(msg).toBe('Goblin 2 takes 3 fire damage, halved by resistance. 4 of 7 HP.');
  });

  it('announces immunity with no HP line', () => {
    const msg = buildHpChangeAnnouncement({
      name: 'Goblin 2',
      actionType: 'damage',
      amount: 5,
      damageType: 'poison',
      isImmune: true,
      isResistant: false,
      isVulnerable: false,
      prevHp: 7,
      newHp: 7,
      maxHp: 7,
      newTempHp: 0,
    });
    expect(msg).toBe('Goblin 2 is immune to poison. No damage.');
  });

  it('announces vulnerable damage plus a bloodied crossing', () => {
    const msg = buildHpChangeAnnouncement({
      name: 'Ogre',
      actionType: 'damage',
      amount: 12,
      damageType: 'cold',
      isImmune: false,
      isResistant: false,
      isVulnerable: true,
      prevHp: 59,
      newHp: 25,
      maxHp: 59,
      newTempHp: 0,
    });
    expect(msg).toBe('Ogre takes 12 cold damage, doubled by vulnerability. 25 of 59 HP. Ogre is bloodied.');
  });

  it('announces going down instead of bloodied', () => {
    const msg = buildHpChangeAnnouncement({
      name: 'Goblin 2',
      actionType: 'damage',
      amount: 7,
      damageType: undefined,
      isImmune: false,
      isResistant: false,
      isVulnerable: false,
      prevHp: 7,
      newHp: 0,
      maxHp: 7,
      newTempHp: 0,
    });
    expect(msg).toBe('Goblin 2 takes 7 damage. 0 of 7 HP. Goblin 2 is down.');
  });

  it('omits the damage type word for untyped damage', () => {
    const msg = buildHpChangeAnnouncement({
      name: 'Goblin 2',
      actionType: 'damage',
      amount: 2,
      damageType: undefined,
      isImmune: false,
      isResistant: false,
      isVulnerable: false,
      prevHp: 7,
      newHp: 5,
      maxHp: 7,
      newTempHp: 0,
    });
    expect(msg).toBe('Goblin 2 takes 2 damage. 5 of 7 HP.');
  });

  it('includes a temp HP note when temp HP remains', () => {
    const msg = buildHpChangeAnnouncement({
      name: 'Grog',
      actionType: 'damage',
      amount: 5,
      damageType: undefined,
      isImmune: false,
      isResistant: false,
      isVulnerable: false,
      prevHp: 20,
      newHp: 20,
      maxHp: 20,
      newTempHp: 5,
    });
    expect(msg).toBe('Grog takes 5 damage. 20 of 20 HP. 5 temporary hit points remain.');
  });

  it('announces healing', () => {
    const msg = buildHpChangeAnnouncement({
      name: 'Goblin 2',
      actionType: 'healing',
      amount: 4,
      damageType: undefined,
      isImmune: false,
      isResistant: false,
      isVulnerable: false,
      prevHp: 3,
      newHp: 7,
      maxHp: 7,
      newTempHp: 0,
    });
    expect(msg).toBe('Goblin 2 heals 4 HP. 7 of 7 HP.');
  });

  it('announces both resisted and vulnerable', () => {
    const msg = buildHpChangeAnnouncement({
      name: 'Ghost',
      actionType: 'damage',
      amount: 10,
      damageType: 'fire',
      isImmune: false,
      isResistant: true,
      isVulnerable: true,
      prevHp: 30,
      newHp: 20,
      maxHp: 36,
      newTempHp: 0,
    });
    expect(msg).toBe('Ghost takes 10 fire damage, resisted and vulnerable. 20 of 36 HP.');
  });
});
