import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Campaign } from '../types';
import { CampaignContext } from './CampaignContext';
import { CampaignApiService } from '../services/CampaignApiService';
import { ensureEncountersForCampaign } from '../utils/encounterGenerator';

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load on mount
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const fetchedCampaigns = await CampaignApiService.getAll();
        console.log(`CampaignProvider: Fetched ${fetchedCampaigns.length} campaigns:`, JSON.stringify(fetchedCampaigns.map(c => ({ id: c.id, name: c.name }))));

        if (fetchedCampaigns.length === 0) {
          console.log('CampaignProvider: DB empty, seeding default...');
          const res = await fetch('/data/scraped_campaign.json');
          if (!res.ok) throw new Error(`Failed to fetch default campaign: ${res.status}`);
          
          const data = await res.json();
          const templates = Array.isArray(data) ? data : [data];
          
          if (templates.length > 0 && mounted) {
            const template = templates[0];
            const newId = crypto.randomUUID();
              
            const defaultCampaign: Campaign = ensureEncountersForCampaign({
              ...template,
              id: newId,
              players: template.players || [],
              encounters: template.encounters || []
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
            
            const created = await CampaignApiService.create(defaultCampaign);
            if (mounted) {
              setCampaigns([created]);
              setActiveCampaignId(created.id);
            }
          } else if (mounted) {
            setCampaigns([]);
          }
        } else if (mounted) {
          const ensuredCampaigns = fetchedCampaigns.map(c => ensureEncountersForCampaign(c));
          setCampaigns(ensuredCampaigns);
          
          const savedActive = localStorage.getItem('crits_active_campaign');
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
        // Don't set campaigns to [], let it stay as initial state or throw
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
      if (e.key === 'crits_campaigns' && e.newValue) {
        setCampaigns(JSON.parse(e.newValue));
      }
      if (e.key === 'crits_active_campaign' && e.newValue) {
        setActiveCampaignId(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Sync campaigns state to localStorage for storage events
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('crits_campaigns', JSON.stringify(campaigns));
    }
  }, [campaigns, isLoaded]);

  // Sync active campaign details
  useEffect(() => {
    let mounted = true;
    const syncActive = async () => {
      if (activeCampaignId) {
        try {
          const full = await CampaignApiService.getById(activeCampaignId);
          if (mounted) {
            setCampaigns(prev => prev.map(c => c.id === full.id ? ensureEncountersForCampaign(full) : c));
          }
        } catch (err) {
          console.error('Failed to sync active campaign:', err);
        }
      }
    };
    syncActive();
    return () => { mounted = false; };
  }, [activeCampaignId]);

  // Save active ID to localStorage (still useful for UI preference)
  useEffect(() => {
    if (activeCampaignId) {
      localStorage.setItem('crits_active_campaign', activeCampaignId);
    } else {
      localStorage.removeItem('crits_active_campaign');
    }
  }, [activeCampaignId]);

  const createCampaign = async (name: string, description: string, template?: Partial<Campaign>) => {
    let newCamp: Campaign = {
      id: crypto.randomUUID(),
      name,
      description,
      chapters: template?.chapters || [],
      assets: template?.assets || [],
      players: template?.players || [],
      encounters: template?.encounters || []
    };
    newCamp = ensureEncountersForCampaign(newCamp);
    
    try {
      const created = await CampaignApiService.create(newCamp);
      setCampaigns(prev => [...prev, created]);
      setActiveCampaignId(created.id);
    } catch (err) {
      console.error('Failed to create campaign:', err);
      setError('Failed to create campaign');
    }
  };

  const updateCampaign = async (updated: Campaign) => {
    try {
      const result = await CampaignApiService.update(updated);
      setCampaigns(prev => prev.map(c => c.id === result.id ? result : c));
    } catch (err) {
      console.error('Failed to update campaign:', err);
      setError('Failed to update campaign');
    }
  };

  const deleteCampaign = async (id: string) => {
    try {
      await CampaignApiService.delete(id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      if (activeCampaignId === id) {
        setActiveCampaignId(null);
      }
    } catch (err) {
      console.error('Failed to delete campaign:', err);
      setError('Failed to delete campaign');
    }
  };

  const activeCampaign = campaigns.find(c => c.id === activeCampaignId);

  return (
    <CampaignContext.Provider value={{
      campaigns, activeCampaignId, activeCampaign,
      setActiveCampaignId, createCampaign, updateCampaign, deleteCampaign
    }}>
      {isLoaded ? children : (
        <div role="status" aria-live="polite" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Loading Campaigns...</h2>
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: 'red', padding: '1rem' }}>
          {error}
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
    </CampaignContext.Provider>
  );
}
