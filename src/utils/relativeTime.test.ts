import { describe, it, expect } from 'vitest';
import { formatTimeAgo } from './relativeTime';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('formatTimeAgo', () => {
  it('says just now under a minute, never seconds', () => {
    expect(formatTimeAgo(ago(0), NOW)).toBe('just now');
    expect(formatTimeAgo(ago(59_000), NOW)).toBe('just now');
  });

  it('uses minutes up to an hour', () => {
    expect(formatTimeAgo(ago(MIN), NOW)).toBe('1 minute ago');
    expect(formatTimeAgo(ago(5 * MIN + 30_000), NOW)).toBe('5 minutes ago');
    expect(formatTimeAgo(ago(59 * MIN), NOW)).toBe('59 minutes ago');
  });

  it('switches to hours and minutes at one hour', () => {
    expect(formatTimeAgo(ago(60 * MIN), NOW)).toBe('1 hour ago');
    expect(formatTimeAgo(ago(61 * MIN), NOW)).toBe('1 hour 1 minute ago');
    expect(formatTimeAgo(ago(125 * MIN), NOW)).toBe('2 hours 5 minutes ago');
    expect(formatTimeAgo(ago(180 * MIN), NOW)).toBe('3 hours ago');
  });

  it('handles future and invalid timestamps', () => {
    expect(formatTimeAgo(ago(-5 * MIN), NOW)).toBe('just now');
    expect(formatTimeAgo('nope', NOW)).toBe('');
  });
});
