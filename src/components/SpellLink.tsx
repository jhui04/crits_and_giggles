import { useState, useEffect, useRef, useMemo } from 'react';
import type { Spell } from '../types';
import { SpellDetail } from './SpellBrowser';
import { dataService } from '../services/DataService';
import { useFocusTrap } from './uiHelpers';

interface SpellLinkProps {
  spellName: string;
}

// Simple in-memory cache for spells
let spellCache: Spell[] | null = null;

export function SpellLink({ spellName }: SpellLinkProps) {
  const [spells, setSpells] = useState<Spell[]>(spellCache || []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalContentRef, isModalOpen);

  useEffect(() => {
    if (!spellCache) {
      dataService.getAllSpells()
        .then(loadedSpells => {
          spellCache = loadedSpells;
          setSpells(loadedSpells);
        })
        .catch(err => console.error('Failed to load spells for linking:', err));
    }
  }, []);

  const foundSpell = useMemo(() => {
    if (spells.length > 0) {
      const name = spellName.toLowerCase().replace(/[.,!?;:]/g, '').trim();
      return spells.find(s => s.name.toLowerCase() === name) || null;
    }
    return null;
  }, [spells, spellName]);

  const openModal = () => {
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (isModalOpen) {
      setTimeout(() => {
        modalHeadingRef.current?.focus();
      }, 50);
    }
  }, [isModalOpen]);

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
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeModal();
          }
        }}
        >
          <div ref={modalContentRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto',
            color: '#333'
          }}>
            <h3 id="spell-link-modal-title" ref={modalHeadingRef} tabIndex={-1} className="sr-only" style={{ outline: 'none' }}>{foundSpell.name} Details</h3>
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

