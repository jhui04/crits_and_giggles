import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.js';
import { computeSemanticEmbedding, computeSemanticEmbeddingsBatch, computeLocalEmbedding, cosineSimilarity } from './embedder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DATA_DIR = path.resolve(__dirname, '../../public/data');

// Lightweight in-memory index containing ONLY vector math metadata (no heavy content text)
let cachedVectorIndex = null;

export function invalidateVectorCache() {
  cachedVectorIndex = null;
}

/**
 * Executes batch insertion of vector chunks within a single SQLite transaction
 */
export function batchUpsertVectorChunks(chunks) {
  if (!chunks || chunks.length === 0) return;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vector_chunks (id, source, campaign_id, entity_id, title, content, embedding, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runBatch = db.transaction((items) => {
    for (const item of items) {
      const embedding = item.embedding || computeLocalEmbedding(item.content, item.title);
      stmt.run(
        item.id,
        item.source,
        item.campaignId || null,
        item.entityId || null,
        item.title,
        item.content,
        JSON.stringify(embedding),
        JSON.stringify(item.metadata || {})
      );
    }
  });

  runBatch(chunks);
  invalidateVectorCache();
}

/**
 * Inserts or updates a single vector chunk in SQLite
 */
export async function upsertVectorChunk({
  id,
  source,
  campaignId = null,
  entityId = null,
  title,
  content,
  metadata = {},
  embedding = null,
}) {
  const vector = embedding || await computeSemanticEmbedding(content, title, { silent: true });

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vector_chunks (id, source, campaign_id, entity_id, title, content, embedding, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    source,
    campaignId,
    entityId,
    title,
    content,
    JSON.stringify(vector),
    JSON.stringify(metadata)
  );

  invalidateVectorCache();
}

/**
 * Indexes SRD rules, spells, and monsters into the vector store.
 * Uses batch transactions and batch semantic embeddings.
 */
export async function indexSrdAndJsonData(force = false) {
  if (!force) {
    try {
      const existing = db.prepare("SELECT COUNT(*) as count FROM vector_chunks WHERE source IN ('srd', 'spell', 'monster')").get();
      if (existing && existing.count > 0) {
        return existing.count;
      }
    } catch {
      // Table might not exist yet; proceed with indexing
    }
  }

  const chunks = [];

  // 1. SRD 5.2.1 Rules
  const srdPath = path.join(PUBLIC_DATA_DIR, 'srd_rules.json');
  if (fs.existsSync(srdPath)) {
    try {
      const srdRules = JSON.parse(fs.readFileSync(srdPath, 'utf-8'));
      for (const rule of srdRules) {
        chunks.push({
          id: `srd-${rule.id}`,
          source: 'srd',
          entityId: rule.id,
          title: `SRD Rule: ${rule.name} (${rule.category})`,
          content: rule.description,
          metadata: { category: rule.category, name: rule.name },
        });
      }
    } catch (err) {
      console.warn('Failed to load srd_rules.json:', err.message);
    }
  }

  // 2. Spells
  const spellsPath = path.join(PUBLIC_DATA_DIR, 'spells.json');
  if (fs.existsSync(spellsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(spellsPath, 'utf-8'));
      const spells = Array.isArray(raw) ? raw : (raw.spells || []);
      for (const spell of spells) {
        const title = `Spell: ${spell.name} (Level ${spell.level} ${spell.school})`;
        const descParts = [
          `Casting Time: ${spell.casting_time || spell.castingTime || '1 action'}`,
          `Range: ${spell.range || 'Self'}`,
          `Components: ${spell.components || 'V, S'}`,
          `Duration: ${spell.duration || 'Instantaneous'}`,
          spell.description || spell.desc || '',
        ];
        chunks.push({
          id: `spell-${spell.id || spell.name.toLowerCase().replace(/\s+/g, '-')}`,
          source: 'spell',
          entityId: spell.id || spell.name,
          title,
          content: descParts.filter(Boolean).join('\n'),
          metadata: { name: spell.name, level: spell.level, school: spell.school },
        });
      }
    } catch (err) {
      console.warn('Failed to load spells.json:', err.message);
    }
  }

  // 3. Monsters
  const monstersPath = path.join(PUBLIC_DATA_DIR, 'monsters.json');
  if (fs.existsSync(monstersPath)) {
    try {
      const monsters = JSON.parse(fs.readFileSync(monstersPath, 'utf-8'));
      for (const monster of monsters) {
        const monsterHp = monster.attributes?.hp?.value ?? monster.hit_points ?? monster.hp ?? 'Unknown';
        const monsterAc = monster.attributes?.ac?.value ?? monster.armor_class ?? monster.ac ?? 'Unknown';
        const monsterType = monster.meta?.type || monster.type || '';
        const monsterHitDice = monster.attributes?.hp?.dice || monster.hit_dice || '';
        const monsterSpeed = monster.attributes?.speeds || monster.speed;

        const title = `Monster: ${monster.name} (CR ${monster.challenge_rating || monster.cr || 'Unknown'} ${monsterType})`;
        const details = [
          `AC: ${monsterAc} | HP: ${monsterHp} (${monsterHitDice})`,
          `Speed: ${typeof monsterSpeed === 'string' ? monsterSpeed : JSON.stringify(monsterSpeed || {})}`,
          (monster.special_abilities || monster.traits) ? `Abilities: ${(monster.special_abilities || monster.traits).map(a => `${a.name}: ${a.desc || a.content}`).join('; ')}` : '',
          monster.actions ? `Actions: ${monster.actions.map(a => `${a.name}: ${a.desc || a.content}`).join('; ')}` : '',
        ];
        chunks.push({
          id: `monster-${monster.id || monster.name.toLowerCase().replace(/\s+/g, '-')}`,
          source: 'monster',
          entityId: monster.id || monster.name,
          title,
          content: details.filter(Boolean).join('\n'),
          metadata: { name: monster.name, cr: monster.challenge_rating || monster.cr },
        });
      }
    } catch (err) {
      console.warn('Failed to load monsters.json:', err.message);
    }
  }

  if (chunks.length > 0) {
    const embeddings = await computeSemanticEmbeddingsBatch(chunks);
    for (let i = 0; i < chunks.length; i++) {
      chunks[i].embedding = embeddings[i];
    }
    batchUpsertVectorChunks(chunks);
  }

  return chunks.length;
}

