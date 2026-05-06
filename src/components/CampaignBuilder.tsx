import { useState, useRef, useEffect } from 'react';
import { useCampaigns } from '../context/CampaignContext';
import { EncounterBuilder } from './EncounterBuilder';
import { parseMarkdown } from '../utils/markdownParser';
import type { AssetType, Asset, Chapter, Encounter } from '../types';

export function CampaignBuilder() {
  const { activeCampaign, updateCampaign } = useCampaigns();
  
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
  const addChapterBtnRef = useRef<HTMLButtonElement>(null);
  const chapterHeadingRef = useRef<HTMLHeadingElement>(null);
  const chapterTitleInputRef = useRef<HTMLInputElement>(null);

  const addAssetBtnRef = useRef<HTMLButtonElement>(null);
  const assetHeadingRef = useRef<HTMLHeadingElement>(null);
  const assetNameInputRef = useRef<HTMLInputElement>(null);

  const createEncounterBtnRef = useRef<HTMLButtonElement>(null);
  const assetViewerHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (showChapterForm) chapterTitleInputRef.current?.focus();
  }, [showChapterForm]);

  useEffect(() => {
    if (showAssetForm) assetNameInputRef.current?.focus();
  }, [showAssetForm]);

  useEffect(() => {
    if (viewingAsset) {
      assetViewerHeadingRef.current?.focus();
    }
  }, [viewingAsset]);

  // Escape key handler for all modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showChapterForm) closeChapterForm();
        else if (showAssetForm) closeAssetForm();
        else if (viewingAsset) closeAssetViewer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showChapterForm, showAssetForm, viewingAsset]);

  const closeChapterForm = () => {
    setShowChapterForm(false);
    setEditingChapterId(null);
    setChapterTitle('');
    setChapterContent('');
    setTimeout(() => addChapterBtnRef.current?.focus(), 0);
  };

  const closeAssetForm = () => {
    setShowAssetForm(false);
    setEditingAssetId(null);
    setAssetName('');
    setAssetDesc('');
    setAssetType('NPC');
    setTimeout(() => addAssetBtnRef.current?.focus(), 0);
  };

  const closeEncounterForm = () => {
    setIsCreatingEncounter(false);
    setEditingEncounter(null);
    setTimeout(() => createEncounterBtnRef.current?.focus(), 0);
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

  const handleEditChapter = (chapter: Chapter) => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setEditingChapterId(chapter.id);
    setChapterTitle(chapter.title);
    setChapterContent(chapter.content);
    setShowChapterForm(true);
  };

  const handleEditAsset = (asset: Asset) => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setEditingAssetId(asset.id);
    setAssetName(asset.name);
    setAssetType(asset.type);
    setAssetDesc(asset.description);
    setShowAssetForm(true);
  };

  const handleDeleteEncounter = (id: string) => {
    if (!activeCampaign) return;
    if (confirm("Are you sure you want to delete this encounter?")) {
      updateCampaign({
        ...activeCampaign,
        encounters: activeCampaign.encounters.filter(e => e.id !== id)
      });
    }
  };

  const handleAssetLinkClick = (id: string) => {
    const asset = activeCampaign?.assets.find(a => a.id === id);
    if (asset) {
      lastFocusedElement.current = document.activeElement as HTMLElement;
      setViewingAsset(asset);
    }
  };

  const handleEncounterLinkClick = (id: string) => {
    const encounter = activeCampaign?.encounters.find(e => e.id === id);
    if (encounter) {
      lastFocusedElement.current = document.activeElement as HTMLElement;
      setEditingEncounter(encounter);
    }
  };

  const closeAssetViewer = () => {
    setViewingAsset(null);
    setTimeout(() => lastFocusedElement.current?.focus(), 0);
  };

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
  const isAnyModalOpen = showChapterForm || showAssetForm || viewingAsset;

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }} aria-hidden={!!isAnyModalOpen}>
        
        {/* Chapter Management */}
        <section style={{ flex: '1 1 300px' }}>
          <h3 id="chapters-heading">Manage Chapters</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
            {activeCampaign.chapters.map(c => (
              <li key={c.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    aria-expanded={expandedChapterId === c.id}
                    aria-label={`${c.title}, ${expandedChapterId === c.id ? 'Expanded' : 'Collapsed'}`}
                    onClick={() => setExpandedChapterId(prev => prev === c.id ? null : c.id)}
                    style={{ flexGrow: 1, textAlign: 'left', fontWeight: 'bold', background: 'none', border: 'none', padding: '0.5rem', cursor: 'pointer' }}
                  >
                    <span aria-hidden="true">{expandedChapterId === c.id ? '▼' : '▶'}</span> {c.title}
                  </button>
                  <button onClick={() => handleEditChapter(c)} style={{ marginLeft: '0.5rem' }}>Edit</button>
                </div>
                {expandedChapterId === c.id && (
                  <div style={{ padding: '1rem', borderLeft: '2px solid #0066cc', marginTop: '0.5rem' }}>
                    {parseMarkdown(c.content, handleAssetLinkClick, handleEncounterLinkClick, 4)}
                  </div>
                )}
              </li>
            ))}
            {activeCampaign.chapters.length === 0 && <li>No chapters written yet.</li>}
          </ul>
          <button ref={addChapterBtnRef} onClick={() => setShowChapterForm(true)}>+ Add Chapter</button>
        </section>

        {/* Asset Management */}
        <section style={{ flex: '1 1 300px' }}>
          <h3 id="assets-heading">Manage Assets</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
            {activeCampaign.assets.map(a => (
              <li key={a.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    aria-expanded={expandedAssetId === a.id}
                    aria-label={`${a.name} (${a.type}), ${expandedAssetId === a.id ? 'Expanded' : 'Collapsed'}`}
                    onClick={() => setExpandedAssetId(prev => prev === a.id ? null : a.id)}
                    style={{ width: '100%', textAlign: 'left', fontWeight: 'bold', background: 'none', border: 'none', padding: '0.5rem', cursor: 'pointer' }}
                  >
                    <span aria-hidden="true">{expandedAssetId === a.id ? '▼' : '▶'}</span> {a.name} ({a.type})
                  </button>
                  <button onClick={() => handleEditAsset(a)} style={{ marginLeft: '0.5rem' }}>Edit</button>
                </div>
                {expandedAssetId === a.id && (
                  <div style={{ padding: '1rem', borderLeft: '2px solid #0066cc', marginTop: '0.5rem' }}>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#666' }}>ID: {a.id}</p>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{a.description}</p>
                  </div>
                )}
              </li>
            ))}
            {activeCampaign.assets.length === 0 && <li>No assets created yet.</li>}
          </ul>
          <button ref={addAssetBtnRef} onClick={() => setShowAssetForm(true)}>+ Add Asset</button>
        </section>

        {/* Encounter Management */}
        <section style={{ flex: '1 1 100%' }}>
          <h3 id="encounters-heading">Manage Encounters</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
            {activeCampaign.encounters.map(e => (
              <li key={e.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <strong style={{ flexGrow: 1 }}>{e.name} ({e.units.length} units)</strong>
                <button onClick={() => setEditingEncounter(e)}>Edit</button>
                <button onClick={() => handleDeleteEncounter(e.id)}>Delete</button>
              </li>
            ))}
            {activeCampaign.encounters.length === 0 && <li>No encounters created yet.</li>}
          </ul>
          <button ref={createEncounterBtnRef} onClick={() => setIsCreatingEncounter(true)}>+ Create Encounter</button>
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
            <h3 id="chapter-modal-title" ref={chapterHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {editingChapterId ? 'Edit Chapter' : 'Add New Chapter'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flexGrow: 1 }}>
              <div>
                <label htmlFor="chap-title" style={{ display: 'block', fontWeight: 'bold' }}>Chapter Title</label>
                <input 
                  id="chap-title"
                  ref={chapterTitleInputRef}
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
                <button onClick={handleAddChapter} disabled={!chapterTitle} style={{ flex: 1, fontWeight: 'bold' }}>Save</button>
                <button onClick={closeChapterForm} style={{ flex: 1 }}>Cancel</button>
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
            <h3 id="asset-modal-title" ref={assetHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {editingAssetId ? 'Edit Asset' : 'Add New Asset'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="asset-name" style={{ display: 'block', fontWeight: 'bold' }}>Asset Name</label>
                <input 
                  id="asset-name"
                  ref={assetNameInputRef}
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
                <button onClick={handleAddAsset} disabled={!assetName} style={{ flex: 1, fontWeight: 'bold' }}>Save</button>
                <button onClick={closeAssetForm} style={{ flex: 1 }}>Cancel</button>
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
            <h3 id="asset-viewer-title" ref={assetViewerHeadingRef} tabIndex={-1} style={{ outline: 'none', marginBottom: '0.5rem' }}>
              {viewingAsset.name} ({viewingAsset.type})
            </h3>
            <div style={{ marginTop: '1rem' }}>
              <p style={{ whiteSpace: 'pre-wrap' }}>{viewingAsset.description}</p>
            </div>
            <button onClick={closeAssetViewer} style={{ marginTop: '2rem', width: '100%', padding: '0.5rem' }}>
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </>
  );
}
