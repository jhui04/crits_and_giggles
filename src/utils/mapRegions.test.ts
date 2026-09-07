import { describe, it, expect } from 'vitest';
import type { MapRegion } from '../types';
import { getRegionCenter, sortRegionsByLocation } from './mapUtils';

describe('Map Region Segmentation and Lookup', () => {
  const sampleRegions: MapRegion[] = [
    {
      id: 'P5',
      name: 'Northern Bridge',
      type: 'bridge',
      description: 'Wooden bridge over ocean channel',
      cells: ['17,0', '17,1', '17,2']
    },
    {
      id: 'P7',
      name: 'Walled Manor & Fountain',
      type: 'walled_compound',
      description: 'Wealthy compound enclosed by stone fence',
      cells: ['21,3', '22,3', '23,3', '21,4', '22,4', '23,4']
    },
    {
      id: 'P8',
      name: 'Harbor Docks & Wavechaser',
      type: 'docks',
      description: 'Three wooden piers and caravel',
      cells: ['25,7', '26,7', '27,7', '24,12', '25,12', '26,12']
    },
    {
      id: 'ocean',
      name: 'Lucidian Ocean',
      type: 'water',
      description: 'Open ocean waters surrounding Flora Isle',
      cells: ['0,0', '1,0', '2,0']
    }
  ];

  function buildRegionMap(regions: MapRegion[]): Map<string, MapRegion> {
    const map = new Map<string, MapRegion>();
    for (const reg of regions) {
      for (const cell of reg.cells) {
        map.set(cell, reg);
      }
    }
    return map;
  }

  it('correctly maps specific cells to irregular structural features', () => {
    const regionMap = buildRegionMap(sampleRegions);

    // Northern bridge
    const bridgeCell = regionMap.get('17,1');
    expect(bridgeCell).toBeDefined();
    expect(bridgeCell?.id).toBe('P5');
    expect(bridgeCell?.name).toBe('Northern Bridge');

    // Walled manor courtyard
    const manorCell = regionMap.get('22,4');
    expect(manorCell).toBeDefined();
    expect(manorCell?.id).toBe('P7');
    expect(manorCell?.name).toBe('Walled Manor & Fountain');

    // Harbor Docks
    const dockCell = regionMap.get('26,7');
    expect(dockCell).toBeDefined();
    expect(dockCell?.id).toBe('P8');

    // Open Ocean
    const oceanCell = regionMap.get('0,0');
    expect(oceanCell).toBeDefined();
    expect(oceanCell?.id).toBe('ocean');

    // Unmapped cell returns undefined
    expect(regionMap.get('99,99')).toBeUndefined();
  });

  it('formats region annotations appropriately for accessible announcements', () => {
    const regionMap = buildRegionMap(sampleRegions);

    function formatRegionTag(x: number, y: number): string {
      const reg = regionMap.get(`${x},${y}`);
      if (!reg) return '';
      const idPart = reg.id && reg.id !== 'ocean' ? ` - ${reg.id}` : '';
      return ` (${reg.name}${idPart})`;
    }

    expect(formatRegionTag(17, 1)).toBe(' (Northern Bridge - P5)');
    expect(formatRegionTag(22, 4)).toBe(' (Walled Manor & Fountain - P7)');
    expect(formatRegionTag(0, 0)).toBe(' (Lucidian Ocean)');
    expect(formatRegionTag(50, 50)).toBe('');
  });

  it('calculates the representative center point that exists within the region', () => {
    const bridgeCenter = getRegionCenter(sampleRegions[0]);
    expect(bridgeCenter).toEqual({ x: 17, y: 1 });
    expect(sampleRegions[0].cells).toContain(`${bridgeCenter.x},${bridgeCenter.y}`);

    const manorCenter = getRegionCenter(sampleRegions[1]);
    expect(sampleRegions[1].cells).toContain(`${manorCenter.x},${manorCenter.y}`);
    expect(manorCenter.y).toBeGreaterThanOrEqual(3);
    expect(manorCenter.y).toBeLessThanOrEqual(4);
  });

  it('sorts regions in geographic location order from North to South', () => {
    const mapSize = { width: 33, height: 21 };
    const sorted = sortRegionsByLocation(sampleRegions, mapSize);

    // Ocean at (1,0) and Northern Bridge at (17,1) should precede Manor at (22,4) and Docks at (26,9)
    expect(sorted[0].center.y).toBeLessThanOrEqual(sorted[1].center.y);
    expect(sorted[1].center.y).toBeLessThanOrEqual(sorted[2].center.y);
    expect(sorted[2].center.y).toBeLessThanOrEqual(sorted[3].center.y);

    // Northern Bridge center is (17, 1) -> Sector North
    const bridgeItem = sorted.find(s => s.region.id === 'P5');
    expect(bridgeItem).toBeDefined();
    expect(bridgeItem?.center).toEqual({ x: 17, y: 1 });
    expect(bridgeItem?.sector).toBe('North');

    // Docks center (around row 9) -> Sector Central or East
    const dockItem = sorted.find(s => s.region.id === 'P8');
    expect(dockItem).toBeDefined();
    expect(dockItem?.sector).toContain('East');
  });

  it('correctly maps Wavechaser ship compartments across upper and lower decks', () => {
    const waveRegions: MapRegion[] = [
      {
        id: 'W-FORE',
        name: 'Forecastle & Bowsprit',
        type: 'ship_deck',
        cells: ['7,2', '8,2', '7,3', '8,3']
      },
      {
        id: 'W-MAIN',
        name: 'Main Deck & Cargo Grates',
        type: 'ship_deck',
        cells: ['6,8', '7,8', '8,8', '9,8']
      },
      {
        id: 'W-STERN',
        name: 'Quarterdeck, Helm & Ballistae',
        type: 'ship_deck',
        cells: ['7,17', '8,17', '4,19', '11,19']
      },
      {
        id: 'W-CAPT',
        name: "Captain's Cabin (Three Earrings)",
        type: 'ship_cabin',
        cells: ['23,17', '24,17', '23,18', '24,18']
      },
      {
        id: 'W-CABIN',
        name: "Passenger Cabin (Adventurers' Quarters)",
        type: 'ship_cabin',
        cells: ['26,17', '27,17', '26,18', '27,18']
      }
    ];

    const regionMap = buildRegionMap(waveRegions);

    // Weather deck forecastle
    expect(regionMap.get('7,2')?.id).toBe('W-FORE');
    // Quarterdeck stern ballista
    expect(regionMap.get('11,19')?.id).toBe('W-STERN');
    // Below deck Captain's cabin
    expect(regionMap.get('23,17')?.id).toBe('W-CAPT');
    // Below deck Passenger cabin
    expect(regionMap.get('26,17')?.id).toBe('W-CABIN');

    // Teleport centers
    const captCenter = getRegionCenter(waveRegions[3]);
    expect(waveRegions[3].cells).toContain(`${captCenter.x},${captCenter.y}`);
    expect(captCenter.x).toBeGreaterThanOrEqual(22);
    expect(captCenter.x).toBeLessThanOrEqual(24);
  });

  it('correctly maps Ruined Palma Flora undersea trench regions', () => {
    const ruinedRegions: MapRegion[] = [
      {
        id: 'P5',
        name: 'Northern Bridge Ruins',
        type: 'bridge',
        cells: ['15,1', '15,2', '16,1', '16,2']
      },
      {
        id: 'P10',
        name: 'Central Plaza & Statue of Kord',
        type: 'plaza',
        cells: ['15,9', '16,9', '15,10', '16,10']
      }
    ];

    const regionMap = buildRegionMap(ruinedRegions);
    expect(regionMap.get('15,1')?.name).toBe('Northern Bridge Ruins');
    expect(regionMap.get('15,9')?.name).toBe('Central Plaza & Statue of Kord');

    const plazaCenter = getRegionCenter(ruinedRegions[1]);
    expect(ruinedRegions[1].cells).toContain(`${plazaCenter.x},${plazaCenter.y}`);
  });
});
