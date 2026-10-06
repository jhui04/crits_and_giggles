import { useState, useEffect, useRef, useMemo } from 'react';
import type { Spell } from '../types';
import { DiceService } from '../services/DiceService';
import { dataService } from '../services/DataService';
import { useFocusRestore } from './uiHelpers';
import {
  DETAILS_TITLE_ID, OracleDialog, OracleDialogActions, OracleFiltersDialog, OracleResultItem,
  OracleResults, OracleSearchBar,
} from './OracleBrowserParts';
import { asOptions, toggleIn, useInitialSearchFocus } from '../utils/oracleBrowser';

interface SpellBrowserProps {
  autoFocus?: boolean;
}

type FilterKey = 'levels' | 'schools' | 'sources';

const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => ({ value: String(l), label: l === 0 ? 'Cantrip' : `Level ${l}` }));

export function SpellBrowser({ autoFocus = false }: SpellBrowserProps) {
  const [spells, setSpells] = useState<Spell[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: '', levels: [] as string[], schools: [] as string[], sources: [] as string[] });
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { remember, restore } = useFocusRestore();

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

  useInitialSearchFocus(autoFocus, !isLoading, searchInputRef, () => selectedSpell !== null || isFiltersOpen);

  const availableFilters = useMemo(() => dataService.getSpellFilters(spells), [spells]);
  const filteredSpells = useMemo(() => dataService.filterSpells(spells, filters), [spells, filters]);

  const focusSearch = () => searchInputRef.current?.focus();
  const closeDetails = () => { setSelectedSpell(null); restore('details', focusSearch); };
  const closeFilters = () => { setIsFiltersOpen(false); restore('filters', focusSearch); };

  if (isLoading) return <p role="status">Loading spells...</p>;
  if (error) return <p role="alert">{error}</p>;

  return (
    <div className="spell-browser">
      <OracleSearchBar
        id="spell-search"
        label="Search Spells"
        value={filters.search}
        onChange={search => setFilters(prev => ({ ...prev, search }))}
        inputRef={searchInputRef}
        activeFilterCount={filters.levels.length + filters.schools.length + filters.sources.length}
        onOpenFilters={trigger => { remember('filters', trigger); setIsFiltersOpen(true); }}
      />

      <OracleResults
        noun={['spell', 'spells']}
        items={filteredSpells}
        renderItem={s => (
          <OracleResultItem
            key={s.id}
            name={s.name}
            details={[s.level === 0 ? 'Cantrip' : `Level ${s.level}`, s.school, s.source]}
            onOpen={trigger => { remember('details', trigger); setSelectedSpell(s); }}
          />
        )}
      />

      {isFiltersOpen && (
        <OracleFiltersDialog
          title="Filter Spells"
          groups={[
            { key: 'levels', legend: 'Level', options: LEVEL_OPTIONS, selected: filters.levels },
            { key: 'schools', legend: 'School', options: asOptions(availableFilters.schools), selected: filters.schools },
            { key: 'sources', legend: 'Source', options: asOptions(availableFilters.sources || []), selected: filters.sources },
          ]}
          onToggle={(key, value) => setFilters(prev => ({ ...prev, [key]: toggleIn(prev[key as FilterKey], value) }))}
          onClose={closeFilters}
        />
      )}

      {selectedSpell && (
        <OracleDialog labelledBy={DETAILS_TITLE_ID} onClose={closeDetails}>
          <SpellDetail spell={selectedSpell} id={DETAILS_TITLE_ID} />
          <OracleDialogActions onClose={closeDetails} />
        </OracleDialog>
      )}
    </div>
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
    <div style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: '#fff', color: '#111' }} >
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
