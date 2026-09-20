import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DATA_DIR = path.resolve(__dirname, '../../public/data');

// Cache static datasets
let cachedSpells = null;
let cachedMonsters = null;

function getSpells() {
  if (!cachedSpells) {
    const p = path.join(PUBLIC_DATA_DIR, 'spells.json');
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      cachedSpells = Array.isArray(parsed) ? parsed : (parsed.spells || []);
    } else {
      cachedSpells = [];
    }
  }
  return cachedSpells;
}

function getMonsters() {
  if (!cachedMonsters) {
    const p = path.join(PUBLIC_DATA_DIR, 'monsters.json');
    if (fs.existsSync(p)) {
      cachedMonsters = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } else {
      cachedMonsters = [];
    }
  }
  return cachedMonsters;
}

// In-memory audit log for executed tool calls
export const toolAuditLog = [];

export function clearToolAuditLog() {
  toolAuditLog.length = 0;
}

export function getToolAuditLog() {
  return [...toolAuditLog];
}

/**
 * Tool definitions exposed to the OpenAI API (OpenAI tool format)
 */
export const ASSISTANT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lookup_spell',
      description: 'Look up full details, casting time, components, range, and description of a D&D spell.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the spell to look up (e.g. "Fireball", "Shield", "Cure Wounds")',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_monster',
      description: 'Look up official monster statistics, armor class, hit points, actions, and abilities.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the monster (e.g. "Goblin", "Adult Red Dragon", "Aboleth")',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_monster_hp',
      description: 'Look up the HP of a monster: retrieves live HP if the monster is in the active encounter, or default stat block HP from the monster manual.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name of the monster or combatant instanceId (e.g. "Goblin", "Adult Red Dragon").',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_character_hp',
      description: 'Read the authoritative live current and maximum HP of an active encounter combatant or character from the database.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name or instanceId of the combatant/character.',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_entity_position',
      description: 'Read the authoritative current X, Y combat map grid position of a combatant from the database.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name or instanceId of the entity.',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_initiative_order',
      description: 'Fetch the active combat encounter initiative order and current combat turn from the database.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campaign_asset',
      description: 'Look up a specific NPC, item, or location asset from the active campaign or world lore.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name or ID of the asset.',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
];

const ALLOWED_TOOL_NAMES = new Set(ASSISTANT_TOOLS.map((t) => t.function.name));

/**
 * Validates tool calls and blocks any mutation attempt.
 */
export function validateToolCall(toolName, args) {
  if (!ALLOWED_TOOL_NAMES.has(toolName)) {
    throw new Error(
      `Execution blocked: Tool "${toolName}" is not allowed. The assistant only has access to explicit, read-only tools and cannot mutate game state.`
    );
  }

  if (typeof args !== 'object' || args === null) {
    throw new Error(`Invalid arguments for tool ${toolName}: Expected an object.`);
  }

  return true;
}

/**
 * Executes a read-only tool, logs the result to the audit log, and returns the result.
 */
