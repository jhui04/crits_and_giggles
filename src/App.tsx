import React, { useState, useRef, useEffect } from 'react';
import { CampaignBuilder } from './components/CampaignBuilder';
import { CampaignRunner } from './components/CampaignRunner';
import { EncounterRunner } from './components/EncounterRunner';
import { Oracle } from './components/Oracle';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { WorldSwitcher } from './components/WorldSwitcher';
import { WorldBuilder } from './components/WorldBuilder';
import { useCampaigns } from './context/CampaignContext';
import { useWorlds } from './context/WorldContext';
import type { Campaign } from './types';

type AppMode = 'create' | 'run';

function App() {
  const [mode, setMode] = useState<AppMode>('create');
  const { campaigns, activeCampaign, setActiveCampaignId, createCampaign, deleteCampaign } = useCampaigns();
  const { activeWorld } = useWorlds();
  
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [isWorldSwitcherOpen, setIsWorldSwitcherOpen] = useState(false);
  const [isOracleOpen, setIsOracleOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newCampDesc, setNewCampDesc] = useState('');
  const [createTab, setCreateTab] = useState<'campaign' | 'world'>('campaign');

  const [scrapedCampaigns, setScrapedCampaigns] = useState<Partial<Campaign>[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('none');

  // Multi-tab Encounter Support
  const urlParams = new URLSearchParams(window.location.search);
  const targetEncounterId = urlParams.get('encounter');

  useEffect(() => {
    fetch('/data/scraped_campaign.json')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setScrapedCampaigns(data);
        } else if (data) {
          setScrapedCampaigns([data]);
        }
      })
      .catch(err => console.log('No scraped campaign available.', err));
  }, []);

   const switchCampBtnRef = useRef<HTMLButtonElement>(null);
  const switchCampHeadingRef = useRef<HTMLHeadingElement>(null);
  const switchWorldBtnRef = useRef<HTMLButtonElement>(null);
  const mainMenuBtnRef = useRef<HTMLButtonElement>(null);
  const mainMenuHeadingRef = useRef<HTMLHeadingElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const lastFocusedBeforeOracle = useRef<HTMLElement | null>(null);
  const lastFocusedBeforeHelp = useRef<HTMLElement | null>(null);

  const toggleMode = () => {
    setMode((prevMode) => (prevMode === 'create' ? 'run' : 'create'));
  };

  const openMainMenu = () => {
    setIsMainMenuOpen(true);
  };

  const closeMainMenu = (restoreFocus = true) => {
    setIsMainMenuOpen(false);
    if (restoreFocus) {
      setTimeout(() => mainMenuBtnRef.current?.focus(), 0);
    }
  };

  const openCampaignModal = () => {
    switchCampBtnRef.current = document.activeElement as HTMLButtonElement;
    setIsCampaignModalOpen(true);
  };

  const closeCampaignModal = () => {
    setIsCampaignModalOpen(false);
    setIsCreatingNew(false);
    setTimeout(() => {
      if (switchCampBtnRef.current && switchCampBtnRef.current !== document.body && document.body.contains(switchCampBtnRef.current)) {
        switchCampBtnRef.current.focus();
      } else {
        mainMenuBtnRef.current?.focus();
      }
    }, 0);
  };

  const openWorldSwitcher = () => {
    switchWorldBtnRef.current = document.activeElement as HTMLButtonElement;
    setIsWorldSwitcherOpen(true);
  };

  const closeWorldSwitcher = () => {
    setIsWorldSwitcherOpen(false);
    setTimeout(() => {
      if (switchWorldBtnRef.current && switchWorldBtnRef.current !== document.body && document.body.contains(switchWorldBtnRef.current)) {
        switchWorldBtnRef.current.focus();
      } else {
        mainMenuBtnRef.current?.focus();
      }
    }, 0);
  };

  const openOracle = () => {
    lastFocusedBeforeOracle.current = document.activeElement as HTMLElement;
    setIsOracleOpen(true);
  };

  const closeOracle = () => {
    setIsOracleOpen(false);
    setTimeout(() => {
      if (lastFocusedBeforeOracle.current && lastFocusedBeforeOracle.current !== document.body && document.body.contains(lastFocusedBeforeOracle.current)) {
        lastFocusedBeforeOracle.current.focus();
      } else {
        mainMenuBtnRef.current?.focus();
      }
    }, 0);
  };

  const openShortcutsHelp = () => {
    lastFocusedBeforeHelp.current = document.activeElement as HTMLElement;
    setIsShortcutsHelpOpen(true);
  };

  const closeShortcutsHelp = () => {
    setIsShortcutsHelpOpen(false);
    setTimeout(() => {
      if (lastFocusedBeforeHelp.current && lastFocusedBeforeHelp.current !== document.body && document.body.contains(lastFocusedBeforeHelp.current)) {
        lastFocusedBeforeHelp.current.focus();
      } else {
        mainMenuBtnRef.current?.focus();
      }
    }, 0);
  };

  const handleCreate = () => {
    if (newCampName) {
      const selectedCamp = scrapedCampaigns.find(c => c.id === selectedTemplate);
      if (selectedCamp) {
        createCampaign(newCampName, newCampDesc, selectedCamp);
      } else {
        createCampaign(newCampName, newCampDesc);
      }
      setNewCampName('');
      setNewCampDesc('');
      setSelectedTemplate('none');
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
      setTimeout(() => switchCampHeadingRef.current?.focus(), 50);
    }
  }, [isCampaignModalOpen, isCreatingNew]);

  useEffect(() => {
    if (isMainMenuOpen) {
      setTimeout(() => mainMenuHeadingRef.current?.focus(), 50);
    }
  }, [isMainMenuOpen]);

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
        if (key === 'w') {
          e.preventDefault();
          if (isWorldSwitcherOpen) closeWorldSwitcher();
          else openWorldSwitcher();
          return;
        }
        if (key === '1') {
          e.preventDefault();
          setCreateTab('campaign');
          return;
        }
        if (key === '2') {
          e.preventDefault();
          setCreateTab('world');
          return;
        }
      }

      // Prevent default behavior for Enter and Space on non-interactive elements
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLAnchorElement)) {
        e.preventDefault();
      }

      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (isCampaignModalOpen) {
          closeCampaignModal();
        } else if (isWorldSwitcherOpen) {
          closeWorldSwitcher();
        } else if (isMainMenuOpen) {
          closeMainMenu();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCampaignModalOpen, isOracleOpen, isShortcutsHelpOpen, isMainMenuOpen, isWorldSwitcherOpen, createTab, mode]);

  if (targetEncounterId) {
    return (
      <main>
        <h1 className="sr-only">Encounter Runner</h1>
        <EncounterRunner targetEncounterId={targetEncounterId} />
      </main>
    );
  }

  return (
    <React.Fragment>
      <div className="app-container" aria-hidden={isMainMenuOpen || isCampaignModalOpen || isWorldSwitcherOpen || isOracleOpen || isShortcutsHelpOpen}>  
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>
            <button
              type="button"
              ref={mainMenuBtnRef}
              onClick={openMainMenu}
              aria-label="Open Main Menu"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}
            >
              Crits & Giggles
            </button>
          </h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ marginRight: '1rem' }}>
              <strong>World:</strong> {activeWorld ? activeWorld.name : 'None Selected'}
            </span>
            <span style={{ marginRight: '1rem' }}>
              <strong>Campaign:</strong> {activeCampaign ? activeCampaign.name : 'None Selected'}
            </span>
          </div>
        </header>
        <main>
          <div className="sr-only" aria-live="polite">
            Current Mode: {mode === 'create' ? 'Create Mode' : 'Run Mode'}
          </div>
          {mode === 'create' ? <CreateLayout activeTab={createTab} setActiveTab={setCreateTab} /> : <RunLayout />}
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
      <WorldSwitcher isOpen={isWorldSwitcherOpen} onClose={closeWorldSwitcher} />

      {/* Main Menu Modal */}
      {isMainMenuOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="main-menu-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1500
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '400px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            <h2 id="main-menu-title" ref={mainMenuHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>Main Menu</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openOracle(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                The Oracle (Alt+O)
              </button>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openCampaignModal(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                Switch Campaign (Alt+C)
              </button>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openWorldSwitcher(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                Switch World (Alt+W)
              </button>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openShortcutsHelp(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                Keyboard Shortcuts (Alt+H)
              </button>
              <button
                type="button"
                onClick={() => closeMainMenu(true)}
                style={{ padding: '0.75rem', fontSize: '1.1rem', backgroundColor: '#eee', marginTop: '1rem' }}
              >
                Close (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

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
                <h2 key="select-campaign-heading" id="switch-camp-title" ref={switchCampHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Select Campaign</h2>
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
                          onClick={() => deleteCampaign(c.id)}
                          style={{ background: '#d32f2f', color: 'white', border: 'none', padding: '0 1rem' }}
                          aria-label={`Delete ${c.name}`}
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
                  <button type="button" onClick={() => setIsCreatingNew(true)} style={{ flex: 1, padding: '1rem', fontWeight: 'bold' }}>+ Create New Campaign</button>
                  <button type="button" onClick={closeCampaignModal} style={{ flex: 1, padding: '1rem', background: '#eee' }}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <h2 key="new-campaign-heading" id="switch-camp-title" ref={switchCampHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>New Campaign</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label htmlFor="new-camp-name">Campaign Name:</label>
                    <input 
                      id="new-camp-name" 
                      type="text" 
                      value={newCampName} 
                      onChange={e => setNewCampName(e.target.value)} 
                      style={{ width: '100%', padding: '0.75rem' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-camp-desc">Description:</label>
                    <textarea 
                      id="new-camp-desc" 
                      value={newCampDesc} 
                      onChange={e => setNewCampDesc(e.target.value)} 
                      style={{ width: '100%', padding: '0.75rem', minHeight: '100px' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="camp-template">Select Template (Optional):</label>
                    <select 
                      id="camp-template" 
                      value={selectedTemplate} 
                      onChange={e => setSelectedTemplate(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem' }}
                    >
                      <option value="none">Blank Campaign</option>
                      {scrapedCampaigns.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                    <button type="button" onClick={handleCreate} style={{ flex: 1, padding: '1rem', background: '#1976d2', color: 'white', fontWeight: 'bold' }}>Create & Select</button>
                    <button type="button" onClick={() => setIsCreatingNew(false)} style={{ flex: 1, padding: '1rem', background: '#eee' }}>Back</button>
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

function CreateLayout({ activeTab, setActiveTab }: { activeTab: 'campaign' | 'world'; setActiveTab: (tab: 'campaign' | 'world') => void }) {
  const { activeCampaign } = useCampaigns();
  const { activeWorld } = useWorlds();

  // Focus panel heading when activeTab changes
  useEffect(() => {
    if (activeTab === 'campaign') {
      setTimeout(() => {
        const heading = document.getElementById('campaign-builder-heading') || document.getElementById('campaign-no-select-heading');
        heading?.focus();
      }, 50);
    } else {
      setTimeout(() => {
        const heading = document.getElementById('world-info-title') || document.getElementById('world-no-select-heading');
        heading?.focus();
      }, 50);
    }
  }, [activeTab]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveTab(activeTab === 'campaign' ? 'world' : 'campaign');
    }
  };

  return (
    <div className="layout-create">
      <nav role="tablist" aria-label="Create Mode views" style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid #ccc', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          role="tab"
          id="tab-campaign"
          aria-selected={activeTab === 'campaign'}
          aria-controls="panel-campaign"
          onClick={() => setActiveTab('campaign')}
          onKeyDown={handleKeyDown}
          style={{
            padding: '0.5rem 1rem',
            border: 'none',
            borderBottom: activeTab === 'campaign' ? '2px solid #1976d2' : 'none',
            background: 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'campaign' ? 'bold' : 'normal',
          }}
        >
          Campaign (Alt+1)
        </button>
        <button
          role="tab"
          id="tab-world"
          aria-selected={activeTab === 'world'}
          aria-controls="panel-world"
          onClick={() => setActiveTab('world')}
          onKeyDown={handleKeyDown}
          style={{
            padding: '0.5rem 1rem',
            border: 'none',
            borderBottom: activeTab === 'world' ? '2px solid #1976d2' : 'none',
            background: 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'world' ? 'bold' : 'normal',
          }}
        >
          World (Alt+2)
        </button>
      </nav>

      {activeTab === 'campaign' ? (
        <div 
          role="tabpanel" 
          id="panel-campaign" 
          aria-labelledby="tab-campaign"
          tabIndex={-1}
          style={{ outline: 'none' }}
        >
          {!activeCampaign ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <h2 id="campaign-no-select-heading" tabIndex={-1} style={{ outline: 'none' }}>Welcome to Crits & Giggles</h2>
              <p>Please select or create a campaign to get started.</p>
            </div>
          ) : (
            <CampaignBuilder />
          )}
        </div>
      ) : (
        <div 
          role="tabpanel" 
          id="panel-world" 
          aria-labelledby="tab-world"
          tabIndex={-1}
          style={{ outline: 'none' }}
        >
          {!activeWorld ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <h2 id="world-no-select-heading" tabIndex={-1} style={{ outline: 'none' }}>No World Selected</h2>
              <p>Please select or create a world using Switch World (Alt+W) to get started.</p>
            </div>
          ) : (
            <WorldBuilder />
          )}
        </div>
      )}
    </div>
  );
}

function RunLayout() {
  const { activeCampaign } = useCampaigns();

  if (!activeCampaign) return <div style={{ padding: '2rem' }}>No active campaign.</div>;

  return (
    <div className="layout-run">
      <div className="tab-content">
        <CampaignRunner />
      </div>
    </div>
  );
}

export default App;