/**
 * Indexes custom campaign lore, notes, and chapters from SQLite
 */
export async function indexCampaignLore(campaignId) {
  if (!campaignId) return 0;
  const chunks = [];

  // Chapters
  const chapters = db.prepare('SELECT id, title, content FROM chapters WHERE campaign_id = ?').all(campaignId);
  for (const chap of chapters) {
    chunks.push({
      id: `camp-${campaignId}-chap-${chap.id}`,
      source: 'campaign_chapter',
      campaignId,
      entityId: chap.id,
      title: `Campaign Note: ${chap.title}`,
      content: chap.content || '',
      metadata: { chapterId: chap.id, title: chap.title },
    });
  }

  // Assets (NPCs, items, locations)
  const assets = db.prepare('SELECT id, type, name, description FROM assets WHERE campaign_id = ?').all(campaignId);
  for (const asset of assets) {
    chunks.push({
      id: `camp-${campaignId}-asset-${asset.id}`,
      source: 'campaign_asset',
      campaignId,
      entityId: asset.id,
      title: `Campaign Asset [${asset.type}]: ${asset.name}`,
      content: asset.description || '',
      metadata: { assetId: asset.id, type: asset.type, name: asset.name },
    });
  }

  // World assets if campaign is tied to a world
  const campaign = db.prepare('SELECT world_id FROM campaigns WHERE id = ?').get(campaignId);
  if (campaign && campaign.world_id) {
    const worldAssets = db.prepare('SELECT id, type, name, description FROM world_assets WHERE world_id = ?').all(campaign.world_id);
    for (const wa of worldAssets) {
      chunks.push({
        id: `world-${campaign.world_id}-asset-${wa.id}`,
        source: 'world_asset',
        campaignId,
        entityId: wa.id,
        title: `World Lore [${wa.type}]: ${wa.name}`,
        content: wa.description || '',
        metadata: { worldAssetId: wa.id, type: wa.type, name: wa.name },
      });
    }
  }

  if (chunks.length > 0) {
    const embeddings = await computeSemanticEmbeddingsBatch(chunks);
    for (let i = 0; i < chunks.length; i++) {
      chunks[i].embedding = embeddings[i];
    }
    batchUpsertVectorChunks(chunks);
  }

  return chunks.length;
}

