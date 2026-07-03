import { useState, useEffect, useRef, useMemo } from 'react';
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
  const [filters, setFilters] = useState({ search: '', levels: [] as string[], schools: [] as string[] });
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const filtersHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

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
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [autoFocus, isLoading]);

  const availableFilters = useMemo(() => dataService.getSpellFilters(spells), [spells]);

  const filteredSpells = useMemo(() => {
    return dataService.filterSpells(spells, filters);
  }, [spells, filters]);

  const handleSelectSpell = (spell: Spell) => {
    setSelectedSpell(spell);
  };

  const toggleFilter = (category: 'levels' | 'schools', value: string) => {
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
      
      <form onSubmit={(e) => e.preventDefault()} className="search-bar" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end', backgroundColor: '#f4f4f4', padding: '1rem', borderRadius: '8px' }}>
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

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', maxHeight: '600px', overflowY: 'auto', border: '1px solid #ccc', borderRadius: '4px' }}>
          <h3 ref={listHeadingRef} tabIndex={-1} style={{ padding: '0.5rem', margin: 0, backgroundColor: '#eee', borderBottom: '1px solid #ccc' }}>
            Results ({filteredSpells.length})
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {filteredSpells.map(s => (
              <li key={s.id}>
                <button 
                  type="button"
                  onClick={() => handleSelectSpell(s)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '0.75rem', 
                    border: 'none', borderBottom: '1px solid #eee',
                    backgroundColor: selectedSpell?.id === s.id ? '#e0f0ff' : 'transparent',
                    cursor: 'pointer', fontWeight: selectedSpell?.id === s.id ? 'bold' : 'normal'
                  }}
                  aria-current={selectedSpell?.id === s.id ? 'true' : undefined}
                >
                  {s.name} <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>({s.level === 0 ? 'Cantrip' : `Lvl ${s.level}`})</span>
                </button>
              </li>
            ))}
            {filteredSpells.length === 0 && <li style={{ padding: '1rem' }}>No spells match your filters.</li>}
          </ul>
        </div>

        <div style={{ flex: '2 1 400px' }}>
          {selectedSpell ? (
            <SpellDetail spell={selectedSpell} />
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', border: '2px dashed #ccc', borderRadius: '8px', color: '#666' }}>
              Select a spell to view details.
            </div>
          )}
        </div>
      </div>

      {isFiltersOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="filters-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 10000
        }}>
          <div className="modal-content" style={{
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
