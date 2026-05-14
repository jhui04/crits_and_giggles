import React, { useState, useRef, useEffect } from 'react';
import { CampaignBuilder } from './components/CampaignBuilder';
import { CampaignRunner } from './components/CampaignRunner';
import { EncounterRunner } from './components/EncounterRunner';
import { Oracle } from './components/Oracle';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { SpellBrowser } from './components/SpellBrowser';
import { useCampaigns } from './context/CampaignContext';

type AppMode = 'create' | 'run';
type RunTab = 'story' | 'combat' | 'spells';

function App() {
  const [mode, setMode] = useState<AppMode>('create');
  const { campaigns, activeCampaign, setActiveCampaignId, createCampaign, deleteCampaign } = useCampaigns();
  
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [isOracleOpen, setIsOracleOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newCampDesc, setNewCampDesc] = useState('');
  const [createTab, setCreateTab] = useState<'campaign' | 'spells'>('campaign');

  const switchCampBtnRef = useRef<HTMLButtonElement>(null);
  const switchCampHeadingRef = useRef<HTMLHeadingElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const lastFocusedBeforeOracle = useRef<HTMLElement | null>(null);
  const lastFocusedBeforeHelp = useRef<HTMLElement | null>(null);

  const toggleMode = () => {
    setMode((prevMode) => (prevMode === 'create' ? 'run' : 'create'));
  };

  const openCampaignModal = () => {
    setIsCampaignModalOpen(true);
  };

  const closeCampaignModal = () => {
    setIsCampaignModalOpen(false);
    setIsCreatingNew(false);
    setTimeout(() => switchCampBtnRef.current?.focus(), 0);
  };

  const openOracle = () => {
    lastFocusedBeforeOracle.current = document.activeElement as HTMLElement;
    setIsOracleOpen(true);
  };

  const closeOracle = () => {
    setIsOracleOpen(false);
    setTimeout(() => {
      lastFocusedBeforeOracle.current?.focus();
    }, 0);
  };

  const openShortcutsHelp = () => {
    lastFocusedBeforeHelp.current = document.activeElement as HTMLElement;
    setIsShortcutsHelpOpen(true);
  };

  const closeShortcutsHelp = () => {
    setIsShortcutsHelpOpen(false);
    setTimeout(() => {
      lastFocusedBeforeHelp.current?.focus();
    }, 0);
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
      // Custom Shortcuts (Alt modifier)
      const key = e.key.toLowerCase();
      
      if (e.altKey) {
        if (key === 'o') {
          e.preventDefault();
          if (isOracleOpen) closeOracle();
          else openOracle();
          return;
        }
        if (key === 'h') {
          e.preventDefault();
          if (isShortcutsHelpOpen) closeShortcutsHelp();
          else openShortcutsHelp();
          return;
        }
        if (key === 'm') {
          e.preventDefault();
          toggleMode();
          return;
        }
        if (key === 'c') {
          e.preventDefault();
          if (isCampaignModalOpen) closeCampaignModal();
          else openCampaignModal();
          return;
        }
        if (key === 's') {
          e.preventDefault();
          if (mode === 'run') {
            window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'spells' }));
          } else {
            setCreateTab('spells');
          }
          return;
        }
      }

      // Prevent default behavior for Enter and Space on non-interactive elements
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLAnchorElement)) {
        e.preventDefault();
      }

      if (e.key === 'Escape' && !e.defaultPrevented && isCampaignModalOpen) {
        closeCampaignModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCampaignModalOpen, isOracleOpen, isShortcutsHelpOpen]);

  return (
    <React.Fragment>
      <div className="app-container" aria-hidden={isCampaignModalOpen || isOracleOpen || isShortcutsHelpOpen}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 aria-label="Crits & Giggles Main Menu">Crits & Giggles</h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button 
              type="button" 
              onClick={openShortcutsHelp}
              aria-label="Keyboard Shortcuts (Alt+H)"
            >
              Shortcuts
            </button>
            <button 
              type="button" 
              onClick={openOracle}
              data-fuzzer-category="main-oracle"
              aria-label="Open Oracle Search (Alt+O)"
            >
              The Oracle
            </button>
            <div>
              <span style={{ marginRight: '1rem' }}>
                <strong>Campaign:</strong> {activeCampaign ? activeCampaign.name : 'None Selected'}
              </span>
              <button type="button" ref={switchCampBtnRef} onClick={openCampaignModal}>Switch Campaign</button>
            </div>
          </div>
        </header>

        <main>
          {mode === 'create' ? <CreateLayout tab={createTab} setTab={setCreateTab} /> : <RunLayout />}
        </main>

        <footer className="mode-toggle-footer">
          <button 
            type="button"
            onClick={toggleMode} 
            aria-live="polite"
            className="mode-toggle-btn"
          >
            Switch to {mode === 'create' ? 'Run Mode' : 'Create Mode'}
          </button>
        </footer>
      </div>

      <Oracle isOpen={isOracleOpen} onClose={closeOracle} />
      <ShortcutsHelp isOpen={isShortcutsHelpOpen} onClose={closeShortcutsHelp} />

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
                          type="button"
                          onClick={() => handleSelectCampaign(c.id)}
                          style={{ flexGrow: 1, textAlign: 'left', padding: '0.75rem', fontWeight: activeCampaign?.id === c.id ? 'bold' : 'normal' }}
                        >
                          {c.name} {activeCampaign?.id === c.id && '(Active)'}
                        </button>
                        <button 
                          type="button"
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
                  <button type="button" onClick={() => setIsCreatingNew(true)} style={{ flex: 1, fontWeight: 'bold' }}>Create New Campaign</button>
                  <button type="button" onClick={closeCampaignModal} style={{ flex: 1 }}>Cancel</button>
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
                    <button type="button" onClick={handleCreate} disabled={!newCampName} style={{ flex: 1, fontWeight: 'bold' }}>Create & Select</button>
                    <button type="button" onClick={() => setIsCreatingNew(false)} style={{ flex: 1 }}>Back</button>
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

function CreateLayout({ tab, setTab }: { tab: 'campaign' | 'spells', setTab: (t: 'campaign' | 'spells') => void }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Create Mode</div>
        <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '0.5rem' }}>
          <button 
            type="button"
            onClick={() => setTab('campaign')}
            style={{ fontWeight: tab === 'campaign' ? 'bold' : 'normal', marginRight: '1rem' }}
            aria-current={tab === 'campaign' ? 'page' : undefined}
          >
            Campaign Builder
          </button>
          <button 
            type="button"
            onClick={() => setTab('spells')}
            style={{ fontWeight: tab === 'spells' ? 'bold' : 'normal' }}
            aria-current={tab === 'spells' ? 'page' : undefined}
          >
            Spell Browser
          </button>
        </div>
      </div>
      {tab === 'campaign' ? <CampaignBuilder /> : <SpellBrowser />}
    </div>
  );
}

