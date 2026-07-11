import type { World } from '../types';

const API_BASE = '/api';

export const WorldApiService = {
  async getAll(): Promise<World[]> {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(`${API_BASE}/worlds`);
        if (!res.ok) throw new Error(`Failed to fetch worlds: ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        console.warn(`Attempt ${i+1} to fetch worlds failed, retrying...`, err);
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw lastErr;
  },

  async getById(id: string): Promise<World> {
    const res = await fetch(`${API_BASE}/worlds/${id}`);
    if (!res.ok) throw new Error(`Failed to fetch world ${id}: ${res.status}`);
    return res.json();
  },

  async create(world: World): Promise<World> {
    const res = await fetch(`${API_BASE}/worlds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(world),
    });
    if (!res.ok) throw new Error(`Failed to create world: ${res.status}`);
    return res.json();
  },

  async update(world: World): Promise<World> {
    const res = await fetch(`${API_BASE}/worlds/${world.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(world),
    });
    if (!res.ok) throw new Error(`Failed to update world ${world.id}: ${res.status}`);
    return res.json();
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/worlds/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete world ${id}: ${res.status}`);
    }
  }
};
