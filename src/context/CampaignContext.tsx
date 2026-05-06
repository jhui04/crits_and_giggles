import { createContext, useState, useEffect, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Campaign } from '../types';

interface CampaignContextType {
  campaigns: Campaign[];
  activeCampaignId: string | null;
  activeCampaign: Campaign | undefined;
  setActiveCampaignId: (id: string | null) => void;
  createCampaign: (name: string, description: string) => void;
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
    const saved = localStorage.getItem('crits_campaigns');
    const parsedCampaigns = saved ? JSON.parse(saved) : [];

    if (parsedCampaigns.length === 0) {
      // Only seed default if there's genuinely no saved data
      const defaultCampaign: Campaign = {
        id: crypto.randomUUID(),
        name: 'Starlight Vagabonds',
        description: 'A sci-fi adventure on the edge of the galaxy.',
        chapters: [
          {
            id: crypto.randomUUID(),
            title: 'Arrival at Station 9',
            content: 'The crew arrives at # Station 9.\n\nThey are met by @Asset[npc-commander-zara]{Commander Zara} who briefs them on the situation. "We have a breach in sector 4," she says. \n\nSuddenly, an alarm blares. @Encounter[enc-breach]{Sector 4 Breach} has begun!',
            order: 0
          },
          {
            id: crypto.randomUUID(),
            title: 'The Aftermath',
            content: 'With the breach contained, the crew inspects the damage. They find a strange @Asset[item-glowing-orb]{Glowing Orb} pulsing in the wreckage.',
            order: 1
          }
        ],
        assets: [
          { id: 'npc-commander-zara', name: 'Commander Zara', type: 'NPC', description: 'A stern, no-nonsense commander with cybernetic implants.' },
          { id: 'item-glowing-orb', name: 'Glowing Orb', type: 'Item', description: 'A mysterious orb emitting a faint blue light. It hums with energy.' }
        ],
        encounters: [
          {
            id: 'enc-breach',
            name: 'Sector 4 Breach',
            units: []
          }
        ]
      };
      setCampaigns([defaultCampaign]);
      setActiveCampaignId(defaultCampaign.id);
    } else {
      setCampaigns(parsedCampaigns);
    }
    
    const savedActive = localStorage.getItem('crits_active_campaign');
    if (savedActive) {
      setActiveCampaignId(savedActive);
    }
    
    isLoaded.current = true;
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

  const createCampaign = (name: string, description: string) => {
    const newCamp: Campaign = {
      id: crypto.randomUUID(),
      name,
      description,
      chapters: [],
      assets: [],
      encounters: []
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
