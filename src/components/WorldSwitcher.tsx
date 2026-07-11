import { useState, useRef, useEffect } from 'react';
import { useWorlds } from '../context/WorldContext';

interface WorldSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorldSwitcher({ isOpen, onClose }: WorldSwitcherProps) {
  const { worlds, activeWorld, setActiveWorldId, createWorld, deleteWorld } = useWorlds();
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newWorldName, setNewWorldName] = useState('');
  const [newWorldDesc, setNewWorldDesc] = useState('');

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Focus the heading when the modal opens
      const timer = setTimeout(() => {
        headingRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isCreatingNew]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newWorldName.trim()) {
      await createWorld(newWorldName.trim(), newWorldDesc.trim());
      setNewWorldName('');
      setNewWorldDesc('');
      setIsCreatingNew(false);
      onClose();
    }
  };

  const handleSelect = (id: string) => {
    setActiveWorldId(id);
    onClose();
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete the world "${name}"? All assets and connections will be lost.`)) {
      await deleteWorld(id);
    }
  };

  return (
    <div 
      className="modal-overlay" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="world-switcher-title" 
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
        backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
        alignItems: 'center', justifyContent: 'center', zIndex: 2000
      }}
    >
      <div 
        className="modal-content" 
        style={{
          backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
          maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
        }}
      >
        {!isCreatingNew ? (
          <>
            <h2 
              id="world-switcher-title" 
              ref={headingRef} 
              tabIndex={-1} 
              style={{ outline: 'none' }}
            >
              Select World
            </h2>
            {worlds.length === 0 ? <p>No worlds found.</p> : (
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {worlds.map(w => (
                  <li key={w.id} style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      type="button"
                      onClick={() => handleSelect(w.id)}
                      style={{ flexGrow: 1, textAlign: 'left', padding: '0.75rem', fontWeight: activeWorld?.id === w.id ? 'bold' : 'normal' }}
                    >
                      {w.name}{activeWorld?.id === w.id ? ' (Active)' : ''}
                    </button>
                    <button 
                      type="button"
                      onClick={() => handleDelete(w.id, w.name)}
                      style={{ background: '#d32f2f', color: 'white', border: 'none', padding: '0 1rem' }}
                      aria-label={`Delete ${w.name}`}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
              <button 
                type="button" 
                onClick={() => setIsCreatingNew(true)} 
                style={{ flex: 1, padding: '1rem', fontWeight: 'bold' }}
              >
                + Create New World
              </button>
              <button 
                type="button" 
                onClick={onClose} 
                style={{ flex: 1, padding: '1rem', background: '#eee' }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleCreate}>
            <h2 
              id="world-switcher-title" 
              ref={headingRef} 
              tabIndex={-1} 
              style={{ outline: 'none' }}
            >
              New World
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="new-world-name">World Name:</label>
                <input 
                  id="new-world-name" 
                  type="text" 
                  required
                  value={newWorldName} 
                  onChange={e => setNewWorldName(e.target.value)} 
                  style={{ width: '100%', padding: '0.75rem' }}
                />
              </div>
              <div>
                <label htmlFor="new-world-desc">Description:</label>
                <textarea 
                  id="new-world-desc" 
                  value={newWorldDesc} 
                  onChange={e => setNewWorldDesc(e.target.value)} 
                  style={{ width: '100%', padding: '0.75rem', minHeight: '100px' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button 
                  type="submit" 
                  style={{ flex: 1, padding: '1rem', background: '#1976d2', color: 'white', fontWeight: 'bold' }}
                >
                  Create & Select
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsCreatingNew(false)} 
                  style={{ flex: 1, padding: '1rem', background: '#eee' }}
                >
                  Back
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
