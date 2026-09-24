import type { MapGridConfig, MapSize } from '../types';
import { detectGridFromImage } from '../utils/gridDetection';

const STORAGE_KEY = 'crits_map_grid_cache';
const STATIC_CACHE_URL = '/data/map_grids.json';

class MapGridService {
  private memoryCache = new Map<string, MapGridConfig>();
  private staticCacheLoaded = false;
  private staticCachePromise: Promise<void> | null = null;
  private inFlight = new Map<string, Promise<MapGridConfig>>();

  constructor() {
    this.loadFromLocalStorage();
  }

  private loadFromLocalStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.entries(parsed).forEach(([key, val]) => {
          // Skip fallback (confidence 0) entries persisted by older versions so detection is retried.
          if ((val as MapGridConfig)?.confidence === 0) return;
          this.memoryCache.set(key, val as MapGridConfig);
        });
      }
    } catch (e) {
      console.warn('Failed to load map grid cache from localStorage:', e);
    }
  }

  private saveToLocalStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const obj: Record<string, MapGridConfig> = {};
      this.memoryCache.forEach((val, key) => {
        // Fallback grids (confidence 0) are session-only so detection can be retried later.
        if (val.confidence === 0) return;
        obj[key] = val;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn('Failed to save map grid cache to localStorage:', e);
    }
  }

  /**
   * Loads precomputed grid configs from the static data cache (public/data/map_grids.json).
   */
  public async loadStaticCache(): Promise<void> {
    if (this.staticCacheLoaded) return;
    if (this.staticCachePromise) return this.staticCachePromise;

    this.staticCachePromise = (async () => {
      try {
        const res = await fetch(STATIC_CACHE_URL);
        if (res.ok) {
          const data = await res.json();
          Object.entries(data).forEach(([key, val]) => {
            if (!this.memoryCache.has(key)) {
              this.memoryCache.set(key, val as MapGridConfig);
            }
          });
          this.saveToLocalStorage();
        }
      } catch (e) {
        console.warn('Could not load static map grid cache:', e);
      } finally {
        this.staticCacheLoaded = true;
      }
    })();

    return this.staticCachePromise;
  }

  /**
   * Normalizes URLs or file names for cache lookup.
   */
  private normalizeKey(url: string): string[] {
    const keys: string[] = [url];
    const cleaned = url.split('?')[0];
    keys.push(cleaned);
    const basename = cleaned.split('/').pop();
    // Only alias by basename for bundled maps (bare names or /maps/ paths); maps from other
    // directories with the same filename must not collide.
    const isBundledMap = !cleaned.includes('/') || cleaned.endsWith(`/maps/${basename}`);
    if (basename && isBundledMap) {
      keys.push(basename);
      keys.push(`/maps/${basename}`);
    }
    return Array.from(new Set(keys));
  }

  /**
   * Synchronously checks if grid information is already cached.
   */
  public getCachedGrid(url?: string): MapGridConfig | null {
    if (!url) return null;
    const candidateKeys = this.normalizeKey(url);
    for (const key of candidateKeys) {
      if (this.memoryCache.has(key)) {
        return this.memoryCache.get(key)!;
      }
    }
    return null;
  }

  /**
   * Retrieves grid configuration for a map URL.
   * If cached, returns immediately.
   * If not cached, first checks static JSON cache, and if still absent,
   * uses computer vision to parse the image into the grid and caches the result.
   */
  public async getOrDetectGrid(
    url?: string,
    existingConfig?: MapGridConfig | (MapSize & { cellPitch?: number; offsetX?: number; offsetY?: number })
  ): Promise<MapGridConfig | null> {
    if (!url) return null;

    // 1. If existing valid config was provided, save and return
    if (existingConfig && 'cellPitch' in existingConfig && existingConfig.cellPitch) {
      const cols = 'columns' in existingConfig ? existingConfig.columns : (existingConfig as MapSize).width;
      const rws = 'rows' in existingConfig ? existingConfig.rows : (existingConfig as MapSize).height;
      const config: MapGridConfig = {
        columns: cols,
        rows: rws,
        cellPitch: existingConfig.cellPitch,
        offsetX: existingConfig.offsetX ?? 0,
        offsetY: existingConfig.offsetY ?? 0,
        imageWidth: 'imageWidth' in existingConfig ? existingConfig.imageWidth : undefined,
        imageHeight: 'imageHeight' in existingConfig ? existingConfig.imageHeight : undefined,
        confidence: 'confidence' in existingConfig ? (existingConfig.confidence ?? 1.0) : 1.0
      };
      this.cacheResult(url, config);
      return config;
    }

    // 2. Check memory / localStorage cache
    const cached = this.getCachedGrid(url);
    if (cached) {
      return cached;
    }

    // 3. Load static cache if not yet attempted
    await this.loadStaticCache();
    const cachedAfterStatic = this.getCachedGrid(url);
    if (cachedAfterStatic) {
      return cachedAfterStatic;
    }

    // 4. First-time computation: dedupe concurrent detections for the same URL
    const pending = this.inFlight.get(url);
    if (pending) return pending;

    const promise = this.detectGrid(url).finally(() => {
      this.inFlight.delete(url);
    });
    this.inFlight.set(url, promise);
    return promise;
  }

  private async detectGrid(url: string): Promise<MapGridConfig> {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const loadedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error(`Failed to load map image for grid detection: ${url} (${e})`));
        img.src = url;
      });

      const detected = await detectGridFromImage(loadedImg);
      this.cacheResult(url, detected);
      return detected;
    } catch (err) {
      console.warn('Dynamic grid detection failed, using fallback:', err);
      const fallback: MapGridConfig = {
        columns: 20,
        rows: 20,
        cellPitch: 50,
        offsetX: 0,
        offsetY: 0,
        confidence: 0
      };
      // Kept in memory for this session only (saveToLocalStorage skips confidence 0).
      this.cacheResult(url, fallback);
      return fallback;
    }
  }

  /**
   * Caches a grid config under all normalized representations of the URL.
   */
  public cacheResult(url: string, config: MapGridConfig): void {
    const keys = this.normalizeKey(url);
    keys.forEach(k => this.memoryCache.set(k, config));
    this.saveToLocalStorage();
  }
}

export const mapGridService = new MapGridService();
