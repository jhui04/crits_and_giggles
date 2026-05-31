import { createContext, useState, useEffect, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Campaign } from '../types';

interface CampaignContextType {
  campaigns: Campaign[];
  activeCampaignId: string | null;
  activeCampaign: Campaign | undefined;
  setActiveCampaignId: (id: string | null) => void;
  createCampaign: (name: string, description: string, template?: Partial<Campaign>) => void;
  updateCampaign: (campaign: Campaign) => void;
  deleteCampaign: (id: string) => void;
}

const CampaignContext = createContext<CampaignContextType | undefined>(undefined);

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const isLoaded = useRef(false);

  // Load on mount
  useEffect(() => {
    const init = async () => {
      try {
        const saved = localStorage.getItem('crits_campaigns');
        let parsedCampaigns: Campaign[] = saved ? JSON.parse(saved) : [];

        // Ensure all campaigns have the players field (migration)
        parsedCampaigns = parsedCampaigns.map(c => ({
          ...c,
          players: c.players || []
        }));

        if (parsedCampaigns.length === 0) {
          const res = await fetch('/data/scraped_campaign.json');
          if (!res.ok) throw new Error(`Failed to fetch default campaign: ${res.status}`);
          
          const data = await res.json();
          const templates = Array.isArray(data) ? data : [data];
          
          if (templates.length > 0) {
            const template = templates[0];
            const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
              ? crypto.randomUUID() 
              : Math.random().toString(36).substring(2, 15);
              
            const defaultCampaign: Campaign = {
              ...template,
              id: newId,
              players: [],
              encounters: []
            };
            setCampaigns([defaultCampaign]);
            setActiveCampaignId(defaultCampaign.id);
          } else {
            setCampaigns([]);
          }
        } else {
          setCampaigns(parsedCampaigns);
          
          const savedActive = localStorage.getItem('crits_active_campaign');
          if (savedActive) {
            setActiveCampaignId(savedActive);
          }
        }
      } catch (err) {
        console.error('CampaignContext initialization error:', err);
        setCampaigns([]);
      } finally {
        isLoaded.current = true;
      }
    };

    init();
  }, []);

  // Save on change
  useEffect(() => {
    if (isLoaded.current) {
      localStorage.setItem('crits_campaigns', JSON.stringify(campaigns));
    }
  }, [campaigns]);

  useEffect(() => {
    if (activeCampaignId) {
      localStorage.setItem('crits_active_campaign', activeCampaignId);
    } else {
      localStorage.removeItem('crits_active_campaign');
    }
  }, [activeCampaignId]);

  const createCampaign = (name: string, description: string, template?: Partial<Campaign>) => {
    const newCamp: Campaign = {
      id: crypto.randomUUID(),
      name,
      description,
      chapters: template?.chapters || [],
      assets: template?.assets || [],
      players: template?.players || [],
      encounters: template?.encounters || []
    };
    setCampaigns(prev => [...prev, newCamp]);
    setActiveCampaignId(newCamp.id);
  };

  const updateCampaign = (updated: Campaign) => {
    setCampaigns(prev => prev.map(c => c.id === updated.id ? updated : c));
  };

  const deleteCampaign = (id: string) => {
    setCampaigns(prev => prev.filter(c => c.id !== id));
    if (activeCampaignId === id) {
      setActiveCampaignId(null);
    }
  };

  const activeCampaign = campaigns.find(c => c.id === activeCampaignId);

  return (
    <CampaignContext.Provider value={{
      campaigns, activeCampaignId, activeCampaign,
      setActiveCampaignId, createCampaign, updateCampaign, deleteCampaign
    }}>
      {children}
    </CampaignContext.Provider>
  );
}

export function useCampaigns() {
  const context = useContext(CampaignContext);
  if (context === undefined) {
    throw new Error('useCampaigns must be used within a CampaignProvider');
  }
  return context;
}
