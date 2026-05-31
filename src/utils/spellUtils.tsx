import React from 'react';
import { SpellLink } from '../components/SpellLink';

/**
 * Utility to wrap spell names in text with SpellLink components.
 * This is a naive implementation that looks for capitalized words that match spell names.
 */
export function wrapSpells(text: string, spellNames: string[]): React.ReactNode[] {
  if (!text || spellNames.length === 0) return [text];

  // Sort spell names by length descending to match longer ones first
  const sortedNames = [...spellNames].sort((a, b) => b.length - a.length);
  
  // Create a regex that matches any of the spell names
  const escapedNames = sortedNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\b(${escapedNames.join('|')})\\b`, 'gi');

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<SpellLink key={match.index} spellName={match[1]} />);
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
