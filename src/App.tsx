import React, { useState, useRef, useEffect } from 'react';
import { CampaignBuilder } from './components/CampaignBuilder';
import { CampaignRunner } from './components/CampaignRunner';
import { EncounterRunner } from './components/EncounterRunner';
import { Oracle } from './components/Oracle';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { useCampaigns } from './context/CampaignContext';
import type { Campaign } from './types';

type AppMode = 'create' | 'run';

function App() {
  const [mode, setMode] = useState<AppMode>('create');
  const { campaigns, activeCampaign, setActiveCampaignId, createCampaign, deleteCampaign } = useCampaigns();
  
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [isOracleOpen, setIsOracleOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newCampDesc, setNewCampDesc] = useState('');

  const [scrapedCampaigns, setScrapedCampaigns] = useState<Partial<Campaign>[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('none');

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
      setTimeout(() => mainMenuHeadingRef.current?.focus(), 0);
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
      }

      // Prevent default behavior for Enter and Space on non-interactive elements
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLAnchorElement)) {
        e.preventDefault();
      }

      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (isCampaignModalOpen) {
          closeCampaignModal();
        } else if (isMainMenuOpen) {
          closeMainMenu();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCampaignModalOpen, isOracleOpen, isShortcutsHelpOpen, isMainMenuOpen]);

  return (
    <React.Fragment>
      <div className="app-container" aria-hidden={isMainMenuOpen || isCampaignModalOpen || isOracleOpen || isShortcutsHelpOpen}>  
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
              <strong>Campaign:</strong> {activeCampaign ? activeCampaign.name : 'None Selected'}
            </span>
          </div>
        </header>
        <main>
          <div className="sr-only" aria-live="polite">
            Current Mode: {mode === 'create' ? 'Create Mode' : 'Run Mode'}
          </div>
          {mode === 'create' ? <CreateLayout /> : <RunLayout />}
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
                data-fuzzer-category="main-oracle"
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
                <h2 id="switch-camp-title" ref={switchCampHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Select Campaign</h2>
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
                <h2 id="switch-camp-title" ref={switchCampHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>New Campaign</h2>
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

function CreateLayout() {
  const { activeCampaign } = useCampaigns();
  
  if (!activeCampaign) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Welcome to Crits & Giggles</h2>
        <p>Please select or create a campaign to get started.</p>
      </div>
    );
  }

  return (
    <div className="layout-create">
      <div className="tab-content">
        <CampaignBuilder />
      </div>
    </div>
  );
}

function RunLayout() {
  const [activeTab, setActiveTab] = useState<'story' | 'combat'>('story');
  const { activeCampaign } = useCampaigns();

  useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === 'combat' || detail === 'story') {
        setActiveTab(detail);
      }
    };
    window.addEventListener('switch-tab', handleSwitchTab);
    return () => window.removeEventListener('switch-tab', handleSwitchTab);
  }, []);

  if (!activeCampaign) return <div style={{ padding: '2rem' }}>No active campaign.</div>;

  return (
    <div className="layout-run">
      <nav className="sub-nav" aria-label="Run Mode Views">
        <button 
          type="button"
          aria-current={activeTab === 'story' ? 'page' : undefined} 
          onClick={() => setActiveTab('story')}
          className={activeTab === 'story' ? 'active' : ''}
        >
          Story
        </button>
        <button 
          type="button"
          aria-current={activeTab === 'combat' ? 'page' : undefined} 
          onClick={() => setActiveTab('combat')}
          className={activeTab === 'combat' ? 'active' : ''}
        >
          Combat
        </button>
      </nav>

      <div className="tab-content">
        {activeTab === 'story' && <CampaignRunner />}
        {activeTab === 'combat' && <EncounterRunner />}
      </div>
    </div>
  );
}

export default App;
