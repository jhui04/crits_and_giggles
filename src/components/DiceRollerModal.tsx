import { useState, useRef, useEffect, useMemo } from 'react';
import { DiceService } from '../services/DiceService';
import type { DiceResult } from '../services/DiceService';
import { useDiceLog, diceLogService } from '../services/DiceLogService';
import { formatTimeAgo } from '../utils/relativeTime';
import { DisclosureSelect } from './DisclosureSelect';

interface DiceRollerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ALL_ROLLERS = 'all';

export function DiceRollerModal({ isOpen, onClose }: DiceRollerModalProps) {
  const [notation, setNotation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<DiceResult | null>(null);
  const { entries: history, clearLog } = useDiceLog();
  const [announcement, setAnnouncement] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterSource, setFilterSource] = useState<string>(ALL_ROLLERS);
  const [searchQuery, setSearchQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // Keep the "x minutes ago" labels fresh while the dialog is open.
  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => setNow(Date.now());
    const initial = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 30_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [isOpen]);

  const sourceOptions = useMemo(() => {
    const sources = Array.from(new Set(history.map(e => e.source).filter(Boolean))).sort();
    return [
      { value: ALL_ROLLERS, label: 'All Rollers' },
      ...sources.map(s => ({ value: s, label: s })),
    ];
  }, [history]);

  // A roller that no longer has entries (e.g. after Clear Log) falls back to all.
  const activeSource = sourceOptions.some(o => o.value === filterSource) ? filterSource : ALL_ROLLERS;

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return history.filter(entry => {
      if (activeSource !== ALL_ROLLERS && entry.source !== activeSource) return false;
      if (!q) return true;
      return entry.purpose.toLowerCase().includes(q)
        || entry.source.toLowerCase().includes(q)
        || entry.formula.toLowerCase().includes(q);
    });
  }, [history, activeSource, searchQuery]);

  const activeFilterCount = (activeSource !== ALL_ROLLERS ? 1 : 0) + (searchQuery.trim() ? 1 : 0);

  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  // Focus management: Focus the heading when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        modalHeadingRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Focus trapping
  useEffect(() => {
    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalContentRef.current) return;

      const focusableElements = modalContentRef.current.querySelectorAll(
        'h2[tabIndex="-1"], a[href], button:not([disabled]), textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select'
      );
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) { // Shift + Tab
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else { // Tab
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

  const handleRoll = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!notation.trim()) return;

    try {
      setError(null);
      const res = DiceService.roll(notation);
      setCurrentResult(res);

      const isD20 = notation.toLowerCase().includes('d20') && res.rolls.length === 1;
      const critStatus = isD20 ? (res.rolls[0] === 20 ? 'crit' : res.rolls[0] === 1 ? 'fumble' : 'normal') : 'normal';

      // Log to persistent global dice log with metadata
      diceLogService.logRoll({
        source: 'Dice Roller',
        purpose: 'Manual Roll',
        formula: notation,
        rolls: res.rolls,
        modifier: res.modifier,
        total: res.total,
        critStatus
      });

      // Formulate screen reader announcement
      const rollsStr = res.rolls.length > 0 ? `Rolls: ${res.rolls.join(', ')}.` : '';
      const modStr = res.modifier !== 0 ? `Modifier: ${res.modifier > 0 ? '+' : ''}${res.modifier}.` : '';
      const textAnnouncement = `Result: ${res.total}. Rolled: ${notation}. ${rollsStr} ${modStr}`;
      
      setAnnouncement('');
      setTimeout(() => {
        setAnnouncement(textAnnouncement);
      }, 50);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Invalid notation';
      setError(errMsg);
      setAnnouncement(`Error rolling dice: ${errMsg}`);
    }
  };

  const handleClear = () => {
    setNotation('');
    setError(null);
    setCurrentResult(null);
    setAnnouncement('Input and current result cleared.');
    inputRef.current?.focus();
  };

  const handleClearLog = () => {
    clearLog();
    setFiltersOpen(false);
    setFilterSource(ALL_ROLLERS);
    setSearchQuery('');
    setAnnouncement('Dice log cleared.');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dice-roller-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 3100,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '5vh'
      }}
    >
      {/* Screen Reader Live Region for Announcements */}
      <div aria-live="assertive" className="sr-only" style={{
        position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
        overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0
      }}>
        {announcement}
      </div>

      <div
        ref={modalContentRef}
        className="modal-content dark-theme"
        style={{
          backgroundColor: '#1a1a1a', color: 'white', padding: '2rem', borderRadius: '8px',
          maxWidth: '600px', width: '95%', maxHeight: '90vh', overflowY: 'auto',
          border: '2px solid #444', boxShadow: '0 0 20px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 id="dice-roller-title" ref={modalHeadingRef} tabIndex={-1} style={{ margin: 0, outline: 'none' }}>
            Quick Dice Roller
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

        <form onSubmit={handleRoll} style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label htmlFor="dice-notation-input" style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
              Dice Notation (e.g. 1d20+5, 1d10+2+2d4):
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="dice-notation-input"
                ref={inputRef}
                type="text"
                value={notation}
                onChange={e => setNotation(e.target.value)}
                placeholder="1d20+5"
                style={{
                  flexGrow: 1, padding: '0.75rem', fontSize: '1.1rem',
                  background: '#333', color: 'white', border: '1px solid #444',
                  borderRadius: '4px'
                }}
                autoComplete="off"
              />
              <button
                type="submit"
                style={{
                  padding: '0.75rem 1.5rem', background: '#1976d2', color: 'white',
                  border: 'none', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold'
                }}
              >
                Roll
              </button>
              <button
                type="button"
                onClick={handleClear}
                style={{
                  padding: '0.75rem 1rem', background: '#555', color: 'white',
                  border: 'none', cursor: 'pointer', borderRadius: '4px'
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div
            role="alert"
            style={{
              background: 'rgba(211, 47, 47, 0.2)', border: '1px solid #d32f2f',
              color: '#ff8a80', padding: '1rem', borderRadius: '4px', marginBottom: '1.5rem'
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {currentResult && !error && (
          <div
            style={{
              background: '#222', border: '1px solid #444', padding: '1.5rem',
              borderRadius: '4px', marginBottom: '1.5rem', textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '1rem', color: '#aaa', marginBottom: '0.5rem' }}>
              Rolled: <strong>{currentResult.notation}</strong>
            </div>
            <div data-testid="grand-total" style={{ fontSize: '3rem', fontWeight: 'bold', color: '#4caf50', margin: '0.5rem 0' }}>
              {currentResult.total}
            </div>
            <div style={{ fontSize: '1.1rem' }}>
              Rolls: [{currentResult.rolls.join(', ')}]
              {currentResult.modifier !== 0 && ` | Modifier: ${currentResult.modifier > 0 ? '+' : ''}${currentResult.modifier}`}
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #444', paddingBottom: '0.5rem', margin: '1.5rem 0 0.5rem 0', gap: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>
                Dice Log
              </h3>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls="dice-log-filters"
                  onClick={() => setFiltersOpen(open => !open)}
                  style={{
                    padding: '0.4rem 0.75rem', background: '#333', color: 'white',
                    border: '1px solid #555', borderRadius: '4px', cursor: 'pointer'
                  }}
                >
                  {activeFilterCount > 0 ? `Filter, ${activeFilterCount} active` : 'Filter'}
                </button>
                <button
                  type="button"
                  onClick={handleClearLog}
                  style={{
                    background: 'none', border: 'none', color: '#ff8a80',
                    cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline'
                  }}
                >
                  Clear Log
                </button>
              </div>
            </div>

            {filtersOpen && (
              <div
                id="dice-log-filters"
                style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}
              >
                <DisclosureSelect
                  label="Roller"
                  value={activeSource}
                  options={sourceOptions}
                  onChange={setFilterSource}
                  style={{ flex: '1 1 200px' }}
                  buttonStyle={{
                    width: '100%', padding: '0.5rem', background: '#333', color: 'white',
                    border: '1px solid #555', borderRadius: '4px'
                  }}
                />
                <div style={{ flex: '2 1 250px' }}>
                  <label htmlFor="dice-log-search" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                    Search Purpose / Action
                  </label>
                  <input
                    id="dice-log-search"
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    autoComplete="off"
                    style={{
                      width: '100%', padding: '0.5rem', background: '#333', color: 'white',
                      border: '1px solid #555', borderRadius: '4px', boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>
            )}

            {filteredHistory.length === 0 ? (
              <p role="status" style={{ color: '#b5b5b5', fontStyle: 'italic' }}>No rolls match the current filter.</p>
            ) : (
              <ul aria-label="Dice rolls" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {filteredHistory.map(item => {
                  const totalColor = item.critStatus === 'crit' ? '#ffc107' : item.critStatus === 'fumble' ? '#ff5252' : '#4caf50';
                  const natLabel = item.critStatus === 'crit' ? 'Natural 20' : item.critStatus === 'fumble' ? 'Natural 1' : '';
                  const rollsText = item.rolls?.length ? item.rolls.join(', ') : '';
                  const modText = item.modifier ? `${item.modifier > 0 ? '+' : ''}${item.modifier}` : '';
                  return (
                    <li
                      key={item.id}
                      style={{
                        display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0',
                        borderBottom: '1px solid #333', fontSize: '0.95rem'
                      }}
                    >
                      <span>
                        <span style={{ color: '#aaa' }}>{formatTimeAgo(item.isoTimestamp, now)}</span>{', '}
                        <strong style={{ color: '#90caf9' }}>{item.source}</strong>{', '}
                        <span>{item.purpose}</span>{' '}
                        <code>({item.formula})</code>
                        {item.details && <span style={{ color: '#ccc', fontStyle: 'italic' }}>{`, ${item.details}`}</span>}
                      </span>
                      <span>
                        {natLabel && <strong style={{ color: totalColor }}>{`${natLabel}, `}</strong>}
                        Total <strong style={{ color: totalColor }}>{item.total}</strong>
                        {(rollsText || modText) && (
                          <span style={{ color: '#aaa' }}>
                            {rollsText && `, rolls ${rollsText}`}
                            {modText && `, modifier ${modText}`}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
