import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import type { MagicItem, LoreItem } from '../types';
import { dataService } from '../services/DataService';
import { Markdown } from './Markdown';

interface MagicItemBrowserProps {
  autoFocus?: boolean;
}

export function MagicItemBrowser({ autoFocus = false }: MagicItemBrowserProps) {
  const [items, setItems] = useState<MagicItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: '', types: [] as string[], rarities: [] as string[], sources: [] as string[] });
  const [selectedItem, setSelectedItem] = useState<MagicItem | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const filtersHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const lastSelectedItemButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailsContentRef = useRef<HTMLDivElement>(null);
  const filtersContentRef = useRef<HTMLDivElement>(null);
  // Mirrors selectedItem and isFiltersOpen on every render so timer callbacks see current values
  const selectedItemRef = useRef<MagicItem | null>(null);
  const isFiltersOpenRef = useRef(false);
  useLayoutEffect(() => {
    selectedItemRef.current = selectedItem;
    isFiltersOpenRef.current = isFiltersOpen;
  });

  useEffect(() => {
    let isMounted = true;
    dataService.getAllMagicItems()
      .then(data => {
        if (isMounted) {
          setItems(data);
          setIsLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          console.error("MagicItemBrowser: Failed to load items:", err);
          setError('Failed to load magic items.');
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
        if (!selectedItemRef.current && !isFiltersOpenRef.current) {
          searchInputRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, isLoading]);

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
      if (selectedItem) {
        handleFocusTrap(e, detailsContentRef.current, true);
      } else if (isFiltersOpen) {
        handleFocusTrap(e, filtersContentRef.current, false);
      }
    };

    if (selectedItem || isFiltersOpen) {
      window.addEventListener('keydown', listener);
    }
    return () => window.removeEventListener('keydown', listener);
  }, [selectedItem, isFiltersOpen]);

  const availableFilters = useMemo(() => dataService.getMagicItemFilters(items), [items]);
  const filteredItems = useMemo(() => dataService.filterMagicItems(items, filters), [items, filters]);

  const handleSelectItem = (item: MagicItem) => setSelectedItem(item);

  const toggleFilter = (category: 'types' | 'rarities' | 'sources', value: string) => {
    setFilters(prev => {
      const currentList = prev[category] || [];
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

  const handleCloseDetails = () => {
    setSelectedItem(null);
    setTimeout(() => {
      if (lastSelectedItemButtonRef.current && document.body.contains(lastSelectedItemButtonRef.current)) {
        lastSelectedItemButtonRef.current.focus();
      } else {
        searchInputRef.current?.focus();
      }
    }, 0);
  };

  if (isLoading) return <p aria-live="polite">Loading magic items...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;

  return (
    <section aria-labelledby="magic-item-browser-title">
      <h2 id="magic-item-browser-title" className="sr-only">Magic Item Browser</h2>
      
      <form onSubmit={(e) => e.preventDefault()} className="search-bar" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end', backgroundColor: '#f4f4f4', padding: '1rem', borderRadius: '8px', color: '#111' }}>
        <div style={{ flexGrow: 1 }}>
          <label htmlFor="magic-item-search" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem', color: '#111' }}>Search Magic Items</label>
          <input 
            id="magic-item-search"
            ref={searchInputRef}
            type="text"
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
            placeholder="e.g. Acheron Blade"
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

      {/* Invisible screen reader announcer for filtered result counts */}
      <div className="sr-only" role="status" aria-live="polite">
        {filteredItems.length} magic items found
      </div>

      <div style={{ maxHeight: '600px', overflowY: 'auto', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#fff', color: '#222' }}>
        <h3 ref={listHeadingRef} tabIndex={-1} style={{ padding: '0.5rem', margin: 0, backgroundColor: '#eee', borderBottom: '1px solid #ccc', color: '#222' }}>
          Results ({filteredItems.length})
        </h3>
        <ul style={{ listStyle: 'none', padding: 0, maxHeight: '50vh', overflowY: 'auto', margin: 0 }}>
          {filteredItems.map(item => (
            <li key={item.id} style={{ borderBottom: '1px solid #eee' }}>
              <button 
                type="button"
                onClick={(e) => {
                  lastSelectedItemButtonRef.current = e.currentTarget;
                  handleSelectItem(item);
                }}
                style={{
                  width: '100%', textAlign: 'left', padding: '0.75rem', 
                  border: 'none', background: 'none', cursor: 'pointer',
                  display: 'block', color: 'inherit'
                }}
              >
                <strong style={{ color: '#222' }}>{item.name}</strong>
                <div style={{ fontSize: '0.9rem', color: '#555', marginTop: '0.25rem' }}>
                  {item.rarity} | {item.type} {item.subtype && `(${item.subtype})`}
                </div>
              </button>
            </li>
          ))}
          {filteredItems.length === 0 && <li style={{ padding: '1rem', color: '#222' }}>No items match your filters.</li>}
        </ul>
      </div>

      {selectedItem && (
        <div 
          className="modal-overlay" 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="preview-title" 
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              handleCloseDetails();
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
            <MagicItemDetail 
              magicItem={selectedItem} 
              id="preview-title"
              onClose={handleCloseDetails}
            />
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
              <button 
                type="button" 
                onClick={handleCloseDetails} 
                style={{ flex: 1, padding: '0.75rem', fontWeight: 'bold' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isFiltersOpen && (
        <div 
          className="modal-overlay" 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="filters-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              handleCloseFilters();
            }
          }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 10000
          }}
        >
          <div className="modal-content" ref={filtersContentRef} style={{
            backgroundColor: 'white', color: 'black', padding: '2rem', borderRadius: '8px',
            maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <h3 id="filters-title" ref={filtersHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
              Filter Magic Items
            </h3>
            <form onSubmit={(e) => { e.preventDefault(); handleCloseFilters(); }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>Type</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    <legend className="sr-only">Type</legend>
                    {availableFilters.types.map(t => (
                      <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={filters.types.includes(t)}
                          onChange={() => toggleFilter('types', t)}
                        />
                        {t}
                      </label>
                    ))}
                  </fieldset>
                </details>

                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>Rarity</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    <legend className="sr-only">Rarity</legend>
                    {availableFilters.rarities.map(r => (
                      <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={filters.rarities.includes(r)}
                          onChange={() => toggleFilter('rarities', r)}
                        />
                        {r}
                      </label>
                    ))}
                  </fieldset>
                </details>

                <details>
                  <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>Source Book</summary>
                  <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    <legend className="sr-only">Source Book</legend>
                    {availableFilters.sources.map(s => (
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
    </section>
  );
}

interface MagicItemDetailProps {
  magicItem: MagicItem;
  id?: string;
  onClose?: () => void;
  onAssetClick?: (id: string, tagType: string) => void;
}

export function MagicItemDetail({ magicItem, id, onClose, onAssetClick = () => {} }: MagicItemDetailProps) {
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (detailHeadingRef.current) {
      detailHeadingRef.current.focus();
    }
  }, [magicItem.id]);

  const renderLoreContent = (content: LoreItem[]) => {
    if (!content) return null;
    return content.map((item, idx) => {
      if (typeof item === 'string') {
        return <div key={idx} style={{ marginBottom: '0.5rem' }}><Markdown content={item} onAssetClick={onAssetClick} /></div>;
      }
      if (item.type === 'list') {
        return (
          <ul key={idx} style={{ marginBottom: '0.5rem', paddingLeft: '1.5rem' }}>
            {item.items.map((listItem, i) => (
              <li key={i}><Markdown content={listItem} onAssetClick={onAssetClick} /></li>
            ))}
          </ul>
        );
      }
      if (item.type === 'table') {
        return (
          <div key={idx} style={{ overflowX: 'auto', marginBottom: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ccc' }}>
              <tbody>
                {item.rows.map((row, rIdx) => (
                  <tr key={rIdx} style={{ backgroundColor: rIdx % 2 === 0 ? '#f9f9f9' : 'transparent' }}>
                    {row.map((cell, cIdx) => {
                      const CellTag = rIdx === 0 ? 'th' : 'td';
                      return (
                        <CellTag 
                          key={cIdx} 
                          style={{ 
                            border: '1px solid #ccc', 
                            padding: '0.5rem', 
                            textAlign: 'left',
                            fontWeight: rIdx === 0 ? 'bold' : 'normal'
                          }}
                        >
                          <Markdown content={cell} onAssetClick={onAssetClick} />
                        </CellTag>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      return null;
    });
  };

  return (
    <div 
      style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: '#fff', color: '#000' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClose) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <h3 id={id} ref={detailHeadingRef} tabIndex={-1} style={{ marginTop: 0, borderBottom: '2px solid #333', paddingBottom: '0.5rem', outline: 'none' }}>
        {magicItem.name}
      </h3>
      <div style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: '#555' }}>
        <div><strong>Type:</strong> {magicItem.type} {magicItem.subtype && `(${magicItem.subtype})`}</div>
        <div><strong>Rarity:</strong> {magicItem.rarity}</div>
        {magicItem.requires_attunement && (
          <div style={{ color: '#b91c1c', fontWeight: 'bold' }}>
            {magicItem.attunement_notes || 'Requires Attunement'}
          </div>
        )}
      </div>

      <div style={{ lineHeight: '1.6' }}>
        {renderLoreContent(magicItem.description)}
      </div>

      {magicItem.notes && (
        <p style={{ marginTop: '1rem', fontStyle: 'italic', fontSize: '0.9rem' }}>
          <strong>Notes:</strong> {magicItem.notes}
        </p>
      )}

      <p style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#666', borderTop: '1px solid #eee', paddingTop: '0.5rem' }}>
        <strong>Source:</strong> {magicItem.source}
      </p>
    </div>
  );
}
