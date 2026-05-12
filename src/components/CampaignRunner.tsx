import { useState, useRef, useEffect } from 'react';
import { useCampaigns } from '../context/CampaignContext';
import { parseMarkdown } from '../utils/markdownParser';
import type { Asset } from '../types';

export function CampaignRunner({ onGoToEncounter }: { onGoToEncounter?: (id: string) => void }) {
  const { activeCampaign } = useCampaigns();
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);

  // Set the first chapter as active when a campaign is loaded
  useEffect(() => {
    if (activeCampaign && activeCampaign.chapters.length > 0 && !activeChapterId) {
      setActiveChapterId(activeCampaign.chapters[0].id);
    }
  }, [activeCampaign, activeChapterId]);

  const handleAssetClick = (assetId: string) => {
    const asset = activeCampaign?.assets.find(a => a.id === assetId);
    if (asset) {
      lastFocusedElement.current = document.activeElement as HTMLElement;
      setSelectedAsset(asset);
      setIsModalOpen(true);
    } else {
      alert(`Asset not found: ${assetId}`);
    }
  };

  const handleEncounterClick = (encounterId: string) => {
    if (onGoToEncounter) {
      onGoToEncounter(encounterId);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedAsset(null);
    setTimeout(() => {
      lastFocusedElement.current?.focus();
    }, 0);
  };

  // Focus management and escape key
  useEffect(() => {
    if (isModalOpen && selectedAsset) {
      modalHeadingRef.current?.focus();
    }
  }, [isModalOpen, selectedAsset]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && isModalOpen) {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  if (!activeCampaign) {
    return <p>No active campaign selected. Go to Create Mode to select one.</p>;
  }

  const activeChapter = activeCampaign.chapters.find(c => c.id === activeChapterId);

  return (
    <div>
      <header style={{ marginBottom: '2rem', borderBottom: '2px solid #eee', paddingBottom: '1rem' }}>
        <h3>Running: {activeCampaign.name}</h3>
        <p>{activeCampaign.description}</p>
      </header>

      <div style={{ display: 'flex', gap: '2rem' }}>
        {/* Navigation Sidebar */}
        <div style={{ flex: '0 0 200px', borderRight: '1px solid #ccc', paddingRight: '1rem' }}>
          <h4>Chapters</h4>
          {activeCampaign.chapters.length === 0 ? (
            <p>No chapters written.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {activeCampaign.chapters.sort((a, b) => a.order - b.order).map(chap => (
                <li key={chap.id} style={{ marginBottom: '0.5rem' }}>
                  <button 
                    onClick={() => setActiveChapterId(chap.id)}
                    style={{ 
                      width: '100%', 
                      textAlign: 'left',
                      fontWeight: activeChapterId === chap.id ? 'bold' : 'normal',
                      backgroundColor: activeChapterId === chap.id ? '#f0f8ff' : 'transparent',
                      border: '1px solid transparent',
                      padding: '0.5rem'
                    }}
                    aria-current={activeChapterId === chap.id ? 'page' : undefined}
                  >
                    {chap.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Main Content Area */}
        <div style={{ flex: 1 }}>
          {activeChapter ? (
            <div>
              <h3 style={{ borderBottom: '1px solid #ccc', paddingBottom: '0.5rem' }}>{activeChapter.title}</h3>
              <div style={{ marginTop: '1rem' }}>
                {parseMarkdown(activeChapter.content, handleAssetClick, handleEncounterClick, 3)}
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
            <h3 id="asset-modal-title" ref={modalHeadingRef} tabIndex={-1} style={{ outline: 'none', marginBottom: '0.5rem' }}>
              {selectedAsset.name} ({selectedAsset.type})
            </h3>
            
            <div style={{ marginTop: '1rem' }}>
              <p style={{ whiteSpace: 'pre-wrap' }}>{selectedAsset.description}</p>
            </div>

            <button onClick={closeModal} style={{ marginTop: '2rem', width: '100%', padding: '0.5rem' }}>
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
