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
        <h1>Blind DM Web App</h1>
        <p role="status">
          Current Mode: <strong>{mode === 'create' ? 'Create Mode' : 'Run Mode'}</strong>
        </p>
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
      <h2>Create Mode</h2>
      <EncounterBuilder />
    </section>
  );
}

function RunLayout() {
  return (
    <section>
      <h2>Run Mode</h2>
      <EncounterRunner />
    </section>
  );
}

export default App;
