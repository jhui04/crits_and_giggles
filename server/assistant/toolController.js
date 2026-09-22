import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { db } from '../db.js';
import { searchVectorStore } from './vectorStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DATA_DIR = path.resolve(__dirname, '../../public/data');
const PUBLIC_MAPS_DIR = path.resolve(__dirname, '../../public/maps');
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

// Cache static datasets
let cachedSpells = null;
let cachedMonsters = null;
let cachedMagicItems = null;

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

function getMagicItems() {
  if (!cachedMagicItems) {
    const p = path.join(PUBLIC_DATA_DIR, 'magic_items.json');
    if (fs.existsSync(p)) {
      cachedMagicItems = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } else {
      cachedMagicItems = [];
    }
  }
  return cachedMagicItems;
}

let cachedMapGrids = null;
export function getMapGrids() {
  if (!cachedMapGrids) {
    const p = path.join(PUBLIC_DATA_DIR, 'map_grids.json');
    if (fs.existsSync(p)) {
      try {
        cachedMapGrids = JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        cachedMapGrids = {};
      }
    } else {
      cachedMapGrids = {};
    }
  }
  return cachedMapGrids;
}

/**
 * Converts a 0-indexed column number to spreadsheet column letters.
 * 0 -> A, 25 -> Z, 26 -> AA, etc.
 */
export function columnIndexToLabel(index) {
  if (index < 0 || typeof index !== 'number') return '';
  let label = '';
  let num = index;
  while (num >= 0) {
    label = String.fromCharCode((num % 26) + 65) + label;
    num = Math.floor(num / 26) - 1;
  }
  return label;
}

/**
 * Converts a (x, y) coordinate into standard D&D grid cell label (e.g. "A1", "C4").
 */
export function coordinateToLabel(x, y) {
  return `${columnIndexToLabel(x)}${y + 1}`;
}

/**
 * Resolves a map URL to a local filesystem path.
 */
export function resolveMapFilePath(mapUrl) {
  if (!mapUrl || typeof mapUrl !== 'string') return null;
  const cleaned = mapUrl.split('?')[0].trim();
  const basename = path.basename(cleaned);

  // 1. Direct file in public/maps
  const p1 = path.join(PUBLIC_MAPS_DIR, basename);
  if (fs.existsSync(p1)) return p1;

  // 2. Relative from public directory
  const relPath = cleaned.replace(/^\/+/, '');
  const p2 = path.join(PUBLIC_DIR, relPath);
  if (fs.existsSync(p2)) return p2;

  // 3. Absolute path or direct match
  if (fs.existsSync(cleaned)) return cleaned;

  return null;
}

/**
 * Retrieves grid metadata (cell pitch, offsets, columns, rows) for a given map URL.
 */
export function getMapGridData(mapUrl, encounter = null) {
  const mapGrids = getMapGrids();
  if (mapUrl) {
    const cleaned = mapUrl.split('?')[0].trim();
    const basename = path.basename(cleaned);
    const candidateKeys = [
      cleaned,
      `/maps/${basename}`,
      `maps/${basename}`,
      basename,
      `/${basename}`,
    ];

    for (const key of candidateKeys) {
      if (mapGrids[key]) {
        return {
          ...mapGrids[key],
          columns: mapGrids[key].columns || 20,
          rows: mapGrids[key].rows || 20,
        };
      }
    }
  }

  // Fallback to encounter grid_config or map_size if available
  let gridConfig = null;
  let mapSize = null;
  try {
    if (encounter?.grid_config) {
      gridConfig = typeof encounter.grid_config === 'string' ? JSON.parse(encounter.grid_config) : encounter.grid_config;
    }
    if (encounter?.map_size) {
      mapSize = typeof encounter.map_size === 'string' ? JSON.parse(encounter.map_size) : encounter.map_size;
    }
  } catch {}

  const columns = gridConfig?.columns || mapSize?.width || 20;
  const rows = gridConfig?.rows || mapSize?.height || 20;
  const cellPitch = gridConfig?.cellPitch || 50;
  const offsetX = gridConfig?.offsetX || 0;
  const offsetY = gridConfig?.offsetY || 0;

  return {
    columns,
    rows,
    cellPitch,
    offsetX,
    offsetY,
    imageWidth: gridConfig?.imageWidth || columns * cellPitch,
    imageHeight: gridConfig?.imageHeight || rows * cellPitch,
  };
}

/**
 * Escapes characters for safe inclusion in SVG XML text nodes and attributes.
 */
export function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/**
 * Composites SVG combatant tokens onto a base map image and produces an optimized PNG buffer.
 */
