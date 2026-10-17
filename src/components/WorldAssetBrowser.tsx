import { useState, useRef, useMemo } from 'react';
import { useWorlds } from '../context/WorldContext';
import type { World, WorldAsset } from '../types';
import { useFocusRestore } from './uiHelpers';
import {
  DETAILS_TITLE_ID, OracleDetailsHeading, OracleDialog, OracleDialogActions, OracleFiltersDialog,
  OracleResultItem, OracleResults, OracleSearchBar,
} from './OracleBrowserParts';
import { asOptions, toggleIn, useInitialSearchFocus } from '../utils/oracleBrowser';
import { describeIncoming } from '../utils/relationships';
import { Markdown } from './Markdown';

interface WorldAssetBrowserProps {
  autoFocus?: boolean;
}

const ASSET_TYPES = ['NPC', 'Location', 'Item', 'Spell', 'Organization', 'Religion', 'Lore', 'Faction', 'Race', 'Class', 'Background', 'Note'];

export function WorldAssetBrowser({ autoFocus = false }: WorldAssetBrowserProps) {
  const { activeWorld } = useWorlds();
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<WorldAsset | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { remember, restore } = useFocusRestore();

  useInitialSearchFocus(autoFocus, !!activeWorld, searchInputRef, () => selectedAsset !== null || isFiltersOpen);

  const filteredAssets = useMemo(() => {
    if (!activeWorld) return [];
    const q = search.toLowerCase();
    return activeWorld.assets.filter(as =>
      (types.length === 0 || types.includes(as.type)) &&
      (as.name.toLowerCase().includes(q) ||
        as.description.toLowerCase().includes(q) ||
        as.tags.some(t => t.toLowerCase().includes(q))));
  }, [activeWorld, search, types]);

  if (!activeWorld) {
    return <p>No world is active. Choose or create one with Change World in Campaign Settings.</p>;
  }

  const focusSearch = () => searchInputRef.current?.focus();
  const closeDetails = () => { setSelectedAsset(null); restore('details', focusSearch); };
  const closeFilters = () => { setIsFiltersOpen(false); restore('filters', focusSearch); };

  return (
    <div className="world-asset-browser">
      <OracleSearchBar
        id="world-asset-search"
        label="Search World Assets"
        value={search}
        onChange={setSearch}
        inputRef={searchInputRef}
        activeFilterCount={types.length}
        onOpenFilters={trigger => { remember('filters', trigger); setIsFiltersOpen(true); }}
      />

      <OracleResults
        noun={['world asset', 'world assets']}
        items={filteredAssets}
        renderItem={as => (
          <OracleResultItem
            key={as.id}
            name={as.name}
            details={[as.type]}
            onOpen={trigger => { remember('details', trigger); setSelectedAsset(as); }}
          />
        )}
      />

      {isFiltersOpen && (
        <OracleFiltersDialog
          title="Filter World Assets"
          groups={[{ key: 'types', legend: 'Type', options: asOptions(ASSET_TYPES), selected: types }]}
          onToggle={(_key, value) => setTypes(prev => toggleIn(prev, value))}
          onClose={closeFilters}
        />
      )}

      {selectedAsset && (
        <OracleDialog labelledBy={DETAILS_TITLE_ID} onClose={closeDetails}>
          <OracleDetailsHeading>{selectedAsset.name}</OracleDetailsHeading>
          <WorldAssetDetail asset={selectedAsset} world={activeWorld} />
          <OracleDialogActions onClose={closeDetails} />
        </OracleDialog>
      )}
    </div>
  );
}

function WorldAssetDetail({ asset, world }: { asset: WorldAsset; world: World }) {
  const outgoing = asset.connections.map(conn => {
    const target = world.assets.find(t => t.id === conn.targetId);
    return { key: conn.id, text: `${conn.relationship} ${target ? `${target.name} (${target.type})` : 'Unknown Asset'}${conn.description ? `. ${conn.description}` : ''}` };
  });
  const incoming = world.assets.flatMap(source =>
    source.connections
      .filter(conn => conn.targetId === asset.id)
      .map(conn => ({ key: `${source.id}-${conn.id}`, text: `${describeIncoming(source.name, source.type, conn)}${conn.description ? `. ${conn.description}` : ''}` })));
  const connections = [...outgoing, ...incoming];

  return (
    <>
      <p><strong>Type:</strong> {asset.type}</p>
      {asset.description?.trim()
        ? <Markdown content={asset.description} baseHeadingLevel={4} />
        : <p>No description provided.</p>}
      {asset.tags.length > 0 && <p><strong>Tags:</strong> {asset.tags.join(', ')}</p>}
      <h4 style={{ marginBottom: '0.5rem' }}>Connections</h4>
      {connections.length === 0 ? (
        <p>No connections recorded.</p>
      ) : (
        <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
          {connections.map(c => <li key={c.key}>{c.text}</li>)}
        </ul>
      )}
    </>
  );
}