/**
 * Lightweight in-memory index: loads ONLY id, campaign_id, title, and embedding into RAM.
 * Heavy text content and metadata are explicitly excluded from memory.
 */
function getOrLoadVectorIndex() {
  if (cachedVectorIndex) return cachedVectorIndex;

  try {
    const rows = db.prepare('SELECT id, campaign_id, title, embedding FROM vector_chunks').all();
    cachedVectorIndex = rows.map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      title: row.title,
      embedding: JSON.parse(row.embedding),
      lowerTitle: row.title.toLowerCase(),
    }));
    return cachedVectorIndex;
  } catch {
    return [];
  }
}

/**
 * Searches the vector store for the top K passages closest to the query embedding.
 * Uses real semantic embeddings when available, calculates Top-K IDs from memory,
 * and fetches full text payloads on-demand from SQLite to eliminate heap bloat.
 */
export async function searchVectorStore(query, { campaignId = null, limit = 3, forceLocal = false } = {}) {
  if (!query || typeof query !== 'string') return [];

  let index = getOrLoadVectorIndex();

  // If index is empty, auto-index base SRD and JSON data
  if (index.length === 0) {
    await indexSrdAndJsonData(true);
    if (campaignId) await indexCampaignLore(campaignId);
    index = getOrLoadVectorIndex();
  }

  // Semantic dense vector from Ollama (or deterministic fallback)
  const queryVec = forceLocal
    ? computeLocalEmbedding(query)
    : await computeSemanticEmbedding(query);

  const GENERIC_QUERY_TERMS = new Set(['spell', 'spells', 'monster', 'monsters', 'rule', 'rules', 'stats', 'stat', 'lore', 'dnd']);
  const queryClean = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const queryTokens = queryClean.split(/\s+/).filter((w) => w.length > 2 && !GENERIC_QUERY_TERMS.has(w));

  const scored = [];
  for (const item of index) {
    if (campaignId && item.campaignId && item.campaignId !== campaignId) {
      continue;
    }
    if (!campaignId && item.campaignId !== null) {
      continue;
    }

    let score = cosineSimilarity(queryVec, item.embedding);

    // Title & Entity keyword boost (hybrid dense + sparse matching)
    for (const tok of queryTokens) {
      if (item.lowerTitle.includes(tok)) {
        score += 0.35;
      }
    }

    scored.push({
      id: item.id,
      campaignId: item.campaignId,
      title: item.title,
      score: Number(score.toFixed(4)),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, limit);
  if (topMatches.length === 0) return [];

  // Secondary SQLite query: fetch title, content, metadata ONLY for the Top-K matched IDs
  const placeholders = topMatches.map(() => '?').join(',');
  const fullRows = db
    .prepare(`SELECT id, source, campaign_id, entity_id, title, content, metadata FROM vector_chunks WHERE id IN (${placeholders})`)
    .all(topMatches.map((m) => m.id));

  const rowMap = new Map(fullRows.map((r) => [r.id, r]));

  return topMatches.map((item) => {
    const full = rowMap.get(item.id);
    return {
      id: item.id,
      source: full?.source || 'srd',
      campaignId: item.campaignId,
      entityId: full?.entity_id || null,
      title: full?.title || item.title,
      content: full?.content || '',
      metadata: full?.metadata ? JSON.parse(full.metadata) : {},
      score: item.score,
    };
  });
}
