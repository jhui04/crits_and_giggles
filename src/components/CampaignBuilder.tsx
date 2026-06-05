import { useState, useRef, useEffect, useCallback } from 'react';
import { useCampaigns } from '../context/CampaignContext';
import { EncounterBuilder } from './EncounterBuilder';
import { Markdown } from './Markdown';
import type { AssetType, Asset, Chapter, Encounter, Monster, Spell, PlayerCharacter } from '../types';
import { MonsterDetails } from './MonsterDetails';
import { SpellDetail } from './SpellBrowser';
import { dataService } from '../services/DataService';

export function CampaignBuilder() {
  const { activeCampaign, updateCampaign } = useCampaigns();
  
  // Global Data
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);

  useEffect(() => {
    dataService.getAllMonsters().then(setMonsters);
    dataService.getAllSpells().then(setSpells);
  }, []);

  // Campaign Settings State
  const [showCampaignForm, setShowCampaignForm] = useState(false);

  // Player State
  const [showPlayerForm, setShowPlayerForm] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerDesc, setPlayerDesc] = useState('');
  
  // Asset State
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetName, setAssetName] = useState('');
  const [assetType, setAssetType] = useState<AssetType>('NPC');
  const [assetDesc, setAssetDesc] = useState('');
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [viewingAsset, setViewingAsset] = useState<Asset | null>(null);

  // Chapter State
  const [showChapterForm, setShowChapterForm] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterContent, setChapterContent] = useState('');
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null);

  // Encounter State
  const [isCreatingEncounter, setIsCreatingEncounter] = useState(false);
  const [editingEncounter, setEditingEncounter] = useState<Encounter | null>(null);

  // Refs for focus management
  const campaignHeadingRef = useRef<HTMLHeadingElement>(null);
  const editCampaignBtnRef = useRef<HTMLButtonElement>(null);

  const playerHeadingRef = useRef<HTMLHeadingElement>(null);
  const addPlayerBtnRef = useRef<HTMLButtonElement>(null);

  const addChapterBtnRef = useRef<HTMLButtonElement>(null);
  const chapterHeadingRef = useRef<HTMLHeadingElement>(null);

  const addAssetBtnRef = useRef<HTMLButtonElement>(null);
  const assetHeadingRef = useRef<HTMLHeadingElement>(null);

  const createEncounterBtnRef = useRef<HTMLButtonElement>(null);
  const assetViewerHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);

  const closeCampaignForm = useCallback(() => {
    setShowCampaignForm(false);
    setTimeout(() => {
      if (lastFocusedElement.current) {
        lastFocusedElement.current.focus();
        lastFocusedElement.current = null;
      } else {
        editCampaignBtnRef.current?.focus();
      }
    }, 0);
  }, []);

  const closePlayerForm = useCallback(() => {
    setShowPlayerForm(false);
    setEditingPlayerId(null);
    setPlayerName('');
    setPlayerDesc('');
    setTimeout(() => {
      if (lastFocusedElement.current) {
        lastFocusedElement.current.focus();
        lastFocusedElement.current = null;
      } else {
        addPlayerBtnRef.current?.focus();
      }
    }, 0);
  }, []);

  const closeChapterForm = useCallback(() => {
    setShowChapterForm(false);
    setEditingChapterId(null);
    setChapterTitle('');
    setChapterContent('');
    setTimeout(() => {
      if (lastFocusedElement.current) {
        lastFocusedElement.current.focus();
        lastFocusedElement.current = null;
      } else {
        addChapterBtnRef.current?.focus();
      }
    }, 0);
  }, []);

  const closeAssetForm = useCallback(() => {
    setShowAssetForm(false);
    setEditingAssetId(null);
    setAssetName('');
    setAssetDesc('');
    setAssetType('NPC');
    setTimeout(() => {
      if (lastFocusedElement.current) {
        lastFocusedElement.current.focus();
        lastFocusedElement.current = null;
      } else {
        addAssetBtnRef.current?.focus();
      }
    }, 0);
  }, []);

  const closeAssetViewer = useCallback(() => {
    setViewingAsset(null);
    setTimeout(() => lastFocusedElement.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (showCampaignForm) campaignHeadingRef.current?.focus();
  }, [showCampaignForm]);

  useEffect(() => {
    if (showPlayerForm) playerHeadingRef.current?.focus();
  }, [showPlayerForm]);

  useEffect(() => {
    if (showChapterForm) chapterHeadingRef.current?.focus();
  }, [showChapterForm]);

  useEffect(() => {
    if (showAssetForm) assetHeadingRef.current?.focus();
  }, [showAssetForm]);

  useEffect(() => {
    if (viewingAsset) {
      assetViewerHeadingRef.current?.focus();
    }
  }, [viewingAsset]);

  // Escape key handler for all modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (showCampaignForm) closeCampaignForm();
        else if (showPlayerForm) closePlayerForm();
        else if (showChapterForm) closeChapterForm();
        else if (showAssetForm) closeAssetForm();
        else if (viewingAsset) closeAssetViewer();
      }

      // Prevent default behavior for Enter and Space on non-interactive elements
      const target = e.target as HTMLElement;
      const isInteractive = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(target.tagName) || 
                          target.hasAttribute('onclick') || 
                          target.getAttribute('role') === 'button';
      
      if ((e.key === 'Enter' || e.key === ' ') && !isInteractive) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCampaignForm, showPlayerForm, showChapterForm, showAssetForm, viewingAsset, closeCampaignForm, closePlayerForm, closeChapterForm, closeAssetForm, closeAssetViewer]);

  const closeEncounterForm = () => {
    setIsCreatingEncounter(false);
    setEditingEncounter(null);
    setTimeout(() => createEncounterBtnRef.current?.focus(), 0);
  };

  const getAssetDisplayName = useCallback((asset: Asset) => {
    if (asset.type === 'NPC') {
      const monster = monsters.find(m => m.id === asset.id);
      if (monster) return monster.name;
    } else if (asset.type === 'Spell') {
      const spell = spells.find(s => s.id.toString() === asset.id);
      if (spell) return spell.name;
    }
    return asset.name;
  }, [monsters, spells]);

  const handleAddPlayer = () => {
    if (!activeCampaign || !playerName) return;
    
    let newPlayers;
    if (editingPlayerId) {
      newPlayers = activeCampaign.players.map(p => p.id === editingPlayerId ? { ...p, name: playerName, description: playerDesc } : p);
    } else {
      const newPlayer: PlayerCharacter = {
        id: crypto.randomUUID(),
        name: playerName,
        description: playerDesc
      };
      newPlayers = [...activeCampaign.players, newPlayer];
    }

    updateCampaign({
      ...activeCampaign,
      players: newPlayers
    });
    closePlayerForm();
  };

  const handleAddAsset = () => {
    if (!activeCampaign || !assetName) return;
    
    let newAssets;
    if (editingAssetId) {
      newAssets = activeCampaign.assets.map(a => a.id === editingAssetId ? { ...a, name: assetName, type: assetType, description: assetDesc } : a);
    } else {
      const newAsset: Asset = {
        id: crypto.randomUUID(),
        name: assetName,
        type: assetType,
        description: assetDesc
      };
      newAssets = [...activeCampaign.assets, newAsset];
    }

    updateCampaign({
      ...activeCampaign,
      assets: newAssets
    });
    closeAssetForm();
  };

  const handleAddChapter = () => {
    if (!activeCampaign || !chapterTitle) return;
    
    let newChapters;
    if (editingChapterId) {
      newChapters = activeCampaign.chapters.map(c => c.id === editingChapterId ? { ...c, title: chapterTitle, content: chapterContent } : c);
    } else {
      const newChapter: Chapter = {
        id: crypto.randomUUID(),
        title: chapterTitle,
        content: chapterContent,
        order: activeCampaign.chapters.length
      };
      newChapters = [...activeCampaign.chapters, newChapter];
    }

    updateCampaign({
      ...activeCampaign,
      chapters: newChapters
    });
    closeChapterForm();
  };

  const handleOpenSettings = () => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setShowCampaignForm(true);
  };

  const handleEditPlayer = useCallback((player: PlayerCharacter) => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setEditingPlayerId(player.id);
    setPlayerName(player.name);
    setPlayerDesc(player.description);
    setShowPlayerForm(true);
  }, []);

  const handleDeletePlayer = useCallback((id: string) => {
    if (!activeCampaign) return;
    if (confirm("Are you sure you want to delete this player character?")) {
      updateCampaign({
        ...activeCampaign,
        players: activeCampaign.players.filter(p => p.id !== id)
      });
    }
  }, [activeCampaign, updateCampaign]);

  const handleEditChapter = useCallback((chapter: Chapter) => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setEditingChapterId(chapter.id);
    setChapterTitle(chapter.title);
    setChapterContent(chapter.content);
    setShowChapterForm(true);
  }, []);

  const handleEditAsset = useCallback((asset: Asset) => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setEditingAssetId(asset.id);
    setAssetName(asset.name);
    setAssetType(asset.type);
    setAssetDesc(asset.description);
    setShowAssetForm(true);
  }, []);

  const handleDeleteEncounter = useCallback((id: string) => {
    if (!activeCampaign) return;
    if (confirm("Are you sure you want to delete this encounter?")) {
      updateCampaign({
        ...activeCampaign,
        encounters: activeCampaign.encounters.filter(e => e.id !== id)
      });
    }
  }, [activeCampaign, updateCampaign]);

  const handleAssetLinkClick = useCallback((id: string) => {
    const asset = activeCampaign?.assets.find(a => a.id === id);
    if (asset) {
      lastFocusedElement.current = document.activeElement as HTMLElement;
      setViewingAsset(asset);
    }
  }, [activeCampaign]);

  const handleEncounterLinkClick = useCallback((id: string) => {
    const encounter = activeCampaign?.encounters.find(e => e.id === id);
    if (encounter) {
      lastFocusedElement.current = document.activeElement as HTMLElement;
      setEditingEncounter(encounter);
    }
  }, [activeCampaign]);

  if (!activeCampaign) {
    return <p>Please select or create a campaign from the "Switch Campaign" menu in the header.</p>;
  }

  if (isCreatingEncounter || editingEncounter) {
    return (
      <EncounterBuilder 
        initialEncounter={editingEncounter}
        onClose={closeEncounterForm}
      />
    );
  }

  // Calculate global aria-hidden for the main content when modals are open
  const isAnyModalOpen = showCampaignForm || showPlayerForm || showChapterForm || showAssetForm || viewingAsset;

  return (
    <>
      <nav className="sub-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Campaign Builder</h2>
        <button type="button" ref={editCampaignBtnRef} onClick={handleOpenSettings}>Campaign Settings</button>
      </nav>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }} aria-hidden={!!isAnyModalOpen}>

        {/* Chapter Management */}
        <section style={{ flex: '1 1 300px' }}>
          <h3 id="chapters-heading">Manage Chapters</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
            {activeCampaign.chapters.map(c => (
              <li key={c.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button type="button"
                    data-fuzzer-category="chapter-expand"
                    aria-expanded={expandedChapterId === c.id}
                    aria-label={`${c.title}, ${expandedChapterId === c.id ? 'Expanded' : 'Collapsed'}`}
                    onClick={() => setExpandedChapterId(prev => prev === c.id ? null : c.id)}
                    style={{ flexGrow: 1, textAlign: 'left', fontWeight: 'bold', background: 'none', border: 'none', padding: '0.5rem', cursor: 'pointer' }}
                  >
                    <span aria-hidden="true">{expandedChapterId === c.id ? '▼' : '▶'}</span> {c.title}
                  </button>
                </div>
                {expandedChapterId === c.id && (
                  <div style={{ padding: '1rem', borderLeft: '2px solid #0066cc', marginTop: '0.5rem' }}>
                    <div style={{ marginBottom: '1rem' }}>
                      <button type="button" data-fuzzer-category="chapter-edit" onClick={() => handleEditChapter(c)}>Edit Chapter</button>
                    </div>
                    <Markdown 
                      content={c.content} 
                      onAssetClick={handleAssetLinkClick} 
                      onEncounterClick={handleEncounterLinkClick} 
                      baseHeadingLevel={3} 
                    />
                  </div>
                )}
              </li>
            ))}
            {activeCampaign.chapters.length === 0 && <li>No chapters written yet.</li>}
          </ul>
          <button type="button" ref={addChapterBtnRef} onClick={() => setShowChapterForm(true)}>+ Add Chapter</button>
        </section>

        {/* Asset Management */}
        <section style={{ flex: '1 1 300px' }}>
          <h3 id="assets-heading">Manage Assets</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
            {(() => {
              const uniqueAssets = Array.from(new Map(activeCampaign.assets.map(a => [a.id, a])).values());
              return uniqueAssets.map(a => {
                const displayName = getAssetDisplayName(a);
                return (
                  <li key={a.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button type="button"
                        data-fuzzer-category="asset-expand"
                        aria-expanded={expandedAssetId === a.id}
                        aria-label={`${displayName} (${a.type}), ${expandedAssetId === a.id ? 'Expanded' : 'Collapsed'}`}
                        onClick={() => setExpandedAssetId(prev => prev === a.id ? null : a.id)}
                        style={{ width: '100%', textAlign: 'left', fontWeight: 'bold', background: 'none', border: 'none', padding: '0.5rem', cursor: 'pointer' }}
                      >
                        <span aria-hidden="true">{expandedAssetId === a.id ? '▼' : '▶'}</span> {displayName} ({a.type})
                      </button>
                    </div>
                    {expandedAssetId === a.id && (
                      <div style={{ padding: '1rem', borderLeft: '2px solid #0066cc', marginTop: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                          {/* eslint-disable-next-line react-hooks/refs */}
                          <button type="button" data-fuzzer-category="asset-edit" onClick={() => handleEditAsset(a)}>Edit Asset</button>
                          <button type="button" data-fuzzer-category="asset-view" onClick={() => handleAssetLinkClick(a.id)}>View Details</button>
                        </div>
                        {!a.description.startsWith('Scraped') && (
                          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{a.description}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              });
            })()}
            {activeCampaign.assets.length === 0 && <li>No assets created yet.</li>}
          </ul>
          <button type="button" ref={addAssetBtnRef} onClick={() => setShowAssetForm(true)}>+ Add Asset</button>
        </section>

        {/* Encounter Management */}
        <section style={{ flex: '1 1 100%' }}>
          <h3 id="encounters-heading">Manage Encounters</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
            {activeCampaign.encounters.map(e => (
              <li key={e.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <strong style={{ flexGrow: 1 }}>{e.name} ({e.units.length} units)</strong>
                <button type="button" data-fuzzer-category="encounter-edit" onClick={() => setEditingEncounter(e)}>Edit</button>
                <button type="button" data-fuzzer-category="encounter-delete" onClick={() => handleDeleteEncounter(e.id)}>Delete</button>
              </li>
            ))}
            {activeCampaign.encounters.length === 0 && <li>No encounters created yet.</li>}
          </ul>
          <button type="button" ref={createEncounterBtnRef} onClick={() => setIsCreatingEncounter(true)}>+ Create Encounter</button>
        </section>
      </div>

      {/* Chapter Form Modal */}
      {showChapterForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="chapter-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '600px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column'
          }}>
            <h2 id="chapter-modal-title" ref={chapterHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {editingChapterId ? 'Edit Chapter' : 'Add New Chapter'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flexGrow: 1 }}>
              <div>
                <label htmlFor="chap-title" style={{ display: 'block', fontWeight: 'bold' }}>Chapter Title</label>
                <input 
                  id="chap-title"
                  value={chapterTitle}
                  onChange={e => setChapterTitle(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="chap-content" style={{ display: 'block', fontWeight: 'bold' }}>Story Text</label>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#666' }}>Use # for headings and @Asset[id]{`{Name}`} to link assets.</p>
                <textarea 
                  id="chap-content"
                  value={chapterContent}
                  onChange={e => setChapterContent(e.target.value)}
                  style={{ width: '100%', flexGrow: 1, minHeight: '200px', padding: '0.5rem', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={handleAddChapter} disabled={!chapterTitle} style={{ flex: 1, fontWeight: 'bold' }}>Save</button>
                <button type="button" onClick={closeChapterForm} style={{ flex: 1 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Asset Form Modal */}
      {showAssetForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            <h2 id="asset-modal-title" ref={assetHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {editingAssetId ? 'Edit Asset' : 'Add New Asset'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="asset-name" style={{ display: 'block', fontWeight: 'bold' }}>Asset Name</label>
                <input 
                  id="asset-name"
                  placeholder="e.g. King Bruenor"
                  value={assetName}
                  onChange={e => setAssetName(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="asset-type" style={{ display: 'block', fontWeight: 'bold' }}>Asset Type</label>
                <select 
                  id="asset-type"
                  value={assetType} 
                  onChange={e => setAssetType(e.target.value as AssetType)}
                  style={{ width: '100%', padding: '0.5rem' }}
                >
                  <option value="NPC">NPC</option>
                  <option value="PC">PC</option>
                  <option value="Location">Location</option>
                  <option value="Item">Item</option>
                  <option value="Spell">Spell</option>
                </select>
              </div>
              <div>
                <label htmlFor="asset-desc" style={{ display: 'block', fontWeight: 'bold' }}>Description / Notes</label>
                <textarea 
                  id="asset-desc"
                  value={assetDesc}
                  onChange={e => setAssetDesc(e.target.value)}
                  rows={5}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={handleAddAsset} disabled={!assetName} style={{ flex: 1, fontWeight: 'bold' }}>Save</button>
                <button type="button" onClick={closeAssetForm} style={{ flex: 1 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Form Modal */}
      {showCampaignForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="campaign-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <h2 id="campaign-modal-title" ref={campaignHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              Campaign Settings
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="camp-name" style={{ display: 'block', fontWeight: 'bold' }}>Campaign Name</label>
                <input 
                  id="camp-name"
                  value={activeCampaign.name}
                  onChange={e => updateCampaign({ ...activeCampaign, name: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="camp-desc" style={{ display: 'block', fontWeight: 'bold' }}>Description</label>
                <textarea 
                  id="camp-desc"
                  value={activeCampaign.description}
                  onChange={e => updateCampaign({ ...activeCampaign, description: e.target.value })}
                  rows={3}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>

              {/* Player Management */}
              <section style={{ marginTop: '1rem' }}>
                <h4 id="players-heading" style={{ margin: '0 0 0.5rem 0' }}>Manage Players</h4>
                <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
                  {activeCampaign.players.map(p => (
                    <li key={p.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{p.name}</strong>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>{p.description}</p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="button" data-fuzzer-category="player-edit" onClick={() => handleEditPlayer(p)}>Edit</button>
                        <button type="button" data-fuzzer-category="player-delete" onClick={() => handleDeletePlayer(p.id)}>Delete</button>
                      </div>
                    </li>
                  ))}
                  {activeCampaign.players.length === 0 && <li>No players configured yet.</li>}
                </ul>
                <button type="button" ref={addPlayerBtnRef} onClick={() => setShowPlayerForm(true)}>+ Add Player</button>
              </section>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={closeCampaignForm} style={{ flex: 1 }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Player Form Modal */}
      {showPlayerForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="player-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '500px', width: '90%'
          }}>
            <h2 id="player-modal-title" ref={playerHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {editingPlayerId ? 'Edit Player' : 'Add New Player'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="player-name" style={{ display: 'block', fontWeight: 'bold' }}>Player Name</label>
                <input 
                  id="player-name"
                  value={playerName}
                  onChange={e => setPlayerName(e.target.value)}
                  placeholder="e.g. Grog"
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="player-desc" style={{ display: 'block', fontWeight: 'bold' }}>Description / Class</label>
                <input 
                  id="player-desc"
                  value={playerDesc}
                  onChange={e => setPlayerDesc(e.target.value)}
                  placeholder="e.g. Goliath Barbarian"
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={handleAddPlayer} disabled={!playerName} style={{ flex: 1, fontWeight: 'bold' }}>Save</button>
                <button type="button" onClick={closePlayerForm} style={{ flex: 1 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Asset Viewer Modal (for links in preview) */}
      {viewingAsset && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="asset-viewer-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            {(() => {
              let matchedMonster = monsters.find(m => m.id === viewingAsset.id);
              if (!matchedMonster) {
                matchedMonster = monsters.find(m => m.name.toLowerCase() === viewingAsset.name.toLowerCase());
              }
              if (matchedMonster) {
                return (
                  <div>
                    <h2 id="asset-viewer-title" ref={assetViewerHeadingRef} tabIndex={-1} className="sr-only">
                      Monster Details: {matchedMonster.name}
                    </h2>
                    <MonsterDetails monster={matchedMonster} />
                  </div>
                );
              }

              let matchedSpell = spells.find(s => s.id.toString() === viewingAsset.id);
              if (!matchedSpell) {
                matchedSpell = spells.find(s => s.name.toLowerCase() === viewingAsset.name.toLowerCase());
              }
              if (matchedSpell) {
                return (
                  <div>
                    <SpellDetail spell={matchedSpell} id="asset-viewer-title" />
                  </div>
                );
              }

              return (
                <>
                  <h2 id="asset-viewer-title" ref={assetViewerHeadingRef} tabIndex={-1} style={{ outline: 'none', marginBottom: '0.5rem' }}>
                    {viewingAsset.name} ({viewingAsset.type})
                  </h2>
                  <div style={{ marginTop: '1rem' }}>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{viewingAsset.description}</p>
                  </div>
                </>
              );
            })()}

            <button type="button" onClick={closeAssetViewer} style={{ marginTop: '2rem', width: '100%', padding: '0.5rem' }}>
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </>
  );
}
