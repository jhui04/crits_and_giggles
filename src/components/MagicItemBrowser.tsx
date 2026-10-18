import { AssetImage } from './AssetImage';
import { useState, useEffect, useRef, useMemo } from 'react';
import type { MagicItem, LoreItem } from '../types';
import { dataService } from '../services/DataService';
import { Markdown } from './Markdown';
import { useFocusRestore } from './uiHelpers';
import {
  DETAILS_TITLE_ID, OracleDialog, OracleDialogActions, OracleFiltersDialog, OracleResultItem,
  OracleResults, OracleSearchBar,
} from './OracleBrowserParts';
import { asOptions, toggleIn, useInitialSearchFocus } from '../utils/oracleBrowser';

interface MagicItemBrowserProps {
  autoFocus?: boolean;
}

type FilterKey = 'types' | 'rarities' | 'sources';

export function MagicItemBrowser({ autoFocus = false }: MagicItemBrowserProps) {
  const [items, setItems] = useState<MagicItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: '', types: [] as string[], rarities: [] as string[], sources: [] as string[] });
  const [selectedItem, setSelectedItem] = useState<MagicItem | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { remember, restore } = useFocusRestore();

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
          console.error('Failed to load magic items:', err);
          setError('Failed to load magic items.');
          setIsLoading(false);
        }
      });
    return () => { isMounted = false; };
  }, []);

  useInitialSearchFocus(autoFocus, !isLoading, searchInputRef, () => selectedItem !== null || isFiltersOpen);

  const availableFilters = useMemo(() => dataService.getMagicItemFilters(items), [items]);
  const filteredItems = useMemo(() => dataService.filterMagicItems(items, filters), [items, filters]);

  const focusSearch = () => searchInputRef.current?.focus();
  const closeDetails = () => { setSelectedItem(null); restore('details', focusSearch); };
  const closeFilters = () => { setIsFiltersOpen(false); restore('filters', focusSearch); };

  if (isLoading) return <p role="status">Loading magic items...</p>;
  if (error) return <p role="alert">{error}</p>;

  return (
    <div className="magic-item-browser">
      <OracleSearchBar
        id="magic-item-search"
        label="Search Magic Items"
        value={filters.search}
        onChange={search => setFilters(prev => ({ ...prev, search }))}
        inputRef={searchInputRef}
        activeFilterCount={filters.types.length + filters.rarities.length + filters.sources.length}
        onOpenFilters={trigger => { remember('filters', trigger); setIsFiltersOpen(true); }}
      />

      <OracleResults
        noun={['magic item', 'magic items']}
        items={filteredItems}
        renderItem={item => (
          <OracleResultItem
            key={item.id}
            name={item.name}
            details={[item.rarity, item.subtype ? `${item.type} (${item.subtype})` : item.type, item.source]}
            onOpen={trigger => { remember('details', trigger); setSelectedItem(item); }}
          />
        )}
      />

      {isFiltersOpen && (
        <OracleFiltersDialog
          title="Filter Magic Items"
          groups={[
            { key: 'types', legend: 'Type', options: asOptions(availableFilters.types), selected: filters.types },
            { key: 'rarities', legend: 'Rarity', options: asOptions(availableFilters.rarities), selected: filters.rarities },
            { key: 'sources', legend: 'Source', options: asOptions(availableFilters.sources), selected: filters.sources },
          ]}
          onToggle={(key, value) => setFilters(prev => ({ ...prev, [key]: toggleIn(prev[key as FilterKey], value) }))}
          onClose={closeFilters}
        />
      )}

      {selectedItem && (
        <OracleDialog labelledBy={DETAILS_TITLE_ID} onClose={closeDetails}>
          <MagicItemDetail magicItem={selectedItem} id={DETAILS_TITLE_ID} />
          <OracleDialogActions onClose={closeDetails} />
        </OracleDialog>
      )}
    </div>
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
      <AssetImage src={magicItem.image} />

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
