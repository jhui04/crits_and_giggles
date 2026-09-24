import type { Campaign, Encounter, EncounterUnit, Position } from '../types';
import { dataService } from '../services/DataService';
import { mapGridService } from '../services/MapGridService';

const KNOWN_MAP_FILES: Record<string, { dm: string; player?: string }> = {
  '5.1': { dm: '/maps/5.1-palma-flora.png', player: '/maps/5.1-palma-flora-player.png' },
  '5.2': { dm: '/maps/5.2-wavechaser.png' },
  '5.3': { dm: '/maps/5.3-ruined-palma-flora.png', player: '/maps/5.3-ruined-palma-flora-player.png' },
  '5.4': { dm: '/maps/5.4-lower-hupperdook.png', player: '/maps/5.4-lower-hupperdook-player.jpg' },
  '5.5': { dm: '/maps/5.5-ironlot-streets.png', player: '/maps/5.5-ironlot-streets-player.png' },
  '5.6': { dm: '/maps/5.6-nima-cinnarids-house.png', player: '/maps/5.6-nima-cinnarids-house-player.jpg' },
  '5.7': { dm: '/maps/5.7-silver-falls-cavern.png', player: '/maps/5.7-silver-falls-cavern-player.png' },
  '5.8': { dm: '/maps/5.8-stahlmasts-lair.png', player: '/maps/5.8-stahlmasts-lair-player.jpg' },
  '5.9': { dm: '/maps/5.9-croaker-cave.png', player: '/maps/5.9-croaker-cave-player.png' },
  '5.10': { dm: '/maps/5.10-salsvault.png', player: '/maps/5.10-salsvault-player.png' },
  '5.11': { dm: '/maps/5.11-brokenveil-marsh.png', player: '/maps/5.11-brokenveil-marsh-player.png' },
  '5.12': { dm: '/maps/5.12-fort-venture.png', player: '/maps/5.12-fort-venture-player.png' },
};

/**
 * Automatically inspects a campaign's chapters for @Encounter tags and ensures
 * that each referenced encounter exists, is linked to the chapter, and has populated
 * combatant units derived from the monsters mentioned in that chapter.
 */
export function ensureEncountersForCampaign(campaign: Campaign): Campaign {
  const existingEncounters = [...(campaign.encounters || [])];
  const encounterMap = new Map<string, Encounter>();
  
  existingEncounters.forEach(enc => {
    // Copy chapterIds so later push() calls never mutate the caller's campaign.
    encounterMap.set(enc.id, { ...enc, chapterIds: enc.chapterIds ? [...enc.chapterIds] : enc.chapterIds });
  });

  let hasChanges = false;

  // Scan each chapter for @Encounter[id]{name} tags
  campaign.chapters.forEach(chapter => {
    const encMatches = Array.from(chapter.content.matchAll(/@Encounter\[([^\]]+)\](?:\{([^}]+)\})?/g));
    
    // Find all monsters mentioned in this chapter for auto-populating units
    const monsterMatches = Array.from(chapter.content.matchAll(/@Monster\[([^\]]+)\](?:\{([^}]+)\})?/g));
    const chapterMonsters: { id: string; name: string }[] = [];
    const seenMonsterIds = new Set<string>();

    monsterMatches.forEach(m => {
      const mId = m[1];
      const mName = m[2] || mId;
      if (!seenMonsterIds.has(mId)) {
        seenMonsterIds.add(mId);
        chapterMonsters.push({ id: mId, name: mName });
      }
    });

    encMatches.forEach(match => {
      const encId = match[1];
      const encName = match[2] || `Encounter ${encId.slice(0, 8)}`;

      let encounter = encounterMap.get(encId);

      if (!encounter) {
        // Generate new Encounter object if missing
        hasChanges = true;
        encounter = {
          id: encId,
          name: encName,
          chapterIds: [chapter.id],
          units: [],
          mapSize: { width: 20, height: 20 }
        };
        encounterMap.set(encId, encounter);
      } else {
        // Ensure chapterId is associated
        if (!encounter.chapterIds) {
          encounter.chapterIds = [chapter.id];
          hasChanges = true;
        } else if (!encounter.chapterIds.includes(chapter.id)) {
          encounter.chapterIds.push(chapter.id);
          hasChanges = true;
        }
      }

      // Check for map association if missing
      if (!encounter.dmMapUrl && !encounter.playerMapUrl) {
        const mapKeyMatch = encounter.name.match(/map\s+(\d+\.\d+)/i);
        if (mapKeyMatch && KNOWN_MAP_FILES[mapKeyMatch[1]]) {
          encounter.dmMapUrl = KNOWN_MAP_FILES[mapKeyMatch[1]].dm;
          encounter.playerMapUrl = KNOWN_MAP_FILES[mapKeyMatch[1]].player;
          const cachedGrid = mapGridService.getCachedGrid(encounter.dmMapUrl) || mapGridService.getCachedGrid(encounter.playerMapUrl);
          if (cachedGrid) {
            encounter.mapSize = {
              width: cachedGrid.columns,
              height: cachedGrid.rows,
              cellPitch: cachedGrid.cellPitch,
              offsetX: cachedGrid.offsetX,
              offsetY: cachedGrid.offsetY
            };
            encounter.gridConfig = cachedGrid;
          }
          hasChanges = true;
        }
      }

      // Auto-populate units if encounter has no units and chapter has monsters
      if (encounter.units.length === 0 && chapterMonsters.length > 0) {
        const generatedUnits: EncounterUnit[] = [];
        chapterMonsters.slice(0, 6).forEach((mon, idx) => {
          const monsterData = dataService.getMonsterByIdSync(mon.id);
          // Monster data not loaded (or unknown id): don't fabricate a placeholder unit.
          if (!monsterData) return;
          const dex = monsterData.stats?.DEX?.modifier ?? 0;
          const hpDice = monsterData.attributes?.hp?.dice || '1d1';
          const maxHp = monsterData.attributes?.hp?.value || 10;
          const pos: Position = {
            x: Math.min(18, 2 + (idx % 6) * 2),
            y: Math.min(18, 2 + Math.floor(idx / 6) * 2)
          };

          generatedUnits.push({
            instanceId: crypto.randomUUID(),
            monsterId: mon.id,
            name: mon.name,
            hpDice,
            maxHp,
            dexMod: dex,
            isPlayer: false,
            fullData: monsterData,
            position: pos
          });
        });
        if (generatedUnits.length > 0) {
          hasChanges = true;
          encounter.units = generatedUnits;
        }
      }
    });
  });

  if (!hasChanges) {
    return campaign;
  }

  return {
    ...campaign,
    encounters: Array.from(encounterMap.values())
  };
}
