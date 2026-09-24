import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { World } from '../types';
import { WorldContext } from './WorldContext';
import { WorldApiService } from '../services/WorldApiService';

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`WorldProvider: could not write ${key} to localStorage:`, err);
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`WorldProvider: could not remove ${key} from localStorage:`, err);
  }
}

function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

// Shared across StrictMode's double-invoked mount effect so the default world is only seeded once.
let seedPromise: Promise<World | null> | null = null;

function seedDefaultWorld(): Promise<World | null> {
  if (seedPromise) return seedPromise;
  const p = (async (): Promise<World | null> => {
    try {
      const res = await fetch('/data/scraped_world.json');
      if (!res.ok) {
        console.warn(`WorldProvider: Failed to fetch scraped_world.json: ${res.status}`);
        return null;
      }
      const data = await res.json();
      const created = await WorldApiService.create(data);
      console.log('WorldProvider: Successfully seeded default world:', created.name);
      return created;
    } catch (err) {
      console.error('WorldProvider: Failed to seed default world:', err);
      return null;
    }
  })();
  seedPromise = p;
  // Allow a retry on the next mount if seeding did not produce a world.
  p.then(w => { if (!w && seedPromise === p) seedPromise = null; });
  return p;
}

export function WorldProvider({ children }: { children: ReactNode }) {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [activeWorldId, setActiveWorldId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-world save serialization + write versioning (ordered PUTs; stale GETs are dropped).
  const saveChains = useRef(new Map<string, Promise<unknown>>());
  const writeVersions = useRef(new Map<string, number>());
  const bumpVersion = useCallback((id: string) => {
    writeVersions.current.set(id, (writeVersions.current.get(id) ?? 0) + 1);
  }, []);
  const getVersion = useCallback((id: string) => writeVersions.current.get(id) ?? 0, []);

  // Load on mount
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        let fetchedWorlds = await WorldApiService.getAll();
        console.log(`WorldProvider: Fetched ${fetchedWorlds.length} worlds:`, JSON.stringify(fetchedWorlds.map(w => ({ id: w.id, name: w.name }))));

        if (fetchedWorlds.length === 0) {
          console.log('WorldProvider: DB empty, seeding default world...');
          const created = await seedDefaultWorld();
          if (created) fetchedWorlds = [created];
        }

        if (mounted) {
          setWorlds(fetchedWorlds);
          
          const savedActive = safeGetItem('crits_active_world');
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
      } finally {
        if (mounted) setIsLoaded(true);
      }
    };

    init().catch(err => {
      // init() handles its own errors; this is a last-resort guard against unhandled rejections.
      console.error('WorldProvider: unexpected init failure:', err);
      if (mounted) setError(err instanceof Error ? err.message : 'Failed to load worlds');
    });
    return () => { mounted = false; };
  }, []);

  // Cross-tab synchronization
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'crits_worlds' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) setWorlds(parsed);
        } catch (err) {
          console.warn('WorldProvider: ignoring malformed cross-tab worlds payload:', err);
        }
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
      safeSetItem('crits_worlds', JSON.stringify(worlds));
    }
  }, [worlds, isLoaded]);

  // Sync active world details
  useEffect(() => {
    let mounted = true;
    const syncActive = async () => {
      if (activeWorldId) {
        try {
          const versionAtStart = getVersion(activeWorldId);
          const full = await WorldApiService.getById(activeWorldId);
          if (mounted && getVersion(activeWorldId) === versionAtStart) {
            setWorlds(prev => prev.map(w => w.id === full.id ? full : w));
          }
        } catch (err) {
          console.error('Failed to sync active world:', err);
        }
      }
    };
    syncActive();
    return () => { mounted = false; };
  }, [activeWorldId, getVersion]);

  // Save active ID to localStorage (still useful for UI preference)
  useEffect(() => {
    if (activeWorldId) {
      safeSetItem('crits_active_world', activeWorldId);
    } else {
      safeRemoveItem('crits_active_world');
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
      return created;
    } catch (err) {
      console.error('Failed to create world:', err);
      setError('Failed to create world');
      return undefined;
    }
  };

  const updateWorld = async (updated: World) => {
    const id = updated.id;
    bumpVersion(id);
    const previous = saveChains.current.get(id) ?? Promise.resolve();
    const run = previous.then(() => WorldApiService.update(updated));
    saveChains.current.set(id, run.catch(() => undefined));
    try {
      const result = await run;
      setWorlds(prev => prev.map(w => w.id === result.id ? result : w));
    } catch (err) {
      console.error('Failed to update world:', err);
      setError('Failed to update world');
    } finally {
      bumpVersion(id);
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
        <div role="alert" style={{ color: '#b71c1c', padding: '1rem' }}>
          {error}
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
    </WorldContext.Provider>
  );
}
