import { useState, useRef, useEffect, useMemo } from 'react';
import type { Asset, AssetType, Monster, Spell } from '../types';
import { dataService } from '../services/DataService';

interface AssetInsertionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (assetId: string, assetName: string, fullAsset?: Asset) => void;
  campaignAssets: Asset[];
  chapterId: string | null;
  onCreateAsset: (asset: Asset) => void;
}

type GlobalAsset = {
  id: string;
  name: string;
  type: AssetType;
  description: string;
};

export function AssetInsertionModal({
  isOpen,
  onClose,
  onInsert,
  campaignAssets,
  chapterId,
  onCreateAsset
}: AssetInsertionModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetType | 'All'>('All');
  const [onlyCampaign, setOnlyCampaign] = useState(true);
  const [isCreateMode, setIsCreateMode] = useState(false);

  // Global data for search
  const [globalMonsters, setGlobalMonsters] = useState<Monster[]>([]);
  const [globalSpells, setGlobalSpells] = useState<Spell[]>([]);

  // Create Mode State
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AssetType>('NPC');
  const [newDesc, setNewDesc] = useState('');

  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const createTitleRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalContentRef.current) return;

      const focusableElements = modalContentRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select'
      );
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

  useEffect(() => {
    if (isOpen) {
      dataService.getAllMonsters().then(setGlobalMonsters);
      dataService.getAllSpells().then(setGlobalSpells);
      
      // Focus management
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isCreateMode) {
      createTitleRef.current?.focus();
    }
  }, [isCreateMode]);

  const filteredAssets = useMemo(() => {
    let results: (Asset | GlobalAsset)[] = [...campaignAssets];

    if (!onlyCampaign) {
      const globalResults: GlobalAsset[] = [
        ...globalMonsters.map(m => ({
          id: m.id,
          name: m.name,
          type: 'NPC' as AssetType,
          description: `CR ${m.cr} ${m.meta.size} ${m.meta.type}`
        })),
        ...globalSpells.map(s => ({
          id: s.id.toString(),
          name: s.name,
          type: 'Spell' as AssetType,
          description: `Level ${s.level} ${s.school}`
        }))
      ];
      
      // Merge and remove duplicates by ID
      const campaignIds = new Set(campaignAssets.map(a => a.id));
      results = [
        ...results,
        ...globalResults.filter(ga => !campaignIds.has(ga.id))
      ];
    }

    return results.filter(asset => {
      const matchesSearch = asset.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === 'All' || asset.type === typeFilter;
      return matchesSearch && matchesType;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [campaignAssets, globalMonsters, globalSpells, onlyCampaign, searchTerm, typeFilter]);

  const handleSaveAndInsert = () => {
    if (!newName) return;
    const newAsset: Asset = {
      id: crypto.randomUUID(),
      name: newName,
      type: newType,
      description: newDesc,
      chapterIds: chapterId ? [chapterId] : []
    };
    onCreateAsset(newAsset);
    onInsert(newAsset.id, newAsset.name, newAsset);
  };

  const handleSelectAsset = (asset: Asset | GlobalAsset) => {
    // If it's a global asset not in the campaign, we need to "create" it in the campaign first
    const existing = campaignAssets.find(a => a.id === asset.id);
    if (!existing) {
      const newAsset: Asset = {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        description: asset.description,
        chapterIds: chapterId ? [chapterId] : []
      };
      onCreateAsset(newAsset);
      onInsert(newAsset.id, newAsset.name, newAsset);
    } else {
      onInsert(asset.id, asset.name);
    }
  };

  const handleBack = () => {
    setIsCreateMode(false);
    setTimeout(() => {
      createButtonRef.current?.focus();
    }, 0);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="asset-insertion-title" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 3000
    }}>
      <div className="modal-content" ref={modalContentRef} style={{
        backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
        maxWidth: '600px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column'
      }}>
        <h2 id="asset-insertion-title" ref={headingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
          {isCreateMode ? 'Create & Insert Asset' : 'Insert Asset Link'}
        </h2>

        {!isCreateMode ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ flexGrow: 1 }}>
                  <label htmlFor="asset-search" className="sr-only">Search Assets</label>
                  <input
                    id="asset-search"
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search assets..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem' }}
                  />
                </div>
                <div>
                  <label htmlFor="asset-type-filter" className="sr-only">Filter by Type</label>
                  <select
                    id="asset-type-filter"
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value as AssetType | 'All')}
                    style={{ padding: '0.5rem' }}
                  >
                    <option value="All">All Types</option>
                    <option value="NPC">NPC</option>
                    <option value="Location">Location</option>
                    <option value="Item">Item</option>
                    <option value="Spell">Spell</option>
                  </select>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={onlyCampaign}
                  onChange={e => setOnlyCampaign(e.target.checked)}
                />
                Only show assets already in the campaign
              </label>
            </div>

            <div style={{ flexGrow: 1, overflowY: 'auto', border: '1px solid #ccc', borderRadius: '4px', marginBottom: '1rem' }}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {filteredAssets.map(asset => (
                  <li key={asset.id} style={{ borderBottom: '1px solid #eee' }}>
                    <button
                      type="button"
                      onClick={() => handleSelectAsset(asset)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '0.75rem',
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 'bold' }}>{asset.name}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: '#666' }}>({asset.type})</span>
                      </div>
                      {!campaignAssets.find(a => a.id === asset.id) && (
                        <span style={{ fontSize: '0.75rem', backgroundColor: '#e0f0ff', padding: '2px 6px', borderRadius: '4px' }}>Global</span>
                      )}
                    </button>
                  </li>
                ))}
                {filteredAssets.length === 0 && (
                  <li style={{ padding: '1rem', textAlign: 'center', color: '#666' }}>No assets found.</li>
                )}
              </ul>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" ref={createButtonRef} onClick={() => setIsCreateMode(true)} style={{ flex: 1 }}>+ Create New Asset</button>
              <button type="button" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label htmlFor="new-asset-name" style={{ display: 'block', fontWeight: 'bold' }}>Asset Title</label>
              <input
                id="new-asset-name"
                ref={createTitleRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{ width: '100%', padding: '0.5rem' }}
                placeholder="e.g. Mysterious Stranger"
              />
            </div>
            <div>
              <label htmlFor="new-asset-type" style={{ display: 'block', fontWeight: 'bold' }}>Type</label>
              <select
                id="new-asset-type"
                value={newType}
                onChange={e => setNewType(e.target.value as AssetType)}
                style={{ width: '100%', padding: '0.5rem' }}
              >
                <option value="NPC">NPC</option>
                <option value="Location">Location</option>
                <option value="Item">Item</option>
                <option value="Spell">Spell</option>
              </select>
            </div>
            <div>
              <label htmlFor="new-asset-desc" style={{ display: 'block', fontWeight: 'bold' }}>Description</label>
              <textarea
                id="new-asset-desc"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                rows={4}
                style={{ width: '100%', padding: '0.5rem' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" onClick={handleSaveAndInsert} disabled={!newName} style={{ flex: 1, fontWeight: 'bold' }}>Save & Insert</button>
              <button type="button" onClick={handleBack} style={{ flex: 1 }}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
