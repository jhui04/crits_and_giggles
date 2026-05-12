import React, { useState, useRef, useEffect } from 'react';
import { CampaignBuilder } from './components/CampaignBuilder';
import { CampaignRunner } from './components/CampaignRunner';
import { EncounterRunner } from './components/EncounterRunner';
import { useCampaigns } from './context/CampaignContext';

type AppMode = 'create' | 'run';
type RunTab = 'story' | 'combat';

function App() {
  const [mode, setMode] = useState<AppMode>('create');
  const { campaigns, activeCampaign, setActiveCampaignId, createCampaign, deleteCampaign } = useCampaigns();
  
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newCampDesc, setNewCampDesc] = useState('');

  const switchCampBtnRef = useRef<HTMLButtonElement>(null);
  const switchCampHeadingRef = useRef<HTMLHeadingElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const toggleMode = () => {
    setMode((prevMode) => (prevMode === 'create' ? 'run' : 'create'));
  };

  const closeCampaignModal = () => {
    setIsCampaignModalOpen(false);
    setIsCreatingNew(false);
    setTimeout(() => switchCampBtnRef.current?.focus(), 0);
  };

  const handleCreate = () => {
    if (newCampName) {
      createCampaign(newCampName, newCampDesc);
      setNewCampName('');
      setNewCampDesc('');
      closeCampaignModal();
    }
  };

  const handleSelectCampaign = (id: string) => {
    setActiveCampaignId(id);
    closeCampaignModal();
  };

  // Focus management and escape key for modal
  useEffect(() => {
    if (isCampaignModalOpen) {
      switchCampHeadingRef.current?.focus();
    }
  }, [isCampaignModalOpen, isCreatingNew]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && isCampaignModalOpen) {
        closeCampaignModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCampaignModalOpen]);

  return (
    <React.Fragment>
      <div className="app-container" aria-hidden={isCampaignModalOpen}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 aria-label="Crits & Giggles Main Menu">Crits & Giggles</h1>
          <div>
            <span style={{ marginRight: '1rem' }}>
              <strong>Campaign:</strong> {activeCampaign ? activeCampaign.name : 'None Selected'}
            </span>
            <button ref={switchCampBtnRef} onClick={() => setIsCampaignModalOpen(true)}>Switch Campaign</button>
          </div>
        </header>

        <main>
          {mode === 'create' ? <CreateLayout /> : <RunLayout />}
        </main>

        <footer className="mode-toggle-footer">
          <button 
            onClick={toggleMode} 
            aria-live="polite"
            className="mode-toggle-btn"
          >
            Switch to {mode === 'create' ? 'Run Mode' : 'Create Mode'}
          </button>
        </footer>
      </div>

      {/* Switch Campaign Modal */}
      {isCampaignModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="switch-camp-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div ref={modalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            {!isCreatingNew ? (
              <>
                <h3 id="switch-camp-title" ref={switchCampHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Select Campaign</h3>
                {campaigns.length === 0 ? <p>No campaigns found.</p> : (
                  <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {campaigns.map(c => (
                      <li key={c.id} style={{ display: 'flex', gap: '0.5rem' }}>
                        <button 
                          onClick={() => handleSelectCampaign(c.id)}
                          style={{ flexGrow: 1, textAlign: 'left', padding: '0.75rem', fontWeight: activeCampaign?.id === c.id ? 'bold' : 'normal' }}
                        >
                          {c.name} {activeCampaign?.id === c.id && '(Active)'}
                        </button>
                        <button 
                          onClick={() => {
                            if (confirm(`Are you sure you want to delete the campaign "${c.name}"?`)) {
                              // We need to import useCampaigns and use deleteCampaign from it.
                              // Assuming deleteCampaign is destructured from useCampaigns at the top of App()
                              deleteCampaign(c.id);
                            }
                          }}
                          aria-label={`Delete campaign ${c.name}`}
                          style={{ padding: '0.75rem', backgroundColor: '#fee' }}
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
                  <button onClick={() => setIsCreatingNew(true)} style={{ flex: 1, fontWeight: 'bold' }}>Create New Campaign</button>
                  <button onClick={closeCampaignModal} style={{ flex: 1 }}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <h3 id="switch-camp-title" ref={switchCampHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Create New Campaign</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label htmlFor="new-camp-name" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Campaign Name</label>
                    <input 
                      id="new-camp-name"
                      value={newCampName} 
                      onChange={e => setNewCampName(e.target.value)} 
                      style={{ width: '100%', padding: '0.5rem' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-camp-desc" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Description</label>
                    <textarea 
                      id="new-camp-desc"
                      value={newCampDesc} 
                      onChange={e => setNewCampDesc(e.target.value)} 
                      rows={4}
                      style={{ width: '100%', padding: '0.5rem' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                    <button onClick={handleCreate} disabled={!newCampName} style={{ flex: 1, fontWeight: 'bold' }}>Create & Select</button>
                    <button onClick={() => setIsCreatingNew(false)} style={{ flex: 1 }}>Back</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

function CreateLayout() {
  return (
    <div>
      <div style={{ fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '1rem' }}>Create Mode</div>
      <CampaignBuilder />
    </div>
  );
}

function RunLayout() {
  const [tab, setTab] = useState<RunTab>('story');
  const [targetEncounterId, setTargetEncounterId] = useState<string | null>(null);

  const handleGoToEncounter = (id: string) => {
    setTargetEncounterId(id);
    setTab('combat');
  };

  return (
    <div>
      <div style={{ fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '1rem' }}>Run Mode</div>
      <div style={{ borderBottom: '1px solid #ccc', marginBottom: '1rem', paddingBottom: '0.5rem' }}>
        <button 
          onClick={() => setTab('story')}
          style={{ fontWeight: tab === 'story' ? 'bold' : 'normal', marginRight: '1rem' }}
          aria-current={tab === 'story' ? 'page' : undefined}
        >
          Story
        </button>
        <button 
          onClick={() => setTab('combat')}
          style={{ fontWeight: tab === 'combat' ? 'bold' : 'normal' }}
          aria-current={tab === 'combat' ? 'page' : undefined}
        >
          Combat
        </button>
      </div>

      {tab === 'story' && <CampaignRunner onGoToEncounter={handleGoToEncounter} />}
      {tab === 'combat' && <EncounterRunner targetEncounterId={targetEncounterId} />}
    </div>
  );
}

export default App;
