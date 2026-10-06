import { useState, useRef, useEffect, useCallback } from 'react';
import { useCampaigns } from '../context/CampaignContext';
import { useWorlds } from '../context/WorldContext';
import { Markdown } from './Markdown';
import type { WorldAsset } from '../types';
import { MonsterDetails } from './MonsterDetails';
import { SpellDetail } from './SpellBrowser';
import { MagicItemDetail } from './MagicItemBrowser';
import { dataService } from '../services/DataService';
import { isInteractiveTarget } from './uiHelpers';
import { DisclosureSelect } from './DisclosureSelect';
import { useAssistantScreen } from '../context/AssistantScreenContext';

export function CampaignRunner() {
  const { activeCampaign, activeChapterId, setActiveChapterId } = useCampaigns();
  const { activeWorld } = useWorlds();
  useAssistantScreen('run.story');
  const [selectedAsset, setSelectedAsset] = useState<{ id: string; tagType: string; name?: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedAsset(null);
    setTimeout(() => {
      lastFocusedElement.current?.focus();
    }, 0);
  }, []);

  const handleAssetClick = useCallback((assetId: string, tagType: string) => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setSelectedAsset({ id: assetId, tagType });
    setIsModalOpen(true);
  }, []);

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
      if ((e.key === 'Enter' || e.key === ' ') && !isInteractiveTarget(e.target)) {
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

  const currentChapterId = (activeChapterId && activeCampaign.chapters.some(c => c.id === activeChapterId))
    ? activeChapterId
    : (activeCampaign.chapters.length > 0 ? activeCampaign.chapters[0].id : null);
  const activeChapter = activeCampaign.chapters.find(c => c.id === currentChapterId);

  const getChapterAssets = (content: string, chapterId: string) => {
    const regex = /@(Spell|Monster|Item|World|Campaign)\[([^\]]+)\](?:\{([^}]+)\})?/g;
    const assetsMap = new Map<string, { id: string; tagType: string; name: string }>();
    let match;
    while ((match = regex.exec(content)) !== null) {
      const tagType = match[1];
      const id = match[2];
      const key = `${tagType}-${id}`;
      if (!assetsMap.has(key)) {
        let name = match[3] || '';
        if (!name) {
          if (tagType === 'Monster') {
            name = dataService.getMonsterByIdSync(id)?.name || id;
          } else if (tagType === 'Spell') {
            name = dataService.getSpellByIdSync(id)?.name || id;
          } else if (tagType === 'Item') {
            name = dataService.getMagicItemByIdSync(id)?.name || id;
          } else if (tagType === 'Campaign') {
            name = activeCampaign.assets.find(a => a.id === id)?.name || id;
          } else if (tagType === 'World') {
            name = activeWorld?.assets.find(a => a.id === id)?.name || id;
          } else {
            name = id;
          }
        }
        assetsMap.set(key, { id, tagType, name });
      }
    }

    if (chapterId) {
      activeCampaign.assets.filter(a => a.chapterIds?.includes(chapterId)).forEach(a => {
        const key = `Campaign-${a.id}`;
        if (!assetsMap.has(key)) {
          let name = a.name;
          if (a.worldAssetId && activeWorld) {
            const worldAsset = activeWorld.assets.find(wa => wa.id === a.worldAssetId);
            if (worldAsset) name = worldAsset.name;
          }
          assetsMap.set(key, { id: a.id, tagType: 'Campaign', name });
        }
      });
    }

    return Array.from(assetsMap.values());
  };

  return (
    <div >
      <h2 ref={runnerHeadingRef} tabIndex={-1} style={{ outline: 'none' }} className="sr-only">Run Mode</h2>
      <div style={{ display: 'flex', gap: '2rem' }}>
        {/* Navigation Sidebar */}
        <div style={{ flex: '0 0 200px', borderRight: '1px solid #ccc', paddingRight: '1rem' }}>
          {activeCampaign.chapters.length === 0 ? (
            <p>No chapters written.</p>
          ) : (
            <DisclosureSelect
              id="chapter-select"
              label="Chapter"
              value={currentChapterId || ''}
              options={[...activeCampaign.chapters].sort((a, b) => a.order - b.order).map(chap => ({ value: chap.id, label: chap.title }))}
              onChange={setActiveChapterId}
              buttonStyle={{ width: '100%', padding: '0.5rem' }}
            />
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
                  baseHeadingLevel={4} 
                />
              </div>

              <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #eee', display: 'flex', gap: '2rem' }}>
                <div style={{ flex: 1 }}>
                  <h3>Chapter Assets</h3>
                  {getChapterAssets(activeChapter.content, activeChapter.id).length === 0 ? (
                    <p>No assets linked to this chapter.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {getChapterAssets(activeChapter.content, activeChapter.id).map(asset => (
                        <li key={`${asset.tagType}-${asset.id}`} style={{ marginBottom: '0.5rem' }}>
                          <button type="button" onClick={() => handleAssetClick(asset.id, asset.tagType)}>
                            {asset.name} ({asset.tagType})
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <h3>Chapter Encounters</h3>
                  {activeCampaign.encounters.filter(e => e.chapterIds?.includes(activeChapter.id)).length === 0 ? (
                    <p>No encounters linked to this chapter.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {activeCampaign.encounters.filter(e => e.chapterIds?.includes(activeChapter.id)).map(enc => (
                        <li key={enc.id} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
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
                          {(enc.dmMapUrl || enc.playerMapUrl) && (
                            <span 
                              style={{ 
                                fontSize: '0.8rem', 
                                backgroundColor: '#6f42c1', 
                                color: '#fff', 
                                padding: '0.2rem 0.5rem', 
                                borderRadius: '4px',
                                fontWeight: 'bold'
                              }}
                            >
                              Map Available
                            </span>
                          )}
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
              const worldAsset = selectedAsset.tagType === 'World' && activeWorld 
                ? activeWorld.assets.find(wa => wa.id === selectedAsset.id)
                : undefined;

              const getIncomingConnections = (assetId: string) => {
                const incoming: { sourceAsset: WorldAsset, relationship: string }[] = [];
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

              let detailContent: React.ReactNode;
              
              if (selectedAsset.tagType === 'Monster') {
                const matchedMonster = dataService.getMonsterByIdSync(selectedAsset.id);
                if (matchedMonster) {
                  detailContent = (
                    <div>
                      <h3 id="asset-modal-title" ref={modalHeadingRef} tabIndex={-1} className="sr-only">
                        Monster Details: {matchedMonster.name}
                      </h3>
                      <MonsterDetails monster={matchedMonster} />
                    </div>
                  );
                }
              } else if (selectedAsset.tagType === 'Spell') {
                const matchedSpell = dataService.getSpellByIdSync(selectedAsset.id);
                if (matchedSpell) {
                  detailContent = (
                    <div>
                      <SpellDetail spell={matchedSpell} id="asset-modal-title" />
                    </div>
                  );
                }
              } else if (selectedAsset.tagType === 'Item') {
                const matchedMagicItem = dataService.getMagicItemByIdSync(selectedAsset.id);
                if (matchedMagicItem) {
                  detailContent = (
                    <div>
                      <MagicItemDetail magicItem={matchedMagicItem} id="asset-modal-title" onAssetClick={handleAssetClick} />
                    </div>
                  );
                }
              } else if (selectedAsset.tagType === 'Campaign') {
                const asset = activeCampaign.assets.find(a => a.id === selectedAsset.id);
                if (asset) {
                  detailContent = (
                    <>
                      <h3 id="asset-modal-title" ref={modalHeadingRef} tabIndex={-1} style={{ outline: 'none', marginBottom: '0.5rem' }}>
                        {asset.name} ({asset.type})
                      </h3>
                      <div style={{ marginTop: '1rem' }}>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{asset.description}</p>
                      </div>
                    </>
                  );
                }
              } else if (selectedAsset.tagType === 'World' && worldAsset) {
                detailContent = (
                  <>
                    <h3 id="asset-modal-title" ref={modalHeadingRef} tabIndex={-1} style={{ outline: 'none', marginBottom: '0.5rem' }}>
                      {worldAsset.name} ({worldAsset.type})
                    </h3>
                    <div style={{ marginTop: '1rem' }}>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{worldAsset.description}</p>
                    </div>
                  </>
                );
              }

              if (!detailContent) {
                detailContent = <p>Asset details not found.</p>;
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
