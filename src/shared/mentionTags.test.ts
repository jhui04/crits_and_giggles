import { describe, it, expect } from 'vitest';
import { stripMentionTags } from './mentionTags';

describe('stripMentionTags', () => {
  it('replaces a tag with its display name', () => {
    expect(stripMentionTags('Ambush @World[192]{Palma Flora}')).toBe('Ambush Palma Flora');
  });

  it('replaces every tag type in the text', () => {
    expect(stripMentionTags('@Monster[goblin]{Goblin} meets @Campaign[c1]{Mayor} at @Item[i9]{The Gate}'))
      .toBe('Goblin meets Mayor at The Gate');
  });

  it('falls back to the id when a tag has no name', () => {
    expect(stripMentionTags('Cast @Spell[fireball]')).toBe('Cast fireball');
  });

  it('leaves text without tags unchanged', () => {
    expect(stripMentionTags('Chapter 1: email me @ home [draft] {wip}')).toBe('Chapter 1: email me @ home [draft] {wip}');
  });
});
