import { useState, useRef, useEffect, useCallback } from 'react';
import { useCampaigns } from '../context/CampaignContext';
import { useWorlds } from '../context/WorldContext';
import { Markdown } from './Markdown';
import type { Asset, Monster, Spell, MagicItem } from '../types';
import { MonsterDetails } from './MonsterDetails';
import { SpellDetail } from './SpellBrowser';
import { MagicItemDetail } from './MagicItemBrowser';
import { dataService } from '../services/DataService';

export function CampaignRunner() {
  const { activeCampaign } = useCampaigns();
  const { activeWorld } = useWorlds();
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [magicItems, setMagicItems] = useState<MagicItem[]>([]);

  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    dataService.getAllMonsters().then(setMonsters);
    dataService.getAllSpells().then(setSpells);
    dataService.getAllMagicItems().then(setMagicItems);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedAsset(null);
    setTimeout(() => {
      lastFocusedElement.current?.focus();
    }, 0);
  }, []);

  const handleAssetClick = useCallback((assetId: string) => {
    const asset = activeCampaign?.assets.find(a => a.id === assetId);
    if (asset) {
      lastFocusedElement.current = document.activeElement as HTMLElement;
      setSelectedAsset(asset);
      setIsModalOpen(true);
    } else {
      alert(`Asset not found: ${assetId}`);
    }
  }, [activeCampaign]);

  const runnerHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    runnerHeadingRef.current?.focus();
  }, []);

  // Focus management and escape key
  useEffect(() => {
    if (isModalOpen && selectedAsset) {
      modalHeadingRef.current?.focus();
    }
  }, [isModalOpen, selectedAsset]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default behavior for Enter and Space on non-interactive elements
      const target = e.target as HTMLElement;
      const isInteractive = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(target.tagName) || 
                          target.hasAttribute('onclick') || 
                          target.getAttribute('role') === 'button';
      
      if ((e.key === 'Enter' || e.key === ' ') && !isInteractive) {
        e.preventDefault();
      }

      if (e.key === 'Escape' && !e.defaultPrevented && isModalOpen) {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, closeModal]);

  if (!activeCampaign) {
    return <p>No active campaign selected. Go to Create Mode to select one.</p>;
  }

  const currentChapterId = activeChapterId || (activeCampaign.chapters.length > 0 ? activeCampaign.chapters[0].id : null);
  const activeChapter = activeCampaign.chapters.find(c => c.id === currentChapterId);

  return (
    <div >
      <h2 ref={runnerHeadingRef} tabIndex={-1} style={{ outline: 'none' }} className="sr-only">Story Chapters</h2>
      <div style={{ display: 'flex', gap: '2rem' }}>
        {/* Navigation Sidebar */}
        <div style={{ flex: '0 0 200px', borderRight: '1px solid #ccc', paddingRight: '1rem' }}>
          <label htmlFor="chapter-select" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Chapters</label>
          {activeCampaign.chapters.length === 0 ? (
            <p>No chapters written.</p>
          ) : (
            <select 
              id="chapter-select"
              value={currentChapterId || ''} 
              onChange={(e) => setActiveChapterId(e.target.value)}
              style={{ width: '100%', padding: '0.5rem' }}
            >
              {activeCampaign.chapters.sort((a, b) => a.order - b.order).map(chap => (
                <option key={chap.id} value={chap.id}>
                  {chap.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Main Content Area */}
        <div style={{ flex: 1 }}>
          {activeChapter ? (
            <div>
              <h3 style={{ marginTop: 0 }}>{activeChapter.title}</h3>
              <div style={{ marginTop: '1rem' }}>
                <Markdown 
                  content={activeChapter.content} 
                  onAssetClick={handleAssetClick} 
                  baseHeadingLevel={1} 
                />
              </div>

              <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #eee', display: 'flex', gap: '2rem' }}>
                <div style={{ flex: 1 }}>
                  <h4>Chapter Assets</h4>
                  {activeCampaign.assets.filter(a => a.chapterIds?.includes(activeChapter.id)).length === 0 ? (
                    <p>No assets linked to this chapter.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {activeCampaign.assets.filter(a => a.chapterIds?.includes(activeChapter.id)).map(asset => (
                        <li key={asset.id} style={{ marginBottom: '0.5rem' }}>
                          <button type="button" onClick={() => handleAssetClick(asset.id)}>
                            {asset.name} ({asset.type})
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <h4>Chapter Encounters</h4>
                  {activeCampaign.encounters.filter(e => e.chapterIds?.includes(activeChapter.id)).length === 0 ? (
                    <p>No encounters linked to this chapter.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {activeCampaign.encounters.filter(e => e.chapterIds?.includes(activeChapter.id)).map(enc => (
                        <li key={enc.id} style={{ marginBottom: '0.5rem' }}>
                          <a 
                            href={`/?encounter=${enc.id}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ 
                              display: 'inline-block',
                              padding: '0.5rem 1rem',
                              backgroundColor: '#eee',
                              color: '#333',
                              textDecoration: 'none',
                              borderRadius: '4px',
                              fontWeight: 'bold'
                            }}
                          >
                            Run {enc.name}
                            <span className="sr-only"> (opens in new tab)</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p>Select a chapter to begin.</p>
          )}
        </div>
      </div>

      {/* Asset Modal */}
      {isModalOpen && selectedAsset && (
        <div className="asset-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="asset-modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            {(() => {
              const worldAsset = selectedAsset.worldAssetId && activeWorld 
                ? activeWorld.assets.find(wa => wa.id === selectedAsset.worldAssetId)
                : undefined;

              const getIncomingConnections = (assetId: string) => {
                const incoming: { sourceAsset: any, relationship: string }[] = [];
                if (activeWorld) {
                  activeWorld.assets.forEach(as => {
                    as.connections.forEach(conn => {
                      if (conn.targetId === assetId) {
                        incoming.push({ sourceAsset: as, relationship: conn.relationship });
                      }
                    });
                  });
                }
                return incoming;
              };
              const incomingConns = worldAsset ? getIncomingConnections(worldAsset.id) : [];

              let detailContent = null;
              let matchedMonster = dataService.getMonsterByIdSync(selectedAsset.id);
              if (!matchedMonster) {
                matchedMonster = monsters.find(m => m.name.toLowerCase() === selectedAsset.name.toLowerCase()) || null;
              }
              if (matchedMonster) {
                detailContent = (
                  <div>
                    <h3 id="asset-modal-title" ref={modalHeadingRef} tabIndex={-1} className="sr-only">
                      Monster Details: {matchedMonster.name}
                    </h3>
                    <MonsterDetails monster={matchedMonster} />
                  </div>
                );
              } else {
                let matchedSpell = dataService.getSpellByIdSync(selectedAsset.id);
                if (!matchedSpell) {
                  matchedSpell = spells.find(s => s.name.toLowerCase() === selectedAsset.name.toLowerCase()) || null;
                }
                if (matchedSpell) {
                  detailContent = (
                    <div>
                      <SpellDetail spell={matchedSpell} id="asset-modal-title" />
                    </div>
                  );
                } else {
                  let matchedMagicItem = magicItems.find(mi => mi.id === selectedAsset.id);
                  if (!matchedMagicItem) {
                    matchedMagicItem = magicItems.find(mi => mi.name.toLowerCase() === selectedAsset.name.toLowerCase());
                  }
                  if (matchedMagicItem) {
                    detailContent = (
                      <div>
                        <MagicItemDetail magicItem={matchedMagicItem} id="asset-modal-title" onAssetClick={handleAssetClick} />
                      </div>
                    );
                  } else {
                    detailContent = (
                      <>
                        <h3 id="asset-modal-title" ref={modalHeadingRef} tabIndex={-1} style={{ outline: 'none', marginBottom: '0.5rem' }}>
                          {selectedAsset.name} ({selectedAsset.type})
                        </h3>
                        <div style={{ marginTop: '1rem' }}>
                          <p style={{ whiteSpace: 'pre-wrap' }}>{selectedAsset.description}</p>
                        </div>
                      </>
                    );
                  }
                }
              }

              return (
                <>
                  {detailContent}
                  {worldAsset && (
                    <section aria-labelledby="world-context-heading" style={{ marginTop: '2rem', borderTop: '2px solid #ccc', paddingTop: '1.5rem' }}>
                      <h3 id="world-context-heading" style={{ marginTop: 0 }}>World Context</h3>
                      <p><strong>Type:</strong> {worldAsset.type}</p>
                      {worldAsset.tags.length > 0 && (
                        <p><strong>Tags:</strong> {worldAsset.tags.join(', ')}</p>
                      )}
                      <h4>Connections</h4>
                      {worldAsset.connections.length === 0 && incomingConns.length === 0 ? (
                        <p>No connections recorded.</p>
                      ) : (
                        <ul aria-label={`Connections for ${worldAsset.name}`} style={{ paddingLeft: '1.25rem' }}>
                          {worldAsset.connections.map(conn => {
                            const target = activeWorld?.assets.find(t => t.id === conn.targetId);
                            return (
                              <li key={conn.id}>
                                "{conn.relationship}" → <strong>{target ? `${target.name} (${target.type})` : 'Unknown Asset'}</strong>
                              </li>
                            );
                          })}
                          {incomingConns.map(({ sourceAsset, relationship }, idx) => (
                            <li key={idx}>
                              <strong>{sourceAsset.name} ({sourceAsset.type})</strong> "{relationship}" → this
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}
                </>
              );
            })()}

            <button type="button" onClick={closeModal} style={{ marginTop: '2rem', width: '100%', padding: '0.5rem' }}>
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
