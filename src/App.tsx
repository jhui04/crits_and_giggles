import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CampaignBuilder } from './components/CampaignBuilder';
import { CampaignRunner } from './components/CampaignRunner';
import { EncounterRunner } from './components/EncounterRunner';
import { Oracle } from './components/Oracle';
import { AssistantOracleModal } from './components/AssistantOracleModal';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { DiceRollerModal } from './components/DiceRollerModal';
import { DebugInfoModal } from './components/DebugInfoModal';
import { CampaignPicker } from './components/CampaignPicker';
import { useCampaigns } from './context/CampaignContext';
import { useWorlds } from './context/WorldContext';
import type { Campaign } from './types';
import { isInteractiveTarget, useFocusRestore, useFocusTrap } from './components/uiHelpers';
import { useAssistantScreen } from './context/AssistantScreenContext';

type AppMode = 'create' | 'run';

function App() {
  const [mode, setMode] = useState<AppMode>('create');
  const { activeCampaign, createCampaign, activeChapterId } = useCampaigns();
  const { activeWorld } = useWorlds();
  const activeChapter = activeCampaign?.chapters?.find((c) => c.id === activeChapterId);
  
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [isCampaignSettingsOpen, setIsCampaignSettingsOpen] = useState(false);
  const [isOracleOpen, setIsOracleOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isAssistantFocusInput, setIsAssistantFocusInput] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isDiceRollerOpen, setIsDiceRollerOpen] = useState(false);
  const [isDebugInfoOpen, setIsDebugInfoOpen] = useState(false);
  const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
  const [newCampName, setNewCampName] = useState('');
  const [newCampDesc, setNewCampDesc] = useState('');

  const [scrapedCampaigns, setScrapedCampaigns] = useState<Partial<Campaign>[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('none');

  // Multi-tab Encounter Support
  const urlParams = new URLSearchParams(window.location.search);
  const targetEncounterId = urlParams.get('encounter');

  // Create mode with no campaign is the only screen App itself owns; every other screen registers
  // from its own component (see useAssistantScreen).
  useAssistantScreen(!targetEncounterId && mode === 'create' && !activeCampaign ? 'create.no_campaign' : null);

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

  const switchCampHeadingRef = useRef<HTMLHeadingElement>(null);
  const mainMenuBtnRef = useRef<HTMLButtonElement>(null);
  const mainMenuHeadingRef = useRef<HTMLHeadingElement>(null);
  const mainMenuModalRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const { remember, restore } = useFocusRestore();
  const restoreToMenu = useCallback(() => mainMenuBtnRef.current?.focus(), []);

  useFocusTrap(mainMenuModalRef, isMainMenuOpen);
  useFocusTrap(modalRef, isCampaignModalOpen);

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

  const handleCloseCampaignSettings = useCallback(() => {
    setIsCampaignSettingsOpen(false);
    setTimeout(() => mainMenuBtnRef.current?.focus(), 0);
  }, []);

  const openCampaignModal = useCallback(() => {
    remember('campaign');
    setIsCampaignModalOpen(true);
  }, [remember]);

  const closeCampaignModal = useCallback(() => {
    setIsCampaignModalOpen(false);
    restore('campaign', restoreToMenu);
  }, [restore, restoreToMenu]);

  const openOracle = useCallback(() => {
    remember('oracle');
    setIsOracleOpen(true);
  }, [remember]);

  const closeOracle = useCallback(() => {
    setIsOracleOpen(false);
    restore('oracle', restoreToMenu);
  }, [restore, restoreToMenu]);

  const openAssistant = useCallback((focusInput = false) => {
    remember('assistant');
    setIsAssistantFocusInput(focusInput);
    setIsAssistantOpen(true);
  }, [remember]);

  const closeAssistant = useCallback(() => {
    setIsAssistantOpen(false);
    restore('assistant', restoreToMenu);
  }, [restore, restoreToMenu]);

  const openShortcutsHelp = useCallback(() => {
    remember('help');
    setIsShortcutsHelpOpen(true);
  }, [remember]);

  const closeShortcutsHelp = useCallback(() => {
    setIsShortcutsHelpOpen(false);
    restore('help', restoreToMenu);
  }, [restore, restoreToMenu]);

  const openDiceRoller = useCallback(() => {
    remember('diceRoller');
    setIsDiceRollerOpen(true);
  }, [remember]);

  const closeDiceRoller = useCallback(() => {
    setIsDiceRollerOpen(false);
    restore('diceRoller', restoreToMenu);
  }, [restore, restoreToMenu]);

  const openDebugInfo = useCallback(() => {
    remember('debugInfo');
    setIsDebugInfoOpen(true);
  }, [remember]);

  const closeDebugInfo = useCallback(() => {
    setIsDebugInfoOpen(false);
    restore('debugInfo', restoreToMenu);
  }, [restore, restoreToMenu]);

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
      if (isCampaignSettingsOpen) handleCloseCampaignSettings();
    }
  };

  // Focus management and escape key for modal
  useEffect(() => {
    if (isCampaignModalOpen) {
      setTimeout(() => switchCampHeadingRef.current?.focus(), 50);
    }
  }, [isCampaignModalOpen]);

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
        if (key === 'a') {
          e.preventDefault();
          if (isAssistantOpen) closeAssistant();
          else openAssistant(true);
          return;
        }
        if (key === 'h') {
          e.preventDefault();
          if (isShortcutsHelpOpen) closeShortcutsHelp();
          else openShortcutsHelp();
          return;
        }
        if (key === 'd') {
          e.preventDefault();
          if (isDiceRollerOpen) closeDiceRoller();
          else openDiceRoller();
          return;
        }
        if (key === 'm') {
          e.preventDefault();
          toggleMode();
          return;
        }
      }

      // Prevent default behavior for Enter and Space on non-interactive elements
      if ((e.key === 'Enter' || e.key === ' ') && !isInteractiveTarget(e.target)) {
        e.preventDefault();
      }

      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (isAssistantOpen) {
          closeAssistant();
        } else if (isCampaignModalOpen) {
          closeCampaignModal();
        } else if (isMainMenuOpen) {
          closeMainMenu();
        } else if (isDiceRollerOpen) {
          closeDiceRoller();
        } else if (isDebugInfoOpen) {
          closeDebugInfo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCampaignModalOpen, isOracleOpen, isAssistantOpen, isShortcutsHelpOpen, isDiceRollerOpen, isDebugInfoOpen, isMainMenuOpen, isCampaignSettingsOpen, mode, activeCampaign,
      openOracle, closeOracle, openAssistant, closeAssistant, openShortcutsHelp, closeShortcutsHelp,
      openDiceRoller, closeDiceRoller, closeCampaignModal, handleCloseCampaignSettings, closeDebugInfo]);

  if (targetEncounterId) {
    return (
      <React.Fragment>
        <div aria-hidden={isAssistantOpen || isOracleOpen || isShortcutsHelpOpen || isDiceRollerOpen}>
          <main>
            <h1 className="sr-only">Encounter Runner</h1>
            <EncounterRunner targetEncounterId={targetEncounterId} />
          </main>
        </div>
        <AssistantOracleModal
          isOpen={isAssistantOpen}
          onClose={closeAssistant}
          campaignId={activeCampaign?.id}
          encounterId={targetEncounterId}
          chapterId={activeChapterId}
          chapterName={activeChapter?.title}
          worldId={activeWorld?.id}
          worldName={activeWorld?.name}
          initialFocusOnInput={isAssistantFocusInput}
        />
        <Oracle isOpen={isOracleOpen} onClose={closeOracle} />
        <ShortcutsHelp isOpen={isShortcutsHelpOpen} onClose={closeShortcutsHelp} />
        <DiceRollerModal isOpen={isDiceRollerOpen} onClose={closeDiceRoller} />
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <div className="app-container" aria-hidden={isMainMenuOpen || isCampaignModalOpen || isOracleOpen || isAssistantOpen || isShortcutsHelpOpen || isDiceRollerOpen || isDebugInfoOpen}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>
            <button
              type="button"
              ref={mainMenuBtnRef}
              onClick={openMainMenu}
              aria-label="Open Main Menu"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}
            >
              <span aria-hidden="true">☰</span> Crits & Giggles
            </button>
          </h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ marginRight: '1rem' }}>
              <strong>World:</strong> {activeWorld ? activeWorld.name : 'None Selected'}
            </span>
            <span style={{ marginRight: '1rem' }}>
              <strong>Campaign:</strong> {activeCampaign ? activeCampaign.name : 'None Selected'}
            </span>
            <button
              type="button"
              onClick={() => openAssistant(true)}
              aria-label="Open Assistant Oracle (Alt+A)"
              style={{
                background: '#0066cc',
                color: 'white',
                border: 'none',
                padding: '0.4rem 0.8rem',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.9rem',
              }}
            >
              Assistant Oracle (Alt+A)
            </button>
          </div>
        </header>

        {mode === 'create' ? (
          <div role="presentation">
            <div className="layout-create">
              {!activeCampaign ? (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <h2 id="campaign-no-select-heading" tabIndex={-1} style={{ outline: 'none' }}>Welcome to Crits & Giggles</h2>
                  <p>Please select or create a campaign to get started.</p>
                  <div style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'left' }}>
                    <CampaignPicker id="welcome-campaign-picker" onAddNew={openCampaignModal} />
                  </div>
                </div>
              ) : (
                <CampaignBuilder 
                  isCampaignSettingsOpen={isCampaignSettingsOpen}
                  onCloseCampaignSettings={handleCloseCampaignSettings}
                  onAddCampaign={openCampaignModal}
                  isNewCampaignOpen={isCampaignModalOpen}
                />
              )}
            </div>
          </div>
        ) : (
          <div role="presentation">
            <div className="layout-run">
              {!activeCampaign ? (
                <div style={{ padding: '2rem' }}>No active campaign.</div>
              ) : (
                <div className="tab-content">
                  <CampaignRunner />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Oracle isOpen={isOracleOpen} onClose={closeOracle} />
      <AssistantOracleModal
        isOpen={isAssistantOpen}
        onClose={closeAssistant}
        campaignId={activeCampaign?.id}
        encounterId={targetEncounterId}
        chapterId={activeChapterId}
        chapterName={activeChapter?.title}
        worldId={activeWorld?.id}
        worldName={activeWorld?.name}
        initialFocusOnInput={isAssistantFocusInput}
      />
      <ShortcutsHelp isOpen={isShortcutsHelpOpen} onClose={closeShortcutsHelp} />
      <DiceRollerModal isOpen={isDiceRollerOpen} onClose={closeDiceRoller} />
      <DebugInfoModal isOpen={isDebugInfoOpen} onClose={closeDebugInfo} />

      {/* Main Menu Modal */}
      {isMainMenuOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="main-menu-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1500
        }}>
          <div ref={mainMenuModalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '400px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            <h2 id="main-menu-title" ref={mainMenuHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>Main Menu</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openAssistant(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem', backgroundColor: '#e6f2ff', fontWeight: 'bold' }}
              >
                Assistant Oracle (Alt+A)
              </button>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openOracle(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                The Oracle (Alt+O)
              </button>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openDiceRoller(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                Dice Roller
              </button>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); toggleMode(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                Switch to {mode === 'create' ? 'Run Mode' : 'Create Mode'} (Alt+M)
              </button>
              {mode === 'create' && activeCampaign && (
                <button
                  type="button"
                  onClick={() => { closeMainMenu(false); setIsCampaignSettingsOpen(true); }}
                  style={{ padding: '0.75rem', fontSize: '1.1rem' }}
                >
                  Campaign Settings
                </button>
              )}
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openShortcutsHelp(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                Keyboard Shortcuts (Alt+H)
              </button>
              <button
                type="button"
                onClick={() => { closeMainMenu(false); openDebugInfo(); }}
                style={{ padding: '0.75rem', fontSize: '1.1rem' }}
              >
                Debug Info (LLM Metrics)
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

      {/* New Campaign Modal */}
      {isCampaignModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="switch-camp-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 2200
        }}>
          <div ref={modalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            <h2 id="switch-camp-title" ref={switchCampHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>New Campaign</h2>
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
                <button type="button" onClick={closeCampaignModal} style={{ flex: 1, padding: '1rem', background: '#eee' }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}



export default App;
