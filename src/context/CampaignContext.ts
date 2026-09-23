import { createContext, useContext } from 'react';
import type { Campaign } from '../types';

export interface CampaignContextType {
  campaigns: Campaign[];
  activeCampaignId: string | null;
  activeCampaign: Campaign | undefined;
  setActiveCampaignId: (id: string | null) => void;
  activeChapterId: string | null;
  setActiveChapterId: (id: string | null) => void;
  createCampaign: (name: string, description: string, template?: Partial<Campaign>) => Promise<void>;
  updateCampaign: (campaign: Campaign) => Promise<void>;
  deleteCampaign: (id: string) => Promise<void>;
  /**
   * Re-fetches a campaign from the server and replaces the local copy in
   * state. Used after a server-side mutation (e.g. an approved HITL
   * proposal) so the client picks up the authoritative state instead of
   * re-deriving it locally and risking a stale overwrite.
   */
  refreshCampaign: (id: string) => Promise<Campaign | null>;
}

export const CampaignContext = createContext<CampaignContextType | undefined>(undefined);

export function useCampaigns() {
  const context = useContext(CampaignContext);
  if (context === undefined) {
    throw new Error('useCampaigns must be used within a CampaignProvider');
  }
  return context;
}
