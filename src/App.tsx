import { useState } from 'react';
import { EncounterBuilder } from './components/EncounterBuilder';
import { EncounterRunner } from './components/EncounterRunner';

/**
 * AppModes: Defines the two primary contexts for the DM.
 * 'create': Planning and building encounters/NPCs.
 * 'run': Active session management and combat.
 */
type AppMode = 'create' | 'run';

function App() {
  const [mode, setMode] = useState<AppMode>('create');

  const toggleMode = () => {
    setMode((prevMode) => (prevMode === 'create' ? 'run' : 'create'));
  };

  return (
    <div className="app-container">
      <header>
        <h1 aria-label="Crits & Giggles Main Menu">Crits & Giggles</h1>
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
  );
}

function CreateLayout() {
  return (
    <section>
      <div style={{ fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '1rem' }}>Create Mode</div>
      <EncounterBuilder />
    </section>
  );
}

function RunLayout() {
  return (
    <section>
      <div style={{ fontWeight: 'bold', fontSize: '1.2rem', marginBottom: '1rem' }}>Run Mode</div>
      <EncounterRunner />
    </section>
  );
}

export default App;
