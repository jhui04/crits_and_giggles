import { useState, useMemo, useEffect, useRef } from 'react';
import type { Monster } from '../types';
import { dataService } from '../services/DataService';
import type { MonsterFilters } from '../services/DataService';
import { MonsterDetails } from './MonsterDetails';
import { useFocusRestore } from './uiHelpers';
import {
  DETAILS_TITLE_ID, OracleDetailsHeading, OracleDialog, OracleDialogActions, OracleFiltersDialog, OracleResultItem,
  OracleResults, OracleSearchBar,
} from './OracleBrowserParts';
import { asOptions, toggleIn, useInitialSearchFocus } from '../utils/oracleBrowser';

interface MonsterBrowserProps {
  onSelect?: (monster: Monster) => void;
  ctaLabel?: string;
  autoFocus?: boolean;
  /** Level of the "Results" heading; 4 when the browser sits under an h3. */
  headingLevel?: 3 | 4;
}

type FilterKey = 'crs' | 'sizes' | 'sources';

export function MonsterBrowser({ onSelect, ctaLabel = "Add to Encounter", autoFocus = false, headingLevel = 3 }: MonsterBrowserProps) {
  const [allMonsters, setAllMonsters] = useState<Monster[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Required<MonsterFilters>>({ search: '', sources: [], sizes: [], crs: [] });
  const [previewMonster, setPreviewMonster] = useState<Monster | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { remember, restore } = useFocusRestore();

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

  useInitialSearchFocus(autoFocus, !loading, searchInputRef, () => previewMonster !== null || isFiltersOpen);

  const availableFilters = useMemo(() => dataService.getMonsterFilters(allMonsters), [allMonsters]);
  const filteredMonsters = useMemo(() => dataService.filterMonsters(allMonsters, filters), [allMonsters, filters]);

  const focusSearch = () => searchInputRef.current?.focus();
  const closePreview = () => { setPreviewMonster(null); restore('preview', focusSearch); };
  const closeFilters = () => { setIsFiltersOpen(false); restore('filters', focusSearch); };

  if (loading) return <p role="status">Loading monsters...</p>;

  return (
    <div className="monster-browser">
      <OracleSearchBar
        id="monster-search"
        label="Search Monsters"
        value={filters.search}
        onChange={search => setFilters(prev => ({ ...prev, search }))}
        inputRef={searchInputRef}
        activeFilterCount={filters.crs.length + filters.sizes.length + filters.sources.length}
        onOpenFilters={trigger => { remember('filters', trigger); setIsFiltersOpen(true); }}
      />

      <OracleResults
        noun={['monster', 'monsters']}
        items={filteredMonsters}
        headingLevel={headingLevel}
        renderItem={m => (
          <OracleResultItem
            key={m.id}
            name={m.name}
            details={[`CR ${m.cr}`, [m.meta?.size, m.meta?.type].filter(Boolean).join(' '), m.source]}
            onOpen={trigger => { remember('preview', trigger); setPreviewMonster(m); }}
          />
        )}
      />

      {isFiltersOpen && (
        <OracleFiltersDialog
          title="Filter Monsters"
          groups={[
            { key: 'crs', legend: 'CR', options: asOptions(availableFilters.crs), selected: filters.crs },
            { key: 'sizes', legend: 'Size', options: asOptions(availableFilters.sizes), selected: filters.sizes },
            { key: 'sources', legend: 'Source', options: asOptions(availableFilters.sources), selected: filters.sources },
          ]}
          onToggle={(key, value) => setFilters(prev => ({ ...prev, [key]: toggleIn(prev[key as FilterKey], value) }))}
          onClose={closeFilters}
        />
      )}

      {previewMonster && (
        <OracleDialog labelledBy={DETAILS_TITLE_ID} onClose={closePreview}>
          <OracleDetailsHeading>{previewMonster.name}</OracleDetailsHeading>
          <MonsterDetails monster={previewMonster} />
          <OracleDialogActions onClose={closePreview}>
            {onSelect && (
              <button type="button" onClick={() => { onSelect(previewMonster); setPreviewMonster(null); }} style={{ flex: 1, padding: '0.75rem', fontWeight: 'bold' }}>
                {ctaLabel}
              </button>
            )}
          </OracleDialogActions>
        </OracleDialog>
      )}
    </div>
  );
}
