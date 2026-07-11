import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { World } from '../types';
import { WorldContext } from './WorldContext';
import { WorldApiService } from '../services/WorldApiService';

export function WorldProvider({ children }: { children: ReactNode }) {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [activeWorldId, setActiveWorldId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load on mount
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        let fetchedWorlds = await WorldApiService.getAll();
        console.log(`WorldProvider: Fetched ${fetchedWorlds.length} worlds:`, JSON.stringify(fetchedWorlds.map(w => ({ id: w.id, name: w.name }))));

        if (fetchedWorlds.length === 0) {
          console.log('WorldProvider: DB empty, seeding default world...');
          try {
            const res = await fetch('/data/scraped_world.json');
            if (res.ok) {
              const data = await res.json();
              const created = await WorldApiService.create(data);
              fetchedWorlds = [created];
              console.log('WorldProvider: Successfully seeded default world:', created.name);
            } else {
              console.warn(`WorldProvider: Failed to fetch scraped_world.json: ${res.status}`);
            }
          } catch (err) {
            console.error('WorldProvider: Failed to seed default world:', err);
          }
        }

        if (mounted) {
          setWorlds(fetchedWorlds);
          
          const savedActive = localStorage.getItem('crits_active_world');
          if (savedActive && fetchedWorlds.some(w => w.id === savedActive)) {
            setActiveWorldId(savedActive);
          } else if (fetchedWorlds.length > 0) {
            setActiveWorldId(fetchedWorlds[0].id);
          }
        }
      } catch (err) {
        console.error('WorldContext initialization error:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load worlds');
        }
        throw err;
      } finally {
        if (mounted) setIsLoaded(true);
      }
    };

    init();
    return () => { mounted = false; };
  }, []);

  // Cross-tab synchronization
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'crits_worlds' && e.newValue) {
        setWorlds(JSON.parse(e.newValue));
      }
      if (e.key === 'crits_active_world' && e.newValue) {
        setActiveWorldId(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Sync worlds state to localStorage for storage events
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('crits_worlds', JSON.stringify(worlds));
    }
  }, [worlds, isLoaded]);

  // Sync active world details
  useEffect(() => {
    let mounted = true;
    const syncActive = async () => {
      if (activeWorldId) {
        try {
          const full = await WorldApiService.getById(activeWorldId);
          if (mounted) {
            setWorlds(prev => prev.map(w => w.id === full.id ? full : w));
          }
        } catch (err) {
          console.error('Failed to sync active world:', err);
        }
      }
    };
    syncActive();
    return () => { mounted = false; };
  }, [activeWorldId]);

  // Save active ID to localStorage (still useful for UI preference)
  useEffect(() => {
    if (activeWorldId) {
      localStorage.setItem('crits_active_world', activeWorldId);
    } else {
      localStorage.removeItem('crits_active_world');
    }
  }, [activeWorldId]);

  const createWorld = async (name: string, description: string) => {
    const newWorld: World = {
      id: crypto.randomUUID(),
      name,
      description,
      assets: []
    };
    
    try {
      const created = await WorldApiService.create(newWorld);
      setWorlds(prev => [...prev, created]);
      setActiveWorldId(created.id);
    } catch (err) {
      console.error('Failed to create world:', err);
      setError('Failed to create world');
    }
  };

  const updateWorld = async (updated: World) => {
    try {
      const result = await WorldApiService.update(updated);
      setWorlds(prev => prev.map(w => w.id === result.id ? result : w));
    } catch (err) {
      console.error('Failed to update world:', err);
      setError('Failed to update world');
    }
  };

  const deleteWorld = async (id: string) => {
    try {
      await WorldApiService.delete(id);
      setWorlds(prev => prev.filter(w => w.id !== id));
      if (activeWorldId === id) {
        setActiveWorldId(null);
      }
    } catch (err) {
      console.error('Failed to delete world:', err);
      setError('Failed to delete world');
    }
  };

  const activeWorld = worlds.find(w => w.id === activeWorldId);

  return (
    <WorldContext.Provider value={{
      worlds, activeWorldId, activeWorld,
      setActiveWorldId, createWorld, updateWorld, deleteWorld
    }}>
      {isLoaded ? children : (
        <div role="status" aria-live="polite" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Loading Worlds...</h2>
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: 'red', padding: '1rem' }}>
          {error}
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
    </WorldContext.Provider>
  );
}
