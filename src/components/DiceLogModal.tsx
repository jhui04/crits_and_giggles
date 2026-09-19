import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useDiceLog } from '../services/DiceLogService';

interface DiceLogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DiceLogModal({ isOpen, onClose }: DiceLogModalProps) {
  const { entries, clearLog } = useDiceLog();
  const [filterSource, setFilterSource] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [announcement, setAnnouncement] = useState<string>('');

  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        modalHeadingRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Focus trap
  useEffect(() => {
    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalContentRef.current) return;

      const focusableElements = modalContentRef.current.querySelectorAll<HTMLElement>(
        'h2[tabIndex="-1"], a[href], button:not([disabled]), textarea, input[type="text"], select'
      );
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement || document.activeElement === modalHeadingRef.current) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleFocusTrap);
    }
    return () => window.removeEventListener('keydown', handleFocusTrap);
  }, [isOpen]);

  const uniqueSources = useMemo(() => {
    const sources = new Set<string>();
    entries.forEach(e => {
      if (e.source) sources.add(e.source);
    });
    return Array.from(sources).sort();
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      if (filterSource !== 'all' && entry.source !== filterSource) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchPurpose = entry.purpose.toLowerCase().includes(q);
        const matchSource = entry.source.toLowerCase().includes(q);
        const matchFormula = entry.formula.toLowerCase().includes(q);
        return matchPurpose || matchSource || matchFormula;
      }
      return true;
    });
  }, [entries, filterSource, searchQuery]);

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear the entire dice roll log?')) {
      clearLog();
      setAnnouncement('Dice roll log cleared.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dice-log-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 3200,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '5vh'
      }}
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div
        ref={modalContentRef}
        className="modal-content dark-theme"
        style={{
          backgroundColor: '#1a1a1a', color: 'white', padding: '2rem', borderRadius: '8px',
          maxWidth: '750px', width: '95%', maxHeight: '90vh', overflowY: 'auto',
          border: '2px solid #444', boxShadow: '0 0 25px rgba(0,0,0,0.7)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 id="dice-log-title" ref={modalHeadingRef} tabIndex={-1} style={{ margin: 0, outline: 'none' }}>
            DM Dice Roll Log
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem', background: '#444', color: 'white',
              border: 'none', cursor: 'pointer', borderRadius: '4px'
            }}
          >
            Close (Esc)
          </button>
        </div>

        {/* Filter and Search Bar */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="dice-log-filter-source" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>
              Filter by Roller:
            </label>
            <select
              id="dice-log-filter-source"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              style={{
                width: '100%', padding: '0.5rem', background: '#333', color: 'white',
                border: '1px solid #555', borderRadius: '4px'
              }}
            >
              <option value="all">All Rollers ({entries.length})</option>
              {uniqueSources.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '2 1 250px' }}>
            <label htmlFor="dice-log-search" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>
              Search Purpose / Action:
            </label>
            <input
              id="dice-log-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Scimitar, Initiative, Save..."
              style={{
                width: '100%', padding: '0.5rem', background: '#333', color: 'white',
                border: '1px solid #555', borderRadius: '4px'
              }}
            />
          </div>

          {entries.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              style={{
                padding: '0.55rem 1rem', background: '#d32f2f', color: 'white',
                border: 'none', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold'
              }}
              aria-label="Clear all dice roll history"
            >
              Clear Log
            </button>
          )}
        </div>

        {filteredEntries.length === 0 ? (
          <p style={{ color: '#b5b5b5', fontStyle: 'italic', padding: '1rem 0' }}>
            {entries.length === 0 ? 'No dice rolls recorded yet. Roll with Alt+R, click monster actions, or roll initiative to start logging!' : 'No rolls match the current filter.'}
          </p>
        ) : (
          <ul
            aria-label="Dice rolls list"
            style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            {filteredEntries.map((item) => {
              const isCrit = item.critStatus === 'crit';
              const isFumble = item.critStatus === 'fumble';
              const totalColor = isCrit ? '#ffc107' : isFumble ? '#ff5252' : '#4caf50';

              return (
                <li
                  key={item.id}
                  style={{
                    backgroundColor: '#252525',
                    borderLeft: `4px solid ${totalColor}`,
                    borderRadius: '4px',
                    padding: '0.75rem 1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <span style={{ color: '#b0b0b0', fontSize: '0.85rem', marginRight: '0.5rem' }}>
                        [{item.timestamp}]
                      </span>
                      <strong style={{ color: '#90caf9', fontSize: '1rem' }}>
                        {item.source}
                      </strong>
                      <span style={{ color: '#ccc', margin: '0 0.5rem' }}>—</span>
                      <span style={{ fontWeight: 'bold', color: '#fff' }}>
                        {item.purpose}
                      </span>
                      {isCrit && (
                        <span style={{ marginLeft: '0.5rem', backgroundColor: '#ffc107', color: '#000', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                          NAT 20
                        </span>
                      )}
                      {isFumble && (
                        <span style={{ marginLeft: '0.5rem', backgroundColor: '#d32f2f', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                          NAT 1
                        </span>
                      )}
                    </div>
                    <div>
                      <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: totalColor }}>
                        Total: {item.total}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#b5b5b5', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span>
                      Formula: <code>{item.formula}</code>
                      {item.rolls && item.rolls.length > 0 && ` | Rolls: [${item.rolls.join(', ')}]`}
                      {item.modifier !== 0 && ` | Mod: ${item.modifier > 0 ? `+${item.modifier}` : item.modifier}`}
                    </span>
                    {item.details && (
                      <span style={{ color: '#cccccc', fontStyle: 'italic' }}>
                        {item.details}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
