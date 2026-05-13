import React, { useState, useEffect, useRef } from 'react';
import type { Spell } from '../types';
import { SpellDetail } from './SpellBrowser';

interface SpellLinkProps {
  spellName: string;
}

// Simple in-memory cache for spells
let spellCache: Spell[] | null = null;

export function SpellLink({ spellName }: SpellLinkProps) {
  const [spells, setSpells] = useState<Spell[]>(spellCache || []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [foundSpell, setFoundSpell] = useState<Spell | null>(null);
  
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (spellCache) {
      setSpells(spellCache);
    } else {
      fetch('/data/spells.json')
        .then(res => res.json())
        .then(data => {
          const loadedSpells = data.spells || data;
          spellCache = loadedSpells;
          setSpells(loadedSpells);
        })
        .catch(err => console.error('Failed to load spells for linking:', err));
    }
  }, []);

  useEffect(() => {
    if (spells.length > 0) {
      const name = spellName.toLowerCase().replace(/[.,!?;:]/g, '').trim();
      const spell = spells.find(s => s.name.toLowerCase() === name);
      setFoundSpell(spell || null);
    }
  }, [spells, spellName]);

  const openModal = () => {
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  };

  if (!foundSpell) return <span>{spellName}</span>;

  return (
    <>
      <button 
        type="button"
        ref={triggerRef}
        onClick={openModal}
        style={{
          background: 'none',
          border: 'none',
          color: '#0066cc',
          textDecoration: 'underline',
          cursor: 'pointer',
          padding: 0,
          font: 'inherit',
          fontWeight: 'bold'
        }}
        aria-label={`${foundSpell.name}, view spell details`}
      >
        {spellName}
      </button>

      {isModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="spell-link-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto',
            color: '#333'
          }}>
            <h3 id="spell-link-modal-title" className="sr-only">{foundSpell.name} Details</h3>
            <SpellDetail spell={foundSpell} />
            <button 
              type="button" 
              onClick={closeModal}
              style={{ marginTop: '1.5rem', width: '100%', padding: '0.75rem', cursor: 'pointer' }}
            >
              Close Spell (Esc)
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Utility to wrap spell names in text with SpellLink components.
 * This is a naive implementation that looks for capitalized words that match spell names.
 * For production, we might want a more sophisticated approach.
 */
export function wrapSpells(text: string, spellNames: string[]): React.ReactNode[] {
  if (!text || spellNames.length === 0) return [text];

  // Sort spell names by length descending to match longer ones first (e.g. "Hold Person" before "Hold")
  const sortedNames = [...spellNames].sort((a, b) => b.length - a.length);
  
  // Create a regex that matches any of the spell names
  // We use word boundaries \b to avoid matching parts of words
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