function RunLayout() {
  const [tab, setTab] = useState<RunTab>('story');
  const [targetEncounterId, setTargetEncounterId] = useState<string | null>(null);

  useEffect(() => {
    const handleSwitchTab = (e: any) => {
      setTab(e.detail);
    };
    window.addEventListener('switch-tab', handleSwitchTab);
    return () => window.removeEventListener('switch-tab', handleSwitchTab);
  }, []);

  const handleGoToEncounter = (id: string) => {
    setTargetEncounterId(id);
    setTab('combat');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Run Mode</div>
        <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '0.5rem' }}>
          <button 
            type="button"
            onClick={() => setTab('story')}
            style={{ fontWeight: tab === 'story' ? 'bold' : 'normal', marginRight: '1rem' }}
            aria-current={tab === 'story' ? 'page' : undefined}
          >
            Story
          </button>
          <button 
            type="button"
            onClick={() => setTab('combat')}
            style={{ fontWeight: tab === 'combat' ? 'bold' : 'normal', marginRight: '1rem' }}
            aria-current={tab === 'combat' ? 'page' : undefined}
          >
            Combat
          </button>
          <button 
            type="button"
            onClick={() => setTab('spells')}
            style={{ fontWeight: tab === 'spells' ? 'bold' : 'normal' }}
            aria-current={tab === 'spells' ? 'page' : undefined}
          >
            Spells
          </button>
        </div>
      </div>

      {tab === 'story' && <CampaignRunner onGoToEncounter={handleGoToEncounter} />}
      {tab === 'combat' && <EncounterRunner targetEncounterId={targetEncounterId} />}
      {tab === 'spells' && <SpellBrowser />}
    </div>
  );
}

export default App;
