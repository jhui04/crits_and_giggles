import { useState } from 'react';

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
      <p>This layout will contain tools for building encounters, creating NPCs, and outlining adventures.</p>
      <ul>
        <li>Encounter Builder (Coming Soon)</li>
        <li>NPC Workshop (Coming Soon)</li>
      </ul>
    </section>
  );
}

function RunLayout() {
  return (
    <section>
      <h2>Run Mode</h2>
      <p>This layout will contain tools for tracking initiative, managing combat, and taking session notes.</p>
      <ul>
        <li>Initiative Tracker (Coming Soon)</li>
        <li>Combat Hub (Coming Soon)</li>
        <li>Active Scratchpad (Coming Soon)</li>
      </ul>
    </section>
  );
}

export default App;