export async function generateAnnotatedMapImage({
  imagePath,
  gridData,
  combatants = [],
  includeCombatants = true,
}) {
  let metadata;
  try {
    metadata = await sharp(imagePath).metadata();
  } catch (err) {
    throw new Error(`Failed to read image metadata for "${imagePath}": ${err.message}`);
  }

  const width = metadata.width || gridData.imageWidth || 1000;
  const height = metadata.height || gridData.imageHeight || 1000;

  // If actual image dimensions differ from calibrated grid definition, scale pitch and offsets
  const scale = gridData.imageWidth ? width / gridData.imageWidth : 1;

  const cols = gridData.columns || 20;
  const rawPitch = gridData.cellPitch || Math.floor(width / cols);
  const cellPitch = rawPitch * scale;
  const offsetX = (gridData.offsetX || 0) * scale;
  const offsetY = (gridData.offsetY || 0) * scale;

  const validCombatants = includeCombatants
    ? combatants.filter((c) => c.position && typeof c.position.x === 'number' && typeof c.position.y === 'number')
    : [];

  let compositedBuffer;

  if (validCombatants.length > 0) {
    const tokenRadius = Math.max(14, Math.min(Math.floor(cellPitch * 0.42), 36));

    const tokenSvgElements = validCombatants
      .map((c, idx) => {
        const cx = Math.round(offsetX + c.position.x * cellPitch + cellPitch / 2);
        const cy = Math.round(offsetY + c.position.y * cellPitch + cellPitch / 2);
        const isPlayer = !!c.isPlayer;
        const fillColor = isPlayer ? '#0284c7' : '#e11d48';
        const strokeColor = isPlayer ? '#bae6fd' : '#fecdd3';
        const badgeColor = isPlayer ? '#0369a1' : '#be123c';
        const initial = escapeXml((c.name || 'U').slice(0, 2).toUpperCase());
        const coordLabel = coordinateToLabel(c.position.x, c.position.y);
        const rawLabel = `${c.name} [${coordLabel}]`;
        const displayLabel = rawLabel.length > 18 ? rawLabel.slice(0, 17) + '…' : rawLabel;
        const escapedDisplayLabel = escapeXml(displayLabel);
        const badgeWidth = Math.max(76, displayLabel.length * 8 + 12);

        return `
          <g id="token-${idx}">
            <circle cx="${cx + 2}" cy="${cy + 2}" r="${tokenRadius}" fill="rgba(0,0,0,0.5)" />
            <circle cx="${cx}" cy="${cy}" r="${tokenRadius}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${Math.max(2, Math.floor(tokenRadius * 0.12))}" />
            <text x="${cx}" y="${cy + Math.floor(tokenRadius * 0.35)}" font-family="Arial, sans-serif" font-size="${Math.floor(tokenRadius * 0.9)}" font-weight="bold" fill="#ffffff" text-anchor="middle">${initial}</text>
            <rect x="${cx - Math.floor(badgeWidth / 2)}" y="${cy - tokenRadius - 22}" width="${badgeWidth}" height="20" rx="4" fill="${badgeColor}" fill-opacity="0.92" stroke="#ffffff" stroke-width="1.5" />
            <text x="${cx}" y="${cy - tokenRadius - 8}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapedDisplayLabel}</text>
          </g>
        `;
      })
      .join('\n');

    const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${tokenSvgElements}
    </svg>`;

    const pngOverlay = await sharp(Buffer.from(svgOverlay)).png().toBuffer();

    compositedBuffer = await sharp(imagePath)
      .composite([{ input: pngOverlay }])
      .png()
      .toBuffer();
  } else {
    compositedBuffer = await sharp(imagePath)
      .png()
      .toBuffer();
  }

  // Constrain max dimensions to 1024x1024 to optimize transfer speed & VRAM budget (<8GB VRAM)
  const outputBuffer = await sharp(compositedBuffer)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .png({ quality: 80, compressionLevel: 8 })
    .toBuffer();

  const base64 = outputBuffer.toString('base64');
  return {
    base64,
    dataUri: `data:image/png;base64,${base64}`,
    mimeType: 'image/png',
    width,
    height,
  };
}

/**
 * Levenshtein distance with 1D row memory optimization.
 */
export function levenshteinDistance(s1, s2) {
  const a = (s1 || '').toLowerCase().trim();
  const b = (s2 || '').toLowerCase().trim();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let str1 = a;
  let str2 = b;
  if (str1.length < str2.length) {
    str1 = b;
    str2 = a;
  }

  const len1 = str1.length;
  const len2 = str2.length;
  let prevRow = new Int32Array(len2 + 1);
  let currRow = new Int32Array(len2 + 1);

  for (let j = 0; j <= len2; j++) prevRow[j] = j;

  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;
    const c1 = str1.charCodeAt(i - 1);
    for (let j = 1; j <= len2; j++) {
      const cost = c1 === str2.charCodeAt(j - 1) ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,       // deletion
        currRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }
  return prevRow[len2];
}

/**
 * Normalized string similarity score between 0.0 and 1.0.
 */
export function stringSimilarity(s1, s2) {
  const a = (s1 || '').toLowerCase().trim();
  const b = (s2 || '').toLowerCase().trim();
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  // Short-circuit if length difference already precludes high similarity
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff / maxLen > 0.65) {
    return (maxLen - lenDiff) / maxLen * 0.5;
  }

  const dist = levenshteinDistance(a, b);
  return (maxLen - dist) / maxLen;
}

/**
 * Name similarity that compares both full strings and individual words within a multi-word name.
 */
export function nameSimilarity(query, targetName) {
  const q = (query || '').toLowerCase().trim();
  const target = (targetName || '').toLowerCase().trim();
  if (!q || !target) return 0;
  if (q === target) return 1.0;

  let best = stringSimilarity(q, target);
  const words = target.split(/\s+/);
  for (const w of words) {
    if (w.length > 2) {
      const sim = stringSimilarity(q, w);
      if (sim > best) best = sim;
    }
  }

  // Slight length-difference penalty so closer-length matches win over verbose names
  const lengthPenalty = Math.min(0.15, Math.abs(target.length - q.length) * 0.005);
  return Math.max(0, best - lengthPenalty);
}

export function tokenizeQuery(query) {
  if (!query) return [];
  return query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
}

/**
 * Token overlap ratio between query (or pre-tokenized query array) and target text.
 */
export function matchTokens(queryOrTokens, text) {
  if (!queryOrTokens || !text) return 0;
  const qTokens = Array.isArray(queryOrTokens) ? queryOrTokens : tokenizeQuery(queryOrTokens);
  if (qTokens.length === 0) return 0;
  const lowerText = text.toLowerCase();
  let matches = 0;
  for (const tok of qTokens) {
    if (lowerText.includes(tok)) matches++;
  }
  return matches / qTokens.length;
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
 * Extracts all markdown headings (#, ##, ###) from a chapter text.
 */
export function parseChapterOutline(content) {
  if (!content || typeof content !== 'string') return [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      heading: match[2].trim(),
      startIndex: match.index,
      contentStartIndex: match.index + match[0].length,
    });
  }
  return headings;
}

/**
 * Resolves a chapter from SQLite based on explicit name/ID or context.
 */
export function resolveChapter(chapterIdentifier, context = {}) {
  const { campaignId, chapterId, chapterName } = context;

  // 1. If explicit identifier provided
  if (chapterIdentifier && typeof chapterIdentifier === 'string' && chapterIdentifier.trim()) {
    const raw = chapterIdentifier.trim();
    // Try exact ID match
    let ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE id = ?').get(raw);
    if (ch) return ch;

    // Try case-insensitive title match within campaign
    if (campaignId) {
      ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE campaign_id = ? AND LOWER(title) = ?').get(campaignId, raw.toLowerCase());
      if (ch) return ch;
      ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE campaign_id = ? AND LOWER(title) LIKE ?').get(campaignId, `%${raw.toLowerCase()}%`);
      if (ch) return ch;
    }

    // Try case-insensitive title match across all campaigns
    ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE LOWER(title) = ?').get(raw.toLowerCase());
    if (ch) return ch;
    ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE LOWER(title) LIKE ?').get(`%${raw.toLowerCase()}%`);
    if (ch) return ch;

    // Fuzzy title match
    const allChaps = campaignId
      ? db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE campaign_id = ?').all(campaignId)
      : db.prepare('SELECT id, campaign_id, title, content FROM chapters').all();
    let bestMatch = null;
    let bestScore = 0;
    for (const c of allChaps) {
      const sim = nameSimilarity(raw, c.title);
      if (sim > bestScore) {
        bestScore = sim;
        bestMatch = c;
      }
    }
    if (bestMatch && bestScore >= 0.4) {
      return bestMatch;
    }
  }

  // 2. Fall back to context.chapterId
  if (chapterId) {
    const ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE id = ?').get(chapterId);
    if (ch) return ch;
  }

  // 3. Fall back to context.chapterName
  if (chapterName) {
    if (campaignId) {
      const ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE campaign_id = ? AND LOWER(title) = ?').get(campaignId, chapterName.toLowerCase());
      if (ch) return ch;
    }
    const ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE LOWER(title) = ?').get(chapterName.toLowerCase());
    if (ch) return ch;
  }

  // 4. Fall back to first chapter of campaign
  if (campaignId) {
    const ch = db.prepare('SELECT id, campaign_id, title, content FROM chapters WHERE campaign_id = ? ORDER BY order_index LIMIT 1').get(campaignId);
    if (ch) return ch;
  }

  // 5. Fall back to any chapter in database
  return db.prepare('SELECT id, campaign_id, title, content FROM chapters ORDER BY id LIMIT 1').get() || null;
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
      description: 'Look up a specific NPC, item, location, or lore asset from the active campaign, world lore, or chapters with typo tolerance.',
      parameters: {
        type: 'object',
        properties: {
          name_or_id: {
            type: 'string',
            description: 'The name or ID of the asset (e.g. "Elminster", "Sunless Citadel", "Goblin Chief").',
          },
        },
        required: ['name_or_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_magic_item',
      description: 'Look up official D&D magic item properties, rarity, attunement, notes, and rules description by name or fuzzy keywords.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the magic item (e.g. "Amulet of Health", "Bag of Holding", "Vorpal Sword")',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_assets_and_lore',
      description: 'Fuzzy search across campaign assets, world lore, chapter notes, monsters, spells, and magic items. Resolves typos (e.g. "gobln", "fierball") and finds entities matching character sheet abilities, traits, or descriptions (e.g. "telepathic monster with tentacles", "staff of power", "healing tavern keeper").',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search text, name typo, or descriptive character sheet keywords.',
          },
          category: {
            type: 'string',
            enum: ['all', 'monster', 'spell', 'magic_item', 'campaign_asset', 'world_asset', 'chapter'],
            description: 'Optional category filter to restrict search scope.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description:
        'Search the D&D knowledge base (monsters, spells, magic items, SRD rules, campaign lore) using vector semantic similarity. Ideal for conceptual, thematic, biome-based, or descriptive queries (e.g. "burrowing desert monsters", "fiery escape spells", "rules for underwater combat", "undead swamp ambushers").',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The conceptual, thematic, or descriptive search query (e.g. "desert monster that burrows into sand", "spells to slow down enemies").',
          },
          category: {
            type: 'string',
            enum: ['all', 'monster', 'spell', 'magic_item', 'srd', 'campaign_asset', 'world_asset', 'chapter'],
            description: 'Optional category filter to restrict search scope to a specific type of content.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5, max: 10).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chapter_outline',
      description:
        'Extract and return the structural markdown outline (headings #, ##, ###) of a campaign chapter. Useful for exploring chapter sections and discovering maps, room keys, encounters, or notes.',
      parameters: {
        type: 'object',
        properties: {
          chapter_name_or_id: {
            type: 'string',
            description:
              'Optional chapter name or ID. If omitted, defaults to the active chapter in the current campaign context.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_chapter_section',
      description:
        'Read the specific text content under a chapter heading until the next heading of equal or higher level. Use this to read specific rooms, encounters, maps, or lore sections from a chapter.',
      parameters: {
        type: 'object',
        properties: {
          headingName: {
            type: 'string',
            description: 'Name of the heading/section to read (e.g. "Area 1: Entrance", "Tactical Map", "Boss Encounter").',
          },
          chapter_name_or_id: {
            type: 'string',
            description:
              'Optional chapter name or ID. If omitted, defaults to the active chapter in the current campaign context.',
          },
        },
        required: ['headingName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_map',
      description:
        'Retrieve an image and tactical layout of the current combat encounter map, including character and monster grid locations, coordinates, and visual token markers.',
      parameters: {
        type: 'object',
        properties: {
          include_combatants: {
            type: 'boolean',
            description:
              'Whether to include and visually annotate character and monster positions on the map. Defaults to true.',
          },
          version: {
            type: 'string',
            enum: ['dm', 'player'],
            description:
              'Whether to retrieve the DM version (with secret notes/room numbers) or Player version of the map. Defaults to "dm".',
          },
        },
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
        const rawName = (args.name || '').trim();
        const query = rawName.toLowerCase();
        const spells = getSpells();

        // 1. Exact match
        let found = spells.find((s) => s.name && s.name.toLowerCase() === query);

        // 2. Prefix or substring match (spell name starts with or contains query)
        if (!found && query.length >= 3) {
          found = spells.find((s) => s.name && s.name.toLowerCase().startsWith(query));
          if (!found) {
            found = spells.find((s) => s.name && s.name.toLowerCase().includes(query));
          }
        }

        // 3. Fuzzy name match (typo resolution, e.g. "fierball" -> Fireball, "lightning blt" -> Lightning Bolt)
        if (!found && query.length > 2) {
          let bestScore = 0;
          let bestCandidate = null;
          for (const s of spells) {
            if (!s.name) continue;
            const sim = nameSimilarity(query, s.name);
            if (sim > bestScore) {
              bestScore = sim;
              bestCandidate = s;
            }
          }
          if (bestCandidate && bestScore >= 0.55) {
            found = bestCandidate;
          }
        }

        // 4. Description keyword search fallback
        if (!found && query.length > 3) {
          const qTokens = tokenizeQuery(query);
          let bestScore = 0;
          let bestCandidate = null;
          for (const s of spells) {
            const desc = s.description || s.desc || '';
            const matchRatio = matchTokens(qTokens, desc);
            if (matchRatio > bestScore) {
              bestScore = matchRatio;
              bestCandidate = s;
            }
          }
          if (bestCandidate && bestScore >= 0.6) {
            found = bestCandidate;
          }
        }

        result = found ? {
          name: found.name,
          level: found.level,
          school: found.school,
          casting_time: found.casting_time || found.castingTime,
          range: found.range,
          components: found.components,
          duration: found.duration,
          description: found.description || found.desc,
        } : {
          error: `Spell "${args.name}" not found.`,
          hint: 'No exact spell name match found. If you are looking for spells matching a description, effect, or tactical purpose, use the semantic_search tool with category "spell".',
        };
        break;
      }

      case 'lookup_monster': {
        const rawName = (args.name || '').trim();
        const query = rawName.toLowerCase();
        const monsters = getMonsters();

        // 1. Exact match
        let found = monsters.find((m) => m.name && m.name.toLowerCase() === query);

        // 2. Prefix or substring match (monster name starts with or contains query)
        if (!found && query.length >= 3) {
          found = monsters.find((m) => m.name && m.name.toLowerCase().startsWith(query));
          if (!found) {
            found = monsters.find((m) => m.name && m.name.toLowerCase().includes(query));
          }
        }

        // 3. Fuzzy name match (typo resolution, e.g. "abolethh" -> Aboleth, "gobln" -> Goblin)
        if (!found && query.length > 2) {
          let bestScore = 0;
          let bestCandidate = null;
          for (const m of monsters) {
            if (!m.name) continue;
            const sim = nameSimilarity(query, m.name);
            if (sim > bestScore) {
              bestScore = sim;
              bestCandidate = m;
            }
          }
          if (bestCandidate && bestScore >= 0.55) {
            found = bestCandidate;
          }
        }

        // 4. Character sheet abilities, actions, traits, or description keyword matching
        if (!found && query.length > 3) {
          const qTokens = tokenizeQuery(query);
          let bestScore = 0;
          let bestCandidate = null;
          for (const m of monsters) {
            if (!m._fullSheetText) {
              const abilitiesText = (m.special_abilities || m.traits || []).map((a) => `${a.name || ''} ${a.desc || a.content || ''}`).join(' ');
              const actionsText = (m.actions || []).map((a) => `${a.name || ''} ${a.desc || a.content || ''}`).join(' ');
              m._fullSheetText = `${m.name || ''} ${m.meta?.type || m.type || ''} ${abilitiesText} ${actionsText}`;
            }
            const matchRatio = matchTokens(qTokens, m._fullSheetText);
            if (matchRatio > bestScore) {
              bestScore = matchRatio;
              bestCandidate = m;
            }
          }
          if (bestCandidate && bestScore >= 0.6) {
            found = bestCandidate;
          }
        }

        result = found ? {
          name: found.name,
          cr: found.challenge_rating || found.cr,
          ac: found.attributes?.ac?.value ?? found.armor_class ?? found.ac,
          hp: found.attributes?.hp?.value ?? found.hit_points ?? found.hp,
          hit_dice: found.attributes?.hp?.dice || found.hit_dice,
          speed: found.attributes?.speeds || found.speed,
          abilities: found.special_abilities || found.traits,
          actions: found.actions,
        } : {
          error: `Monster "${args.name}" not found.`,
          hint: 'No exact monster name match found. If you are searching for monsters by theme, biome, concept, or description (e.g. "burrowing desert monster"), please use the semantic_search tool instead.',
        };
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

        // 1. Search campaign assets by exact name or id
        let asset = null;
        if (campaignId) {
          asset = db.prepare('SELECT id, type, name, description FROM assets WHERE campaign_id = ? AND (LOWER(name) = ? OR id = ?)').get(campaignId, nameOrId, nameOrId);
        } else {
          asset = db.prepare('SELECT id, type, name, description FROM assets WHERE LOWER(name) = ? OR id = ?').get(nameOrId, nameOrId);
        }

        // 2. Search world assets
        if (!asset) {
          let worldId = null;
          if (campaignId) {
            const camp = db.prepare('SELECT world_id FROM campaigns WHERE id = ?').get(campaignId);
            worldId = camp?.world_id;
          }
          if (worldId) {
            asset = db.prepare('SELECT id, type, name, description FROM world_assets WHERE world_id = ? AND (LOWER(name) = ? OR id = ?)').get(worldId, nameOrId, nameOrId);
          }
          if (!asset) {
            asset = db.prepare('SELECT id, type, name, description FROM world_assets WHERE LOWER(name) = ? OR id = ?').get(nameOrId, nameOrId);
          }
        }

        // 3. Search chapters
        if (!asset) {
          let chap = null;
          if (campaignId) {
            chap = db.prepare('SELECT id, title, content FROM chapters WHERE campaign_id = ? AND (LOWER(title) = ? OR id = ?)').get(campaignId, nameOrId, nameOrId);
          } else {
            chap = db.prepare('SELECT id, title, content FROM chapters WHERE LOWER(title) = ? OR id = ?').get(nameOrId, nameOrId);
          }
          if (chap) {
            asset = { id: chap.id, type: 'Chapter', name: chap.title, description: chap.content };
          }
        }

        // 4. Fuzzy search across campaign assets, world assets, and chapters
        if (!asset && nameOrId.length > 2) {
          const qTokens = tokenizeQuery(nameOrId);
          const allCampaignAssets = campaignId
            ? db.prepare('SELECT id, type, name, description FROM assets WHERE campaign_id = ?').all(campaignId)
            : db.prepare('SELECT id, type, name, description FROM assets').all();
          const allWorldAssets = db.prepare('SELECT id, type, name, description FROM world_assets').all();
          const allChapters = campaignId
            ? db.prepare('SELECT id, title, content FROM chapters WHERE campaign_id = ?').all(campaignId)
            : db.prepare('SELECT id, title, content FROM chapters').all();

          let bestMatch = null;
          let bestScore = 0;

          for (const ca of allCampaignAssets) {
            if (!ca.name) continue;
            const sim = nameSimilarity(nameOrId, ca.name);
            const tokenSim = matchTokens(qTokens, ca.description || '');
            const score = Math.max(sim, tokenSim * 0.85);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = { ...ca, source: 'campaign_asset', matchScore: Number(score.toFixed(3)) };
            }
          }

          for (const wa of allWorldAssets) {
            if (!wa.name) continue;
            const sim = nameSimilarity(nameOrId, wa.name);
            const tokenSim = matchTokens(qTokens, wa.description || '');
            const score = Math.max(sim, tokenSim * 0.85);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = { ...wa, source: 'world_asset', matchScore: Number(score.toFixed(3)) };
            }
          }

          for (const ch of allChapters) {
            if (!ch.title) continue;
            const sim = nameSimilarity(nameOrId, ch.title);
            const tokenSim = matchTokens(qTokens, ch.content || '');
            const score = Math.max(sim, tokenSim * 0.85);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = { id: ch.id, type: 'Chapter', name: ch.title, description: ch.content, source: 'chapter', matchScore: Number(score.toFixed(3)) };
            }
          }

          if (bestMatch && bestScore >= 0.5) {
            asset = bestMatch;
          }
        }

        if (asset) {
          result = asset;
        } else {
          result = { error: `Asset "${args.name_or_id}" not found in campaign, world lore, or chapters.` };
        }
        break;
      }

      case 'lookup_magic_item': {
        const rawName = (args.name || '').trim();
        const query = rawName.toLowerCase();
        const items = getMagicItems();

        // 1. Exact match
        let found = items.find((i) => (i.name && i.name.toLowerCase() === query) || String(i.id) === query || i.slug === query);

        // 2. Prefix or substring match (item name starts with or contains query)
        if (!found && query.length >= 3) {
          found = items.find((i) => i.name && i.name.toLowerCase().startsWith(query));
          if (!found) {
            found = items.find((i) => i.name && i.name.toLowerCase().includes(query));
          }
        }

        // 3. Fuzzy name match
        if (!found && query.length > 2) {
          let bestScore = 0;
          let bestCandidate = null;
          for (const it of items) {
            if (!it.name) continue;
            const sim = nameSimilarity(query, it.name);
            if (sim > bestScore) {
              bestScore = sim;
              bestCandidate = it;
            }
          }
          if (bestCandidate && bestScore >= 0.55) {
            found = bestCandidate;
          }
        }

        // 4. Description keyword match
        if (!found && query.length > 3) {
          const qTokens = tokenizeQuery(query);
          let bestScore = 0;
          let bestCandidate = null;
          for (const it of items) {
            if (!it._fullSheetText) {
              const desc = Array.isArray(it.description) ? it.description.join(' ') : (it.description || '');
              it._fullSheetText = `${it.name || ''} ${it.type || ''} ${it.notes || ''} ${desc}`;
            }
            const matchRatio = matchTokens(qTokens, it._fullSheetText);
            if (matchRatio > bestScore) {
              bestScore = matchRatio;
              bestCandidate = it;
            }
          }
          if (bestCandidate && bestScore >= 0.6) {
            found = bestCandidate;
          }
        }

        if (found) {
          result = {
            id: found.id,
            name: found.name,
            type: found.type,
            subtype: found.subtype,
            rarity: found.rarity,
            requires_attunement: found.requires_attunement,
            attunement_notes: found.attunement_notes,
            notes: found.notes,
            description: found.description,
            source: found.source,
          };
        } else {
          result = {
            error: `Magic item "${args.name}" not found.`,
            hint: 'No exact magic item name match found. If you are searching by item description, theme, or properties, use the semantic_search tool with category "magic_item".',
          };
        }
        break;
      }

      case 'search_assets_and_lore': {
        const query = (args.query || '').trim().toLowerCase();
        const category = args.category || 'all';
        const campaignId = context.campaignId;

        if (!query) {
          result = {
            query: args.query,
            matchCount: 0,
            results: [],
          };
          break;
        }

        const qTokens = tokenizeQuery(query);
        const candidates = [];

        // 1. Spells
        if (category === 'all' || category === 'spell') {
          for (const sp of getSpells()) {
            if (!sp.name) continue;
            const sim = nameSimilarity(query, sp.name);
            const descMatch = matchTokens(qTokens, sp.description || sp.desc || '');
            const score = Math.max(sim, descMatch * 0.85);
            if (score >= 0.45) {
              candidates.push({
                type: 'Spell',
                name: sp.name,
                snippet: `${sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`} ${sp.school} - ${(sp.description || sp.desc || '').slice(0, 120)}...`,
                score,
              });
            }
          }
        }

        // 2. Monsters
        if (category === 'all' || category === 'monster') {
          for (const mo of getMonsters()) {
            if (!mo.name) continue;
            const sim = nameSimilarity(query, mo.name);
            if (!mo._searchSheetText) {
              const abilitiesText = (mo.special_abilities || mo.traits || []).map((a) => `${a.name || ''} ${a.desc || a.content || ''}`).join(' ');
              mo._searchSheetText = `${mo.name || ''} ${mo.meta?.type || mo.type || ''} ${abilitiesText}`;
            }
            const descMatch = matchTokens(qTokens, mo._searchSheetText);
            const score = Math.max(sim, descMatch * 0.85);
            if (score >= 0.45) {
              candidates.push({
                type: 'Monster',
                name: mo.name,
                snippet: `CR ${mo.challenge_rating || mo.cr || 'Unknown'} - HP: ${mo.attributes?.hp?.value ?? mo.hp} - AC: ${mo.attributes?.ac?.value ?? mo.ac}`,
                score,
              });
            }
          }
        }

        // 3. Magic Items
        if (category === 'all' || category === 'magic_item') {
          for (const mi of getMagicItems()) {
            if (!mi.name) continue;
            const sim = nameSimilarity(query, mi.name);
            if (!mi._searchSheetText) {
              const desc = Array.isArray(mi.description) ? mi.description.join(' ') : (mi.description || '');
              mi._searchSheetText = `${mi.name || ''} ${mi.type || ''} ${desc}`;
            }
            const descMatch = matchTokens(qTokens, mi._searchSheetText);
            const score = Math.max(sim, descMatch * 0.85);
            if (score >= 0.45) {
              candidates.push({
                type: 'Magic Item',
                name: mi.name,
                snippet: `${mi.rarity || 'Common'} ${mi.type || 'Item'}: ${(Array.isArray(mi.description) ? mi.description.join(' ') : (mi.description || '')).slice(0, 120)}...`,
                score,
              });
            }
          }
        }

        // 4. Campaign Assets
        if (category === 'all' || category === 'campaign_asset') {
          try {
            const cas = campaignId
              ? db.prepare('SELECT id, type, name, description FROM assets WHERE campaign_id = ?').all(campaignId)
              : db.prepare('SELECT id, type, name, description FROM assets').all();
            for (const ca of cas) {
              if (!ca.name) continue;
              const sim = nameSimilarity(query, ca.name);
              const descMatch = matchTokens(qTokens, ca.description || '');
              const score = Math.max(sim, descMatch * 0.85);
              if (score >= 0.45) {
                candidates.push({
                  type: `Campaign Asset (${ca.type})`,
                  name: ca.name,
                  snippet: (ca.description || '').slice(0, 120),
                  score,
                });
              }
            }
          } catch {}
        }

        // 5. World Assets
        if (category === 'all' || category === 'world_asset') {
          try {
            const was = db.prepare('SELECT id, type, name, description FROM world_assets').all();
            for (const wa of was) {
              if (!wa.name) continue;
              const sim = nameSimilarity(query, wa.name);
              const descMatch = matchTokens(qTokens, wa.description || '');
              const score = Math.max(sim, descMatch * 0.85);
              if (score >= 0.45) {
                candidates.push({
                  type: `World Lore (${wa.type})`,
                  name: wa.name,
                  snippet: (wa.description || '').slice(0, 120),
                  score,
                });
              }
            }
          } catch {}
        }

        // 6. Chapters
        if (category === 'all' || category === 'chapter') {
          try {
            const chaps = campaignId
              ? db.prepare('SELECT id, title, content FROM chapters WHERE campaign_id = ?').all(campaignId)
              : db.prepare('SELECT id, title, content FROM chapters').all();
            for (const ch of chaps) {
              if (!ch.title) continue;
              const sim = nameSimilarity(query, ch.title);
              const descMatch = matchTokens(qTokens, ch.content || '');
              const score = Math.max(sim, descMatch * 0.85);
              if (score >= 0.45) {
                candidates.push({
                  type: 'Chapter Note',
                  name: ch.title,
                  snippet: (ch.content || '').slice(0, 120),
                  score,
                });
              }
            }
          } catch {}
        }

        candidates.sort((a, b) => b.score - a.score);
        const topResults = candidates.slice(0, 5);

        result = {
          query: args.query,
          matchCount: topResults.length,
          results: topResults,
        };
        if (topResults.length === 0) {
          result.hint = 'No exact keyword matches found. Since this looks like a conceptual, thematic, or descriptive query, please use the semantic_search tool.';
        }
        break;
      }

      case 'semantic_search': {
        const query = (args.query || '').trim();
        const category = args.category || 'all';
        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
        const campaignId = context.campaignId;

        if (!query) {
          result = {
            query: args.query,
            category,
            matchCount: 0,
            results: [],
            hint: 'Please provide a non-empty query string for semantic search.',
          };
          break;
        }

        const categoryToSourceMap = {
          chapter: 'campaign_chapter',
        };
        const sourceFilter = category && category !== 'all' ? (categoryToSourceMap[category] || category) : null;

        const topPassages = await searchVectorStore(query, {
          campaignId,
          limit,
          sourceFilter,
        });

        result = {
          query: args.query,
          category,
          matchCount: topPassages.length,
          results: topPassages.map((p) => ({
            id: p.id,
            source: p.source,
            title: p.title,
            score: p.score,
            snippet: p.content && p.content.length > 1500 ? p.content.slice(0, 1500) + '...' : p.content,
            metadata: p.metadata,
          })),
        };

        if (topPassages.length === 0) {
          result.hint = 'No semantic matches found for this query. Try broadening your query terms or removing category filters.';
        }
        break;
      }

      case 'get_chapter_outline': {
        const chapter = resolveChapter(args.chapter_name_or_id, context);
        if (!chapter) {
          result = {
            error: 'No chapter found. Please create a chapter or specify a valid chapter name/ID.',
          };
          break;
        }

        const headings = parseChapterOutline(chapter.content || '');
        result = {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          headingCount: headings.length,
          outline: headings.map((h) => ({
            level: h.level,
            heading: h.heading,
          })),
        };
        if (headings.length === 0) {
          result.note = 'No markdown headings (#, ##, ###) found in this chapter.';
        }
        break;
      }

      case 'read_chapter_section': {
        const chapter = resolveChapter(args.chapter_name_or_id, context);
        if (!chapter) {
          result = {
            error: 'No chapter found. Please create a chapter or specify a valid chapter name/ID.',
          };
          break;
        }

        const content = chapter.content || '';
        const headings = parseChapterOutline(content);
        const queryHeading = (args.headingName || '').replace(/^#+\s*/, '').toLowerCase().trim();

        if (!queryHeading) {
          result = {
            error: 'Please provide a valid headingName to read.',
            availableHeadings: headings.map((h) => h.heading),
          };
          break;
        }

        // Check for introduction / prologue if requested
        if (
          (queryHeading === 'introduction' || queryHeading === 'intro' || queryHeading === 'prologue') &&
          headings.length > 0 &&
          headings[0].startIndex > 0
        ) {
          const introText = content.slice(0, headings[0].startIndex).trim();
          if (introText) {
            result = {
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              matchedHeading: 'Introduction',
              headingLevel: 1,
              sectionContent: introText,
            };
            break;
          }
        }

        if (headings.length === 0) {
          result = {
            error: `Chapter "${chapter.title}" contains no markdown headings.`,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            fullContent: content.slice(0, 2000),
          };
          break;
        }

        // Find best matching heading
        let matchedIdx = -1;
        let bestScore = 0;

        for (let i = 0; i < headings.length; i++) {
          const h = headings[i];
          const hLower = h.heading.toLowerCase();
          if (hLower === queryHeading) {
            matchedIdx = i;
            bestScore = 1.0;
            break;
          }
          if (hLower.includes(queryHeading) || queryHeading.includes(hLower)) {
            const score = 0.85;
            if (score > bestScore) {
              bestScore = score;
              matchedIdx = i;
            }
          } else {
            const sim = nameSimilarity(queryHeading, h.heading);
            if (sim > bestScore && sim >= 0.45) {
              bestScore = sim;
              matchedIdx = i;
            }
          }
        }

        if (matchedIdx === -1) {
          result = {
            error: `Section "${args.headingName}" not found in chapter "${chapter.title}".`,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            availableHeadings: headings.map((h) => h.heading),
          };
          break;
        }

        const targetHeading = headings[matchedIdx];
        const targetLevel = targetHeading.level;
        const startPos = targetHeading.contentStartIndex;

        // Find the next heading with level <= targetLevel
        let endPos = content.length;
        for (let j = matchedIdx + 1; j < headings.length; j++) {
          if (headings[j].level <= targetLevel) {
            endPos = headings[j].startIndex;
            break;
          }
        }

        const sectionText = content.slice(startPos, endPos).trim();
        result = {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          matchedHeading: targetHeading.heading,
          headingLevel: targetHeading.level,
          sectionContent: sectionText,
        };
        break;
      }

      case 'get_current_map': {
        const includeCombatants = args.include_combatants !== false;
        const requestedVersion = (args.version || 'dm').toLowerCase().trim();
        const campaignId = context.campaignId;
        const encounterId = context.encounterId;

        // 1. Locate the active or target encounter
        let encounter = null;
        if (encounterId) {
          encounter = db
            .prepare(
              'SELECT id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config FROM encounters WHERE id = ?'
            )
            .get(encounterId);
        }

        if (!encounter && campaignId) {
          // Prefer encounter with active running state AND a map, then any with a map in this campaign
          encounter = db
            .prepare(
              'SELECT id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config FROM encounters WHERE campaign_id = ? AND (dm_map_url IS NOT NULL OR player_map_url IS NOT NULL) ORDER BY (running_state IS NOT NULL) DESC, id LIMIT 1'
            )
            .get(campaignId);
        }

        if (!encounter) {
          // Global fallback if no context provided
          encounter = db
            .prepare(
              'SELECT id, campaign_id, name, running_state, dm_map_url, player_map_url, map_size, grid_config FROM encounters WHERE (dm_map_url IS NOT NULL OR player_map_url IS NOT NULL) ORDER BY (running_state IS NOT NULL) DESC, id LIMIT 1'
            )
            .get();
        }

        if (!encounter) {
          result = {
            error: 'No combat encounter found in active context.',
            hint: 'No encounters exist in the current campaign. Create or load an encounter with a tactical map.',
          };
          break;
        }

        // 2. Select map URL based on requested version (dm vs player)
        let selectedMapUrl = null;
        let chosenVersion = requestedVersion;

        if (requestedVersion === 'player') {
          selectedMapUrl = encounter.player_map_url || encounter.dm_map_url;
          if (!encounter.player_map_url && encounter.dm_map_url) {
            chosenVersion = 'dm (fallback - no player map available)';
          }
        } else {
          selectedMapUrl = encounter.dm_map_url || encounter.player_map_url;
          if (!encounter.dm_map_url && encounter.player_map_url) {
            chosenVersion = 'player (fallback - no DM map available)';
          }
        }

        if (!selectedMapUrl) {
          result = {
            error: `No tactical map configured for encounter "${encounter.name}" (ID: ${encounter.id}).`,
            hint: 'This encounter does not have a dmMapUrl or playerMapUrl assigned. Set a map in Encounter Builder or choose an encounter with a map.',
            encounterId: encounter.id,
            encounterName: encounter.name,
          };
          break;
        }

        // 3. Resolve map file on disk
        const filePath = resolveMapFilePath(selectedMapUrl);
        if (!filePath) {
          result = {
            error: `Map image file could not be found on disk for URL: "${selectedMapUrl}".`,
            hint: 'Verify that the map file exists in the public/maps/ directory.',
            encounterId: encounter.id,
            encounterName: encounter.name,
            mapUrl: selectedMapUrl,
          };
          break;
        }

        // 4. Retrieve Grid Configuration
        const gridData = getMapGridData(selectedMapUrl, encounter);

        // 5. Gather combatants and their positions
        let allCombatants = [];
        if (encounter.running_state) {
          try {
            const rs = JSON.parse(encounter.running_state);
            if (Array.isArray(rs.combatants)) {
              allCombatants = rs.combatants.map((c) => ({
                instanceId: c.instanceId,
                name: c.name || 'Unknown',
                currentHp: c.currentHp,
                maxHp: c.maxHp,
                initiative: c.initiative,
                isPlayer: !!c.isPlayer,
                position: c.position || null,
                conditions: c.conditions || [],
              }));
            }
          } catch {}
        }

        if (allCombatants.length === 0) {
          const units = db
            .prepare(
              'SELECT instanceId, name, currentHp, maxHp, initiative, isPlayer, position_x, position_y FROM encounter_units WHERE encounter_id = ?'
            )
            .all(encounter.id);
          allCombatants = units.map((u) => ({
            instanceId: u.instanceId,
            name: u.name || 'Unknown',
            currentHp: u.currentHp,
            maxHp: u.maxHp,
            initiative: u.initiative,
            isPlayer: !!u.isPlayer,
            position:
              u.position_x !== null && u.position_y !== null
                ? { x: u.position_x, y: u.position_y }
                : null,
            conditions: [],
          }));
        }

        const combatantsWithPosition = allCombatants.filter(
          (c) => c.position && typeof c.position.x === 'number' && typeof c.position.y === 'number'
        );

        // 6. Generate Annotated Map Image
        const imageResult = await generateAnnotatedMapImage({
          imagePath: filePath,
          gridData,
          combatants: combatantsWithPosition,
          includeCombatants,
        });

        // 7. Format structured combatant locations
        const formattedCombatants = includeCombatants
          ? combatantsWithPosition.map((c) => ({
              name: c.name,
              instanceId: c.instanceId,
              team: c.isPlayer ? 'Player' : 'Monster/Enemy',
              coordinates: { x: c.position.x, y: c.position.y },
              cell: coordinateToLabel(c.position.x, c.position.y),
              hp: `${c.currentHp ?? '?'}/${c.maxHp ?? '?'}`,
              conditions: c.conditions || [],
            }))
          : [];

        result = {
          success: true,
          encounterId: encounter.id,
          encounterName: encounter.name,
          mapName: encounter.name,
          mapUrl: selectedMapUrl,
          version: chosenVersion,
          grid: {
            columns: gridData.columns,
            rows: gridData.rows,
            cellPitch: gridData.cellPitch,
          },
          combatantsCount: formattedCombatants.length,
          unplacedCombatantsCount: allCombatants.length - combatantsWithPosition.length,
          totalCombatantsInEncounter: allCombatants.length,
          combatants: formattedCombatants,
          image: imageResult.dataUri,
          imageAttached: true,
          mimeType: imageResult.mimeType,
        };
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
