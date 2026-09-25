import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../shared/spatial/fixture.ts';

const doc = makeFixture({
  images: [
    { variant: 'dm', url: '/maps/t.png', width: 400, height: 300, cellPx: 37.5, originX: 27.5, originY: 34, provenance: { source: '5etools', confidence: 1 } },
    { variant: 'player', url: '/maps/t-player.png', width: 400, height: 300, cellPx: 37.5, originX: 65, originY: -3.5, provenance: { source: '5etools', confidence: 1 } },
  ],
});
const index = {
  schemaVersion: 1,
  maps: { 'test-map': { title: doc.title, file: 'test-map.json', kind: 'tactical' } },
  byImage: { '/maps/t.png': 'test-map', '/maps/t-player.png': 'test-map' },
};

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('index.json')) return { ok: true, json: async () => index };
    if (url.endsWith('test-map.json')) return { ok: true, json: async () => doc };
    return { ok: false, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('MapDataService', () => {
  it('returns the variant grid for each image of one map, including out-of-range origins', async () => {
    stubFetch();
    const { mapDataService } = await import('./MapDataService');
    const dm = await mapDataService.getGridForUrl('/maps/t.png');
    const player = await mapDataService.getGridForUrl('/maps/t-player.png?v=2');
    expect(dm?.mapId).toBe('test-map');
    expect(dm?.offsetX).toBe(27.5);
    expect(player?.offsetX).toBe(65);
    expect(player?.offsetY).toBe(-3.5);
    expect(dm?.columns).toBe(10);
    expect(dm?.walls?.segments?.length).toBe(2);
    expect(dm?.regions?.[0].name).toBe('South Shore');
    expect(mapDataService.getCachedGridForUrl('/maps/t.png')).toBe(dm);
  });

  it('fetches the index once and returns null for unknown or foreign images', async () => {
    const fetchMock = stubFetch();
    const { mapDataService } = await import('./MapDataService');
    expect(await mapDataService.getGridForUrl('/uploads/u1/t.png')).toBeNull();
    expect(await mapDataService.getGridForUrl('/maps/other.png')).toBeNull();
    await mapDataService.getGridForUrl('/maps/t.png');
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('index.json')).length).toBe(1);
  });

  it('degrades to null when the index is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const { mapDataService } = await import('./MapDataService');
    expect(await mapDataService.getGridForUrl('/maps/t.png')).toBeNull();
  });
});
