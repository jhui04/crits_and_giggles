import { describe, it, expect } from 'vitest';
import { getPlainText } from './markdownUtils';

describe('getPlainText', () => {
  it('preserves the number 0 instead of treating it as falsy', () => {
    expect(getPlainText(0)).toBe('0');
  });

  it('preserves 0 within an array of children', () => {
    expect(getPlainText(['Room ', 0])).toBe('Room 0');
  });

  it('returns empty string for null, undefined, and booleans', () => {
    expect(getPlainText(null)).toBe('');
    expect(getPlainText(undefined)).toBe('');
    expect(getPlainText(true)).toBe('');
    expect(getPlainText(false)).toBe('');
  });

  it('joins plain strings and numbers in an array', () => {
    expect(getPlainText(['Hello ', 'world', '!'])).toBe('Hello world!');
  });
});
