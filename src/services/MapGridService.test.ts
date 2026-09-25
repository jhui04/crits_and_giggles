import { describe, it, expect } from 'vitest';
import { mapGridService } from './MapGridService';

if (typeof globalThis.localStorage === 'undefined') {
  const storage: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    length: 0
  } as Storage;
}

describe('MapGridService', () => {
  it('does not persist fallback (confidence 0) grids to localStorage', () => {
    mapGridService.cacheResult('/maps/fallback-only.png', {
      columns: 20, rows: 20, cellPitch: 50, offsetX: 0, offsetY: 0, confidence: 0
    });
    mapGridService.cacheResult('/maps/real-grid.png', {
      columns: 30, rows: 20, cellPitch: 70, offsetX: 1, offsetY: 2, confidence: 1
    });
    const raw = localStorage.getItem('crits_map_grid_cache_v2') || '';
    expect(raw).not.toContain('fallback-only.png');
    expect(raw).toContain('real-grid.png');
  });

  it('does not alias same-named maps from different directories', () => {
    mapGridService.cacheResult('/uploads/user1/dupe-name.png', {
      columns: 11, rows: 11, cellPitch: 40, offsetX: 0, offsetY: 0, confidence: 1
    });
    expect(mapGridService.getCachedGrid('/uploads/user1/dupe-name.png')?.columns).toBe(11);
    expect(mapGridService.getCachedGrid('/uploads/user2/dupe-name.png')).toBeNull();
    expect(mapGridService.getCachedGrid('dupe-name.png')).toBeNull();
  });
});
