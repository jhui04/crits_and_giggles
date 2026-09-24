import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Campaign, Encounter, EncounterUnit } from '../types';
import { CampaignContext } from './CampaignContext';
import { CampaignApiService } from '../services/CampaignApiService';
import { ensureEncountersForCampaign } from '../utils/encounterGenerator';
import { dataService } from '../services/DataService';

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`CampaignProvider: could not write ${key} to localStorage:`, err);
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`CampaignProvider: could not remove ${key} from localStorage:`, err);
  }
}

function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

// Monster data must be loaded before ensureEncountersForCampaign runs, otherwise
// auto-generated units would lack real HP/dex data.
async function ensureMonsterDataLoaded(): Promise<void> {
  try {
    await dataService.getAllMonsters();
  } catch (err) {
    console.warn('CampaignProvider: monster data failed to load; encounter units will not be auto-populated yet:', err);
  }
}

// Shared across StrictMode's double-invoked mount effect so the default campaign is only seeded once.
let seedPromise: Promise<Campaign | null> | null = null;

function seedDefaultCampaign(): Promise<Campaign | null> {
  if (seedPromise) return seedPromise;
  const p = (async (): Promise<Campaign | null> => {
    const res = await fetch('/data/scraped_campaign.json');
    if (!res.ok) throw new Error(`Failed to fetch default campaign: ${res.status}`);

    const data = await res.json();
    const templates = Array.isArray(data) ? data : [data];
    if (templates.length === 0) return null;

    const template = templates[0];
    const defaultCampaign: Campaign = ensureEncountersForCampaign({
      ...template,
      id: crypto.randomUUID(),
      players: template.players || [],
      encounters: ((template.encounters || []) as Encounter[]).map((e: Encounter) => ({
        ...e,
        units: (e.units || []).map((u: EncounterUnit) => ({ ...u, instanceId: crypto.randomUUID() }))
      }))
    });

    // If template has no encounters, add a sample one to the first chapter
    if (defaultCampaign.encounters.length === 0 && defaultCampaign.chapters.length > 0) {
      defaultCampaign.encounters.push({
        id: crypto.randomUUID(),
        name: 'Sample Encounter',
        chapterIds: [defaultCampaign.chapters[0].id],
        units: []
      });
    }

    return CampaignApiService.create(defaultCampaign);
  })();
  seedPromise = p;
  // Allow a retry after failure.
  p.catch(() => { if (seedPromise === p) seedPromise = null; });
  return p;
}

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [activeChapterIdState, setActiveChapterIdState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-campaign save serialization and write versioning (guards against out-of-order PUTs
  // and against stale GET responses overwriting newer local saves).
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
        await ensureMonsterDataLoaded();
        const fetchedCampaigns = await CampaignApiService.getAll();
        console.log(`CampaignProvider: Fetched ${fetchedCampaigns.length} campaigns:`, JSON.stringify(fetchedCampaigns.map(c => ({ id: c.id, name: c.name }))));

        if (fetchedCampaigns.length === 0) {
          console.log('CampaignProvider: DB empty, seeding default...');
          const created = await seedDefaultCampaign();
          if (mounted) {
            if (created) {
              setCampaigns([created]);
              setActiveCampaignId(created.id);
            } else {
              setCampaigns([]);
            }
          }
        } else if (mounted) {
          const ensuredCampaigns = fetchedCampaigns.map(c => ensureEncountersForCampaign(c));
          setCampaigns(ensuredCampaigns);

          const savedActive = safeGetItem('crits_active_campaign');
          if (savedActive && fetchedCampaigns.some(c => c.id === savedActive)) {
            setActiveCampaignId(savedActive);
          } else if (fetchedCampaigns.length > 0) {
            setActiveCampaignId(fetchedCampaigns[0].id);
          }
        }
      } catch (err) {
        console.error('CampaignContext initialization error:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load campaigns');
        }
      } finally {
        if (mounted) setIsLoaded(true);
      }
    };

    init().catch(err => {
      // init() handles its own errors; this is a last-resort guard against unhandled rejections.
      console.error('CampaignProvider: unexpected init failure:', err);
      if (mounted) setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    });
    return () => { mounted = false; };
  }, []);

  // Cross-tab synchronization
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'crits_campaigns' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) setCampaigns(parsed);
        } catch (err) {
          console.warn('CampaignProvider: ignoring malformed cross-tab campaigns payload:', err);
        }
      }
      if (e.key === 'crits_active_campaign' && e.newValue) {
        setActiveCampaignId(e.newValue);
      }
      if (e.key && activeCampaignId && e.key === `crits_active_chapter_${activeCampaignId}`) {
        setActiveChapterIdState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [activeCampaignId]);

  // Sync campaigns state to localStorage for storage events
  useEffect(() => {
    if (isLoaded) {
      safeSetItem('crits_campaigns', JSON.stringify(campaigns));
    }
  }, [campaigns, isLoaded]);

  // Sync active campaign details
  useEffect(() => {
    let mounted = true;
    const syncActive = async () => {
      if (activeCampaignId) {
        try {
          await ensureMonsterDataLoaded();
          const versionAtStart = getVersion(activeCampaignId);
          const full = await CampaignApiService.getById(activeCampaignId);
          // Drop the response if any local write started or finished while it was in flight.
          if (mounted && getVersion(activeCampaignId) === versionAtStart) {
            setCampaigns(prev => prev.map(c => c.id === full.id ? ensureEncountersForCampaign(full) : c));
          }
        } catch (err) {
          console.error('Failed to sync active campaign:', err);
        }
      }
    };
    syncActive();
    return () => { mounted = false; };
  }, [activeCampaignId, getVersion]);

  // Save active ID to localStorage (still useful for UI preference)
  useEffect(() => {
    if (activeCampaignId) {
      safeSetItem('crits_active_campaign', activeCampaignId);
    } else {
      safeRemoveItem('crits_active_campaign');
    }
  }, [activeCampaignId]);

  // Wrapped in useCallback (consistently across all four methods, not just
  // refreshCampaign) so consumers that put these in a dependency array
  // don't get a new function reference on every CampaignProvider render —
  // see N-8, where an unmemoized refreshCampaign was flowing into
  // AssistantOracleModal's approve handler and from there into a window
  // keydown effect, tearing that listener down and re-adding it every render.
  const createCampaign = useCallback(async (name: string, description: string, template?: Partial<Campaign>) => {
    let newCamp: Campaign = {
      id: crypto.randomUUID(),
      name,
      description,
      chapters: template?.chapters || [],
      assets: template?.assets || [],
      players: template?.players || [],
      encounters: (template?.encounters || []).map(e => ({
        ...e,
        units: (e.units || []).map(u => ({ ...u, instanceId: crypto.randomUUID() }))
      }))
    };
    await ensureMonsterDataLoaded();
    newCamp = ensureEncountersForCampaign(newCamp);

    try {
      const created = await CampaignApiService.create(newCamp);
      setCampaigns(prev => [...prev, created]);
      setActiveCampaignId(created.id);
    } catch (err) {
      console.error('Failed to create campaign:', err);
      setError('Failed to create campaign');
    }
  }, []);

  const updateCampaign = useCallback(async (updated: Campaign) => {
    const id = updated.id;
    bumpVersion(id);
    const previous = saveChains.current.get(id) ?? Promise.resolve();
    // Serialize saves per campaign so PUTs reach the server in call order.
    const run = previous.then(() => CampaignApiService.update(updated));
    saveChains.current.set(id, run.catch(() => undefined));
    try {
      const result = await run;
      setCampaigns(prev => prev.map(c => c.id === result.id ? result : c));
    } catch (err) {
      console.error('Failed to update campaign:', err);
      setError('Failed to update campaign');
    } finally {
      bumpVersion(id);
    }
  }, [bumpVersion]);

  const refreshCampaign = useCallback(async (id: string): Promise<Campaign | null> => {
    try {
      await ensureMonsterDataLoaded();
      // Wait for any queued saves so we read post-save state.
      const pending = saveChains.current.get(id);
      if (pending) await pending;
      const versionAtStart = getVersion(id);
      const full = ensureEncountersForCampaign(await CampaignApiService.getById(id));
      // If a local write started/finished during the fetch, this response may be stale:
      // return it to the caller but don't clobber newer local state.
      if (getVersion(id) === versionAtStart) {
        setCampaigns(prev => prev.map(c => c.id === full.id ? full : c));
      }
      return full;
    } catch (err) {
      console.error('Failed to refresh campaign:', err);
      return null;
    }
  }, [getVersion]);

  const deleteCampaign = useCallback(async (id: string) => {
    try {
      await CampaignApiService.delete(id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      setActiveCampaignId(prev => prev === id ? null : prev);
    } catch (err) {
      console.error('Failed to delete campaign:', err);
      setError('Failed to delete campaign');
    }
  }, []);

  const activeCampaign = campaigns.find(c => c.id === activeCampaignId);

  // Effectively active chapter id (saved or first chapter of active campaign)
  const effectiveActiveChapterId = (() => {
    if (!activeCampaignId || !activeCampaign) return null;
    if (activeChapterIdState && activeCampaign.chapters.some(ch => ch.id === activeChapterIdState)) {
      return activeChapterIdState;
    }
    const saved = safeGetItem(`crits_active_chapter_${activeCampaignId}`);
    if (saved && activeCampaign.chapters.some(ch => ch.id === saved)) {
      return saved;
    }
    return activeCampaign.chapters.length > 0 ? activeCampaign.chapters[0].id : null;
  })();

  const setActiveChapterId = (id: string | null) => {
    setActiveChapterIdState(id);
    if (activeCampaignId) {
      if (id) {
        safeSetItem(`crits_active_chapter_${activeCampaignId}`, id);
      } else {
        safeRemoveItem(`crits_active_chapter_${activeCampaignId}`);
      }
    }
  };

  return (
    <CampaignContext.Provider value={{
      campaigns, activeCampaignId, activeCampaign,
      setActiveCampaignId, activeChapterId: effectiveActiveChapterId, setActiveChapterId,
      createCampaign, updateCampaign, deleteCampaign, refreshCampaign
    }}>
      {isLoaded ? children : (
        <div role="status" aria-live="polite" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Loading Campaigns...</h2>
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: '#b71c1c', padding: '1rem' }}>
          {error}
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
    </CampaignContext.Provider>
  );
}