export async function executeTool(toolName, rawArgs, context = {}) {
  let args = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      args = {};
    }
  }

  validateToolCall(toolName, args);

  const timestamp = new Date().toISOString();
  let result = null;

  try {
    switch (toolName) {
      case 'lookup_spell': {
        const query = (args.name || '').toLowerCase().trim();
        const spells = getSpells();
        const found = spells.find((s) => s.name.toLowerCase() === query) ||
                      spells.find((s) => s.name.toLowerCase().includes(query));
        result = found ? {
          name: found.name,
          level: found.level,
          school: found.school,
          casting_time: found.casting_time || found.castingTime,
          range: found.range,
          components: found.components,
          duration: found.duration,
          description: found.description || found.desc,
        } : { error: `Spell "${args.name}" not found.` };
        break;
      }

      case 'lookup_monster': {
        const query = (args.name || '').toLowerCase().trim();
        const monsters = getMonsters();
        const found = monsters.find((m) => m.name.toLowerCase() === query) ||
                      monsters.find((m) => m.name.toLowerCase().includes(query));
        result = found ? {
          name: found.name,
          cr: found.challenge_rating || found.cr,
          ac: found.attributes?.ac?.value ?? found.armor_class ?? found.ac,
          hp: found.attributes?.hp?.value ?? found.hit_points ?? found.hp,
          hit_dice: found.attributes?.hp?.dice || found.hit_dice,
          speed: found.attributes?.speeds || found.speed,
          abilities: found.special_abilities || found.traits,
          actions: found.actions,
        } : { error: `Monster "${args.name}" not found.` };
        break;
      }

      case 'get_monster_hp': {
        const nameOrId = (args.name_or_id || '').toLowerCase().trim();
        const campaignId = context.campaignId;
        const encounterId = context.encounterId;

        // 1. Check running_state for live combatant first
        let liveCombatant = null;
        let encQuery = 'SELECT id, name, running_state FROM encounters WHERE running_state IS NOT NULL';
        const encParams = [];
        if (encounterId) {
          encQuery += ' AND id = ?';
          encParams.push(encounterId);
        } else if (campaignId) {
          encQuery += ' AND campaign_id = ?';
          encParams.push(campaignId);
        }

        const activeEncs = db.prepare(encQuery).all(...encParams);
        for (const enc of activeEncs) {
          if (enc.running_state) {
            try {
              const rs = JSON.parse(enc.running_state);
              const found = rs.combatants?.find(
                (cb) =>
                  cb.instanceId === nameOrId ||
                  (cb.name && cb.name.toLowerCase() === nameOrId) ||
                  (cb.name && (cb.name.toLowerCase().includes(nameOrId) || nameOrId.includes(cb.name.toLowerCase())))
              );
              if (found) {
                liveCombatant = {
                  encounterName: enc.name,
                  instanceId: found.instanceId,
                  name: found.name,
                  currentHp: found.currentHp,
                  maxHp: found.maxHp,
                  isLiveCombatant: true,
                  conditions: found.conditions || [],
                  status: found.currentHp <= 0 ? 'Dead / Defeated' : 'Alive',
                };
                break;
              }
            } catch {}
          }
        }

        if (liveCombatant) {
          result = liveCombatant;
          break;
        }

        // 2. Check encounter_units table
        let unitQuery = 'SELECT instanceId, name, currentHp, maxHp, isPlayer FROM encounter_units WHERE (LOWER(name) LIKE ? OR instanceId = ?)';
        const unitParams = [`%${nameOrId}%`, nameOrId];
        if (encounterId) {
          unitQuery += ' AND encounter_id = ?';
          unitParams.push(encounterId);
        } else if (campaignId) {
          unitQuery += ' AND campaign_id = ?';
          unitParams.push(campaignId);
        }
        const unit = db.prepare(unitQuery).get(...unitParams);
        if (unit) {
          result = {
            instanceId: unit.instanceId,
            name: unit.name,
            currentHp: unit.currentHp,
            maxHp: unit.maxHp,
            isLiveCombatant: true,
            status: unit.currentHp <= 0 ? (unit.isPlayer ? 'Unconscious / Dying' : 'Dead / Defeated') : 'Alive',
          };
          break;
        }

        // 3. Fallback to monster manual
        const monsters = getMonsters();
        const foundMonster =
          monsters.find((m) => m.name.toLowerCase() === nameOrId) ||
          monsters.find((m) => m.name.toLowerCase().includes(nameOrId) || nameOrId.includes(m.name.toLowerCase()));

        if (foundMonster) {
          result = {
            name: foundMonster.name,
            hp: foundMonster.attributes?.hp?.value ?? foundMonster.hit_points ?? foundMonster.hp,
            hit_dice: foundMonster.attributes?.hp?.dice || foundMonster.hit_dice,
            cr: foundMonster.challenge_rating || foundMonster.cr,
            ac: foundMonster.attributes?.ac?.value ?? foundMonster.armor_class ?? foundMonster.ac,
            isLiveCombatant: false,
            source: 'Monster Manual (Base Stat Block)',
          };
        } else {
          result = { error: `Monster or combatant "${args.name_or_id}" not found in active encounter or monster manual.` };
        }
        break;
      }

      case 'get_character_hp': {
        const nameOrId = (args.name_or_id || '').toLowerCase().trim();
        const campaignId = context.campaignId;
        const encounterId = context.encounterId;

        // 1. Check active encounter running_state first
        let liveCombatant = null;
        let encQuery = 'SELECT id, name, running_state FROM encounters WHERE running_state IS NOT NULL';
        const encParams = [];
        if (encounterId) {
          encQuery += ' AND id = ?';
          encParams.push(encounterId);
        } else if (campaignId) {
          encQuery += ' AND campaign_id = ?';
          encParams.push(campaignId);
        }

        const activeEncs = db.prepare(encQuery).all(...encParams);
        for (const enc of activeEncs) {
          if (enc.running_state) {
            try {
              const rs = JSON.parse(enc.running_state);
              const found = rs.combatants?.find(
                (cb) =>
                  cb.instanceId === nameOrId ||
                  (cb.name && cb.name.toLowerCase() === nameOrId) ||
                  (cb.name && (cb.name.toLowerCase().includes(nameOrId) || nameOrId.includes(cb.name.toLowerCase())))
              );
              if (found) {
                liveCombatant = {
                  encounterName: enc.name,
                  instanceId: found.instanceId,
                  name: found.name,
                  currentHp: found.currentHp,
                  maxHp: found.maxHp,
                  isPlayer: !!found.isPlayer,
                  conditions: found.conditions || [],
                  status: found.currentHp <= 0 ? (found.isPlayer ? 'Unconscious / Dying' : 'Dead / Defeated') : 'Alive',
                };
                break;
              }
            } catch {}
          }
        }

        if (liveCombatant) {
          result = liveCombatant;
          break;
        }

        // 2. Fallback to encounter_units
        let query = 'SELECT instanceId, name, currentHp, maxHp, isPlayer FROM encounter_units WHERE (LOWER(name) LIKE ? OR instanceId = ?)';
        const params = [`%${nameOrId}%`, nameOrId];
        if (encounterId) {
          query += ' AND encounter_id = ?';
          params.push(encounterId);
        } else if (campaignId) {
          query += ' AND campaign_id = ?';
          params.push(campaignId);
        }

        const unit = db.prepare(query).get(...params);
        if (unit) {
          result = {
            instanceId: unit.instanceId,
            name: unit.name,
            currentHp: unit.currentHp,
            maxHp: unit.maxHp,
            isPlayer: !!unit.isPlayer,
            status: unit.currentHp <= 0 ? (unit.isPlayer ? 'Unconscious / Dying' : 'Dead / Defeated') : 'Alive',
          };
        } else {
          result = { error: `Character or combatant "${args.name_or_id}" not found in active encounter.` };
        }
        break;
      }

      case 'get_entity_position': {
        const nameOrId = (args.name_or_id || '').toLowerCase().trim();
        const campaignId = context.campaignId;
        const encounterId = context.encounterId;

        // 1. Check active encounter running_state first
        let livePosition = null;
        let encQuery = 'SELECT id, name, running_state FROM encounters WHERE running_state IS NOT NULL';
        const encParams = [];
        if (encounterId) {
          encQuery += ' AND id = ?';
          encParams.push(encounterId);
        } else if (campaignId) {
          encQuery += ' AND campaign_id = ?';
          encParams.push(campaignId);
        }

        const activeEncs = db.prepare(encQuery).all(...encParams);
        for (const enc of activeEncs) {
          if (enc.running_state) {
            try {
              const rs = JSON.parse(enc.running_state);
              const found = rs.combatants?.find(
                (cb) =>
                  cb.instanceId === nameOrId ||
                  (cb.name && cb.name.toLowerCase() === nameOrId) ||
                  (cb.name && (cb.name.toLowerCase().includes(nameOrId) || nameOrId.includes(cb.name.toLowerCase())))
              );
              if (found && found.position) {
                livePosition = {
                  encounterName: enc.name,
                  instanceId: found.instanceId,
                  name: found.name,
                  position: {
                    x: found.position.x,
                    y: found.position.y,
                  },
                };
                break;
              }
            } catch {}
          }
        }

        if (livePosition) {
          result = livePosition;
          break;
        }

        // 2. Fallback to encounter_units
        let query = 'SELECT instanceId, name, position_x, position_y FROM encounter_units WHERE (LOWER(name) LIKE ? OR instanceId = ?)';
        const params = [`%${nameOrId}%`, nameOrId];
        if (encounterId) {
          query += ' AND encounter_id = ?';
          params.push(encounterId);
        } else if (campaignId) {
          query += ' AND campaign_id = ?';
          params.push(campaignId);
        }

        const unit = db.prepare(query).get(...params);
        if (unit && unit.position_x !== null && unit.position_y !== null) {
          result = {
            instanceId: unit.instanceId,
            name: unit.name,
            position: {
              x: unit.position_x,
              y: unit.position_y,
            },
          };
        } else {
          result = { error: `Entity "${args.name_or_id}" position not found.` };
        }
        break;
      }

      case 'get_initiative_order': {
        const campaignId = context.campaignId;
        const encounterId = context.encounterId;

        // 1. Check running_state first
        let runningEncounter = null;
        if (encounterId) {
          runningEncounter = db.prepare('SELECT id, name, running_state FROM encounters WHERE id = ?').get(encounterId);
        } else if (campaignId) {
          runningEncounter = db.prepare('SELECT id, name, running_state FROM encounters WHERE campaign_id = ? AND running_state IS NOT NULL ORDER BY id LIMIT 1').get(campaignId);
        } else {
          runningEncounter = db.prepare('SELECT id, name, running_state FROM encounters WHERE running_state IS NOT NULL ORDER BY id LIMIT 1').get();
        }

        if (runningEncounter && runningEncounter.running_state) {
          try {
            const rs = JSON.parse(runningEncounter.running_state);
            const combatants = (rs.combatants || []).slice().sort((a, b) => (b.initiative || 0) - (a.initiative || 0));
            const currentTurn = rs.turnIndex ?? 0;
            const currentTurnCombatant = combatants[currentTurn]?.name || null;

            result = {
              encounterName: runningEncounter.name,
              isCombatStarted: !!rs.isCombatStarted,
              round: rs.round ?? 1,
              turnIndex: currentTurn,
              currentTurnCombatant,
              count: combatants.length,
              order: combatants.map((c, idx) => ({
                rank: idx + 1,
                instanceId: c.instanceId,
                name: c.name,
                initiative: c.initiative,
                currentHp: c.currentHp,
                maxHp: c.maxHp,
                isPlayer: !!c.isPlayer,
                isCurrentTurn: idx === currentTurn,
                conditions: c.conditions || [],
                position: c.position || null,
              })),
            };
            break;
          } catch {}
        }

        // 2. Fallback to encounter_units
        let query = 'SELECT instanceId, name, initiative, currentHp, maxHp, isPlayer, position_x, position_y FROM encounter_units';
        const params = [];
        if (encounterId) {
          query += ' WHERE encounter_id = ?';
          params.push(encounterId);
        } else if (campaignId) {
          query += ' WHERE campaign_id = ?';
          params.push(campaignId);
        }
        query += ' ORDER BY initiative DESC';

        const units = db.prepare(query).all(...params);
        result = {
          count: units.length,
          order: units.map((u, idx) => ({
            rank: idx + 1,
            instanceId: u.instanceId,
            name: u.name,
            initiative: u.initiative,
            currentHp: u.currentHp,
            maxHp: u.maxHp,
            isPlayer: !!u.isPlayer,
            position: u.position_x !== null ? { x: u.position_x, y: u.position_y } : null,
          })),
        };
        break;
      }

      case 'get_campaign_asset': {
        const nameOrId = (args.name_or_id || '').toLowerCase().trim();
        const campaignId = context.campaignId;

        let query = 'SELECT id, type, name, description FROM assets WHERE (LOWER(name) = ? OR id = ?)';
        const params = [nameOrId, nameOrId];
        if (campaignId) {
          query += ' AND campaign_id = ?';
          params.push(campaignId);
        }

        const asset = db.prepare(query).get(...params);
        if (asset) {
          result = asset;
        } else {
          result = { error: `Asset "${args.name_or_id}" not found in campaign.` };
        }
        break;
      }

      default:
        throw new Error(`Unrecognized tool: ${toolName}`);
    }

    const logEntry = {
      timestamp,
      toolName,
      args,
      success: true,
      resultSummary: JSON.stringify(result).slice(0, 200),
    };
    toolAuditLog.push(logEntry);
    console.log(`[ToolController Audit] ${toolName}:`, JSON.stringify(args), '=>', logEntry.resultSummary);

    return result;
  } catch (err) {
    const errorLogEntry = {
      timestamp,
      toolName,
      args,
      success: false,
      error: err.message,
    };
    toolAuditLog.push(errorLogEntry);
    console.warn(`[ToolController Error] ${toolName}:`, err.message);
    throw err;
  }
}
