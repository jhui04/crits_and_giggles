import { describe, it, expect, beforeEach } from 'vitest';
import { detectGridFromImageData } from './gridDetection';
import { mapGridService } from '../services/MapGridService';

// Setup localStorage mock for Node environment if absent
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

describe('Computer Vision Grid Detection Module', () => {
  it('accurately detects grid pitch and geometry on synthetic image data', () => {
    const width = 500;
    const height = 400;
    const pitch = 50;
    const offsetX = 10;
    const offsetY = 15;

    // Generate synthetic image with a square grid
    const rgba = new Uint8ClampedArray(width * height * 4);

    // Fill background with textured/noisy stone floor
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const noise = (x * 7 + y * 13) % 30;
        const base = 180 + noise;
        rgba[idx] = base;     // R
        rgba[idx + 1] = base; // G
        rgba[idx + 2] = base; // B
        rgba[idx + 3] = 255;  // A
      }
    }

    // Draw dark grid lines at offsetX + k * pitch and offsetY + m * pitch
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isVLine = (x >= offsetX) && ((x - offsetX) % pitch === 0);
        const isHLine = (y >= offsetY) && ((y - offsetY) % pitch === 0);

        if (isVLine || isHLine) {
          const idx = (y * width + x) * 4;
          rgba[idx] = 40;     // R
          rgba[idx + 1] = 40; // G
          rgba[idx + 2] = 40; // B
        }
      }
    }

    const result = detectGridFromImageData(rgba, width, height);

    expect(result.cellPitch).toBe(50);
    expect(Math.abs(result.offsetX - offsetX)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.offsetY - offsetY)).toBeLessThanOrEqual(1);
    expect(result.columns).toBeGreaterThanOrEqual(9);
    expect(result.rows).toBeGreaterThanOrEqual(7);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('handles maps where grid only appears in a sub-region (e.g. rooms with ungridded border)', () => {
    const width = 600;
    const height = 600;
    const pitch = 40;
    const offsetX = 20;
    const offsetY = 20;

    const rgba = new Uint8ClampedArray(width * height * 4);
    rgba.fill(200); // blank parchment border

    // Place gridded room inside central region [100:500, 100:500]
    for (let y = 100; y < 500; y++) {
      for (let x = 100; x < 500; x++) {
        const idx = (y * width + x) * 4;
        const isVLine = (x >= offsetX) && ((x - offsetX) % pitch === 0);
        const isHLine = (y >= offsetY) && ((y - offsetY) % pitch === 0);

        if (isVLine || isHLine) {
          rgba[idx] = 20;
          rgba[idx + 1] = 20;
          rgba[idx + 2] = 20;
        } else {
          rgba[idx] = 160;
          rgba[idx + 1] = 150;
          rgba[idx + 2] = 140;
        }
      }
    }

    const result = detectGridFromImageData(rgba, width, height);

    expect(result.cellPitch).toBe(40);
    expect(Math.abs(result.offsetX - offsetX)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.offsetY - offsetY)).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  it('falls back gracefully on empty or zero-dimension data', () => {
    const emptyRgba = new Uint8ClampedArray(0);
    const result = detectGridFromImageData(emptyRgba, 0, 0);

    expect(result.columns).toBe(20);
    expect(result.rows).toBe(20);
    expect(result.cellPitch).toBe(50);
  });
});

describe('MapGridService Caching System', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves grid configs synchronously from memory / localStorage cache', () => {
    const mockConfig = {
      columns: 33,
      rows: 21,
      cellPitch: 75,
      offsetX: 66,
      offsetY: 35,
      imageWidth: 2550,
      imageHeight: 1650,
      confidence: 1.0
    };

    mapGridService.cacheResult('/maps/custom-test-map.png', mockConfig);

    // Synchronous immediate cache hit
    const cached = mapGridService.getCachedGrid('/maps/custom-test-map.png');
    expect(cached).not.toBeNull();
    expect(cached?.columns).toBe(33);
    expect(cached?.rows).toBe(21);
    expect(cached?.cellPitch).toBe(75);

    // Check localStorage persistence
    const rawStorage = localStorage.getItem('crits_map_grid_cache');
    expect(rawStorage).toContain('custom-test-map.png');
  });

  it('normalizes filenames and paths so cached grids match both relative and full paths', () => {
    const mockConfig = {
      columns: 51,
      rows: 33,
      cellPitch: 50,
      offsetX: 18,
      offsetY: 20,
      imageWidth: 2550,
      imageHeight: 1650,
      confidence: 1.2
    };

    mapGridService.cacheResult('/maps/dungeon-test.png', mockConfig);

    // Lookup with filename only
    expect(mapGridService.getCachedGrid('dungeon-test.png')).toEqual(mockConfig);
    // Lookup with query params
    expect(mapGridService.getCachedGrid('/maps/dungeon-test.png?v=123')).toEqual(mockConfig);
  });

  it('uses existing config if passed to getOrDetectGrid without re-running detection', async () => {
    const passedConfig = {
      width: 45,
      height: 30,
      cellPitch: 60,
      offsetX: 5,
      offsetY: 8
    };

    const res = await mapGridService.getOrDetectGrid('/maps/passed-config.png', passedConfig);
    expect(res?.columns).toBe(45);
    expect(res?.rows).toBe(30);
    expect(res?.cellPitch).toBe(60);

    // Subsequent retrieval uses cache
    const secondCall = mapGridService.getCachedGrid('/maps/passed-config.png');
    expect(secondCall?.columns).toBe(45);
  });
});
