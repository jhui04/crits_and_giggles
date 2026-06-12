import type { Campaign } from '../types';

const API_BASE = '/api';

export const CampaignApiService = {
  async getAll(): Promise<Campaign[]> {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(`${API_BASE}/campaigns`);
        if (!res.ok) throw new Error(`Failed to fetch campaigns: ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        console.warn(`Attempt ${i+1} to fetch campaigns failed, retrying...`, err);
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw lastErr;
  },

  async getById(id: string): Promise<Campaign> {
    const res = await fetch(`${API_BASE}/campaigns/${id}`);
    if (!res.ok) throw new Error(`Failed to fetch campaign ${id}: ${res.status}`);
    return res.json();
  },

  async create(campaign: Campaign): Promise<Campaign> {
    const res = await fetch(`${API_BASE}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campaign),
    });
    if (!res.ok) throw new Error(`Failed to create campaign: ${res.status}`);
    return res.json();
  },

  async update(campaign: Campaign): Promise<Campaign> {
    const res = await fetch(`${API_BASE}/campaigns/${campaign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campaign),
    });
    if (!res.ok) throw new Error(`Failed to update campaign ${campaign.id}: ${res.status}`);
    return res.json();
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/campaigns/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete campaign ${id}: ${res.status}`);
    }
  }
};
