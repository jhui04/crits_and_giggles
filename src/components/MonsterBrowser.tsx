import { useState, useMemo, useEffect, useRef } from 'react';
import type { Monster } from '../types';
import { dataService } from '../services/DataService';
import type { MonsterFilters } from '../services/DataService';
import { MonsterDetails } from './MonsterDetails';

interface MonsterBrowserProps {
  onSelect?: (monster: Monster) => void;
  ctaLabel?: string;
  autoFocus?: boolean;
}

export function MonsterBrowser({ onSelect, ctaLabel = "Add to Encounter", autoFocus = false }: MonsterBrowserProps) {
  const [allMonsters, setAllMonsters] = useState<Monster[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<MonsterFilters>({ search: '', sources: [], sizes: [], crs: [] });
  const [previewMonster, setPreviewMonster] = useState<Monster | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const filtersHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    dataService.getAllMonsters().then(data => {
      if (isMounted) {
        setAllMonsters(data);
        setLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (autoFocus && !loading) {
      searchInputRef.current?.focus();
    }
  }, [autoFocus, loading]);

  useEffect(() => {
    if (previewMonster && previewHeadingRef.current) {
      previewHeadingRef.current.focus();
    }
  }, [previewMonster]);

  useEffect(() => {
    if (isFiltersOpen && filtersHeadingRef.current) {
      filtersHeadingRef.current.focus();
    }
  }, [isFiltersOpen]);

  const availableFilters = useMemo(() => dataService.getMonsterFilters(allMonsters), [allMonsters]);
  
  const filteredMonsters = useMemo(() => {
    return dataService.filterMonsters(allMonsters, filters);
  }, [allMonsters, filters]);

  const visibleMonsters = useMemo(() => filteredMonsters.slice(0, 100), [filteredMonsters]);

  const handleClosePreview = () => {
    setPreviewMonster(null);
    setTimeout(() => lastFocusedElementRef.current?.focus(), 0);
  };

  const handleCloseFilters = () => {
    setIsFiltersOpen(false);
    setTimeout(() => lastFocusedElementRef.current?.focus(), 0);
  };

  const toggleFilter = (category: 'sources' | 'sizes' | 'crs', value: string) => {
    setFilters(prev => {
      const currentList = prev[category] || [];
      const updatedList = currentList.includes(value) 
        ? currentList.filter(v => v !== value) 
        : [...currentList, value];
      return { ...prev, [category]: updatedList };
    });
  };

  if (loading) return <div role="status">Loading monsters...</div>;

  return (
    <div className="monster-browser">
      <form onSubmit={(e) => e.preventDefault()} className="search-bar" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <div style={{ flexGrow: 1 }}>
          <label htmlFor="monster-search">Search Name:</label>
          <input
            id="monster-search"
            ref={searchInputRef}
            type="text"
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search monsters..."
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

      <p role="status" aria-live="polite">
        Showing {visibleMonsters.length} of {filteredMonsters.length} monsters.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, maxHeight: '50vh', overflowY: 'auto' }}>
        {visibleMonsters.map(m => (
          <li key={m.id} style={{ borderBottom: '1px solid #eee' }}>
            <button 
              type="button" 
              data-fuzzer-category="monster-details"
              onClick={(e) => {
                lastFocusedElementRef.current = e.currentTarget;
                setPreviewMonster(m);
              }}
              style={{
                width: '100%', textAlign: 'left', padding: '0.75rem',
                border: 'none', background: 'none', cursor: 'pointer',
                display: 'block', color: 'inherit'
              }}
            >
              <div style={{ pointerEvents: 'none' }}>
                <strong style={{ fontSize: '1.1rem' }}>{m.name}</strong>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  <span className="sr-only">Challenge Rating</span>
                  <span aria-hidden="true">CR</span> {m.cr} | {m.meta?.size} {m.meta?.type} | {m.source}
                  <span className="sr-only">. Click to view details.</span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

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
              Filter Monsters
            </h3>
            <form onSubmit={(e) => { e.preventDefault(); handleCloseFilters(); }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>Source</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <legend className="sr-only">Source</legend>
                    {availableFilters.sources.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={(filters.sources || []).includes(s)}
                          onChange={() => toggleFilter('sources', s)}
                        />
                        {s}
                      </label>
                    ))}
                  </fieldset>
                </details>

                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>CR</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    <legend className="sr-only">CR</legend>
                    {availableFilters.crs.map(cr => (
                      <label key={cr} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={(filters.crs || []).includes(cr)}
                          onChange={() => toggleFilter('crs', cr)}
                        />
                        {cr}
                      </label>
                    ))}
                  </fieldset>
                </details>

                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>Size</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <legend className="sr-only">Size</legend>
                    {availableFilters.sizes.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={(filters.sizes || []).includes(s)}
                          onChange={() => toggleFilter('sizes', s)}
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

      {previewMonster && (
        <div 
          className="modal-overlay" 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="preview-title" 
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              handleClosePreview();
            }
          }}
          style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 10000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', color: 'black', padding: '2rem', borderRadius: '8px',
            maxWidth: '800px', width: '90%', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <h3 id="preview-title" ref={previewHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
              {previewMonster.name} Details
            </h3>
            <MonsterDetails monster={previewMonster} />
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
              {onSelect && (
                <button type="button" onClick={() => { onSelect(previewMonster); setPreviewMonster(null); }} style={{ flex: 1, padding: '0.75rem', fontWeight: 'bold' }}>
                  {ctaLabel}
                </button>
              )}
              <button type="button" onClick={handleClosePreview} style={{ flex: 1, padding: '0.75rem' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
