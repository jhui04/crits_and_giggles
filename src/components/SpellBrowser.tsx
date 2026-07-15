import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import type { Spell } from '../types';
import { DiceService } from '../services/DiceService';
import { dataService } from '../services/DataService';

interface SpellBrowserProps {
  autoFocus?: boolean;
}

export function SpellBrowser({ autoFocus = false }: SpellBrowserProps) {
  const [spells, setSpells] = useState<Spell[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: '', levels: [] as string[], schools: [] as string[], sources: [] as string[] });
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const filtersHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const detailsContentRef = useRef<HTMLDivElement>(null);
  const filtersContentRef = useRef<HTMLDivElement>(null);

  const selectedSpellRef = useRef<Spell | null>(null);
  const isFiltersOpenRef = useRef(false);
  useLayoutEffect(() => {
    selectedSpellRef.current = selectedSpell;
    isFiltersOpenRef.current = isFiltersOpen;
  });

  useEffect(() => {
    const handleFocusTrap = (e: KeyboardEvent, container: HTMLDivElement | null, includeHeading = false) => {
      if (e.key !== 'Tab' || !container) return;

      const selector = includeHeading
        ? 'a[href], button:not([disabled]), textarea, input[type="text"], input[type="checkbox"], select, summary, h3[tabIndex="-1"]'
        : 'a[href], button:not([disabled]), textarea, input[type="text"], input[type="checkbox"], select, summary';

      const focusableElements = container.querySelectorAll(selector);
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

    const listener = (e: KeyboardEvent) => {
      if (selectedSpell) {
        handleFocusTrap(e, detailsContentRef.current, true);
      } else if (isFiltersOpen) {
        handleFocusTrap(e, filtersContentRef.current, false);
      }
    };

    if (selectedSpell || isFiltersOpen) {
      window.addEventListener('keydown', listener);
    }
    return () => window.removeEventListener('keydown', listener);
  }, [selectedSpell, isFiltersOpen]);

  useEffect(() => {
    let isMounted = true;
    dataService.getAllSpells()
      .then(data => {
        if (isMounted) {
          setSpells(data);
          setIsLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          console.error('Failed to load spells:', err);
          setError('Failed to load spells.');
          setIsLoading(false);
        }
      });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (isFiltersOpen && filtersHeadingRef.current) {
      filtersHeadingRef.current.focus();
    }
  }, [isFiltersOpen]);

  useEffect(() => {
    if (autoFocus && !isLoading) {
      const timer = setTimeout(() => {
        // Guard: don't steal focus if a detail or filters modal opened within the 50ms window
        if (!selectedSpellRef.current && !isFiltersOpenRef.current) {
          searchInputRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, isLoading]);

  const availableFilters = useMemo(() => dataService.getSpellFilters(spells), [spells]);

  const filteredSpells = useMemo(() => {
    return dataService.filterSpells(spells, filters);
  }, [spells, filters]);

  const handleSelectSpell = (spell: Spell) => {
    setSelectedSpell(spell);
  };

  const handleCloseSpellDetails = () => {
    setSelectedSpell(null);
    setTimeout(() => {
      lastFocusedElementRef.current?.focus();
    }, 0);
  };

  const toggleFilter = (category: 'levels' | 'schools' | 'sources', value: string) => {
    setFilters(prev => {
      const currentList = prev[category];
      const updatedList = currentList.includes(value) 
        ? currentList.filter(v => v !== value) 
        : [...currentList, value];
      return { ...prev, [category]: updatedList };
    });
  };

  const handleCloseFilters = () => {
    setIsFiltersOpen(false);
    setTimeout(() => lastFocusedElementRef.current?.focus(), 0);
  };

  if (isLoading) return <p aria-live="polite">Loading spells...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;

  return (
    <section aria-labelledby="spell-browser-title" >
      <h2 id="spell-browser-title" className="sr-only">Spell Browser</h2>
      
      <form onSubmit={(e) => e.preventDefault()} className="search-bar" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
        <div style={{ flexGrow: 1 }}>
          <label htmlFor="spell-search" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Search Spells</label>
          <input 
            id="spell-search"
            ref={searchInputRef}
            type="text"
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
            placeholder="e.g. Fireball"
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
        <button 
          type="button" 
          onClick={(e) => {
            lastFocusedElementRef.current = e.currentTarget;
            setIsFiltersOpen(true);
          }}
          style={{ padding: '0.5rem 1rem', height: 'fit-content' }}
        >
          Filters
        </button>
      </form>

      <p role="status" aria-live="polite" style={{ marginBottom: '1rem' }}>
        Showing {filteredSpells.length} spells.
      </p>

      <div style={{ maxHeight: '600px', overflowY: 'auto', border: '1px solid #ccc', borderRadius: '4px' }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {filteredSpells.map(s => (
            <li key={s.id} style={{ borderBottom: '1px solid #eee' }}>
              <button 
                type="button"
                onClick={(e) => {
                  lastFocusedElementRef.current = e.currentTarget;
                  handleSelectSpell(s);
                }}
                style={{
                  width: '100%', textAlign: 'left', padding: '0.75rem', 
                  border: 'none', background: 'none', cursor: 'pointer',
                  display: 'block', color: 'inherit'
                }}
              >
                <div style={{ pointerEvents: 'none' }}>
                  <strong style={{ fontSize: '1.1rem' }}>{s.name}</strong>
                  <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                    <span>{s.level === 0 ? 'Cantrip' : `Level ${s.level}`}</span> | <span>{s.school}</span> | <span>{s.source}</span>
                    <span className="sr-only">. Click to view details.</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
          {filteredSpells.length === 0 && <li style={{ padding: '1rem' }}>No spells match your filters.</li>}
        </ul>
      </div>

      {isFiltersOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="filters-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 10000
        }}>
          <div className="modal-content" ref={filtersContentRef} style={{
            backgroundColor: 'white', color: 'black', padding: '2rem', borderRadius: '8px',
            maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <h3 id="filters-title" ref={filtersHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
              Filter Spells
            </h3>
            <form onSubmit={(e) => { e.preventDefault(); handleCloseFilters(); }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>Level</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    <legend className="sr-only">Level</legend>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => (
                      <label key={l} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={filters.levels.includes(l.toString())}
                          onChange={() => toggleFilter('levels', l.toString())}
                        />
                        {l === 0 ? 'Cantrip' : `Level ${l}`}
                      </label>
                    ))}
                  </fieldset>
                </details>

                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>School</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    <legend className="sr-only">School</legend>
                    {availableFilters.schools.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={filters.schools.includes(s)}
                          onChange={() => toggleFilter('schools', s)}
                        />
                        {s}
                      </label>
                    ))}
                  </fieldset>
                </details>

                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>Source</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    <legend className="sr-only">Source</legend>
                    {(availableFilters.sources || []).map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={filters.sources.includes(s)}
                          onChange={() => toggleFilter('sources', s)}
                        />
                        {s}
                      </label>
                    ))}
                  </fieldset>
                </details>
              </div>

              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button type="submit" style={{ padding: '0.75rem 1.5rem', fontWeight: 'bold' }}>
                  Apply Filters
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedSpell && (
        <div 
          className="modal-overlay" 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="spell-preview-title" 
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              handleCloseSpellDetails();
            }
          }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 10000
          }}
        >
          <div className="modal-content" ref={detailsContentRef} style={{
            backgroundColor: 'white', color: 'black', padding: '2rem', borderRadius: '8px',
            maxWidth: '800px', width: '90%', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <SpellDetail 
              spell={selectedSpell} 
              id="spell-preview-title"
            />
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
              <button 
                type="button" 
                onClick={handleCloseSpellDetails} 
                style={{ flex: 1, padding: '0.75rem', fontWeight: 'bold' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function SpellDetail({ spell, onAnnounce, id }: { spell: Spell, onAnnounce?: (msg: string) => void, id?: string }) {
  const [activeRoll, setActiveRoll] = useState<{ title: string, result: string } | null>(null);
  const rollModalRef = useRef<HTMLHeadingElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastRollButtonRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (detailHeadingRef.current) {
      detailHeadingRef.current.focus();
    }
  }, [spell.id]);

  useEffect(() => {
    if (activeRoll && rollModalRef.current) {
      rollModalRef.current.focus();
    }
  }, [activeRoll]);

  const handleRoll = (e: React.MouseEvent<HTMLButtonElement>, title: string, diceNotation: string) => {
    lastRollButtonRef.current = e.currentTarget;
    // Basic extraction of dice part: "1d6 Acid" -> "1d6"
    const diceMatch = diceNotation.match(/(\d+d\d+([+-]\d+)?)/i);
    if (diceMatch) {
      const res = DiceService.roll(diceMatch[1]);
      const resultStr = `${res.total} (${res.notation})`;
      setActiveRoll({ title, result: resultStr });
      if (onAnnounce) onAnnounce(`${spell.name} ${title} roll: ${res.total}`);
    }
  };

  const closeRollModal = () => {
    setActiveRoll(null);
    setTimeout(() => {
      if (lastRollButtonRef.current) {
        lastRollButtonRef.current.focus();
        lastRollButtonRef.current = null;
      } else {
        detailHeadingRef.current?.focus();
      }
    }, 50);
  };

  return (
    <div style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: '#fff' }} >
      <h3 id={id} ref={detailHeadingRef} tabIndex={-1} style={{ marginTop: 0, borderBottom: '2px solid #333', paddingBottom: '0.5rem', outline: 'none' }}>
        {spell.name}
      </h3>
      <details style={{ marginBottom: '1.5rem', border: '1px solid #eee', padding: '0.5rem', borderRadius: '4px' }}>
        <summary style={{ fontWeight: 'bold', cursor: 'pointer', outline: 'none' }}>Details</summary>
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            <div><strong>Level:</strong> {spell.level === 0 ? 'Cantrip' : spell.level}</div>
            <div><strong>School:</strong> {spell.school}</div>
            <div><strong>Casting Time:</strong> {spell.casting_time}</div>
            <div><strong>Range:</strong> {spell.range}</div>
            <div><strong>Duration:</strong> {spell.duration}{spell.concentration_required ? ' (Concentration)' : ''}</div>
            <div><strong>Components:</strong> {spell.components}</div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            {spell.damage && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fff8f0', border: '1px solid #f0d0b0', borderRadius: '4px' }}>
                <strong>Damage/Effect:</strong> {spell.damage}
                <button 
                  type="button" 
                  onClick={(e) => handleRoll(e, 'Damage', spell.damage!)}
                  style={{ marginLeft: '1rem', padding: '0.25rem 0.75rem', cursor: 'pointer' }}
                >
                  Roll Damage
                </button>
              </div>
            )}
            {spell.saving_throw && (
              <p><strong>Saving Throw:</strong> {spell.saving_throw}</p>
            )}
          </div>
        </div>
      </details>

      <div style={{ lineHeight: '1.6' }}>
        <p style={{ whiteSpace: 'pre-wrap' }}>{spell.description}</p>
        
        {spell.higher_level_description && (
          <div style={{ marginTop: '1rem', padding: '0.5rem', backgroundColor: '#f9f9f9', borderLeft: '4px solid #ccc' }}>
            <strong>At Higher Levels:</strong>
            <p>{spell.higher_level_description}</p>
          </div>
        )}
      </div>

      <p style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#666', borderTop: '1px solid #eee', paddingTop: '0.5rem' }}>
        <strong>Source:</strong> {spell.source}
      </p>

      {activeRoll && (
        <div 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="spell-roll-title" 
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeRollModal();
            }
          }}
          style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          backgroundColor: '#333', color: 'white', padding: '1.5rem', borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)', zIndex: 1005, minWidth: '250px', textAlign: 'center'
        }}>
          <h4 id="spell-roll-title" ref={rollModalRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0' }}>
            {activeRoll.title} Result
          </h4>
          <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{activeRoll.result}</p>
          <button 
            type="button" 
            onClick={closeRollModal} 
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
          >
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
