import { describe, it, expect } from 'vitest';
import { DiceService } from './DiceService';

describe('DiceService', () => {
  it('should parse and roll simple notation (e.g., 1d20)', () => {
    const result = DiceService.roll('1d20');
    expect(result.rolls.length).toBe(1);
    expect(result.rolls[0]).toBeGreaterThanOrEqual(1);
    expect(result.rolls[0]).toBeLessThanOrEqual(20);
    expect(result.modifier).toBe(0);
    expect(result.total).toBe(result.rolls[0]);
  });

  it('should handle multiple dice (e.g., 2d6)', () => {
    const result = DiceService.roll('2d6');
    expect(result.rolls.length).toBe(2);
    expect(result.total).toBe(result.rolls[0] + result.rolls[1]);
  });

  it('should handle positive modifiers (e.g., 1d8+3)', () => {
    const result = DiceService.roll('1d8+3');
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(result.rolls[0] + 3);
  });

  it('should handle negative modifiers (e.g., 1d4-1)', () => {
    const result = DiceService.roll('1d4-1');
    expect(result.modifier).toBe(-1);
    expect(result.total).toBe(result.rolls[0] - 1);
  });

  it('should handle spaces in notation', () => {
    const result = DiceService.roll(' 2 d 10 + 5 ');
    expect(result.rolls.length).toBe(2);
    expect(result.modifier).toBe(5);
  });

  it('should throw error for invalid notation', () => {
    expect(() => DiceService.roll('invalid')).toThrow('Invalid dice notation');
    expect(() => DiceService.roll('1d')).toThrow();
    expect(() => DiceService.roll('d20')).toThrow();
  });

  it('should roll within reasonable bounds over many attempts', () => {
    for (let i = 0; i < 100; i++) {
      const result = DiceService.roll('1d6');
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeLessThanOrEqual(6);
    }
  });

  it('rollSimple should return a correct total', () => {
    const total = DiceService.rollSimple(20, 5);
    expect(total).toBeGreaterThanOrEqual(6);
    expect(total).toBeLessThanOrEqual(25);
  });
});
