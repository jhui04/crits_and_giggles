import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.js';
import {
  computeSemanticEmbedding,
  computeSemanticEmbeddingsBatch,
  computeLocalEmbedding,
  localFallbackAllowed,
  cosineSimilarity,
  embeddingKind,
  inferEmbeddingKind,
} from './embedder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DATA_DIR = path.resolve(__dirname, '../../public/data');

// Lightweight in-memory index containing ONLY vector math metadata (no heavy content text).
// Map keyed by chunk id; kept incrementally in sync by writers instead of being dropped.
let cachedVectorIndex = null;
let cachedIndexDb = null;
let loadFailed = false;
let initialIndexPromise = null;

export function invalidateVectorCache() {
  cachedVectorIndex = null;
  cachedIndexDb = null;
  loadFailed = false;
}

// Prepared statements are created lazily and re-created if setDb() swapped the db.
let stmtDb = null;
let stmts = null;
function getStmts() {
  if (stmts && stmtDb === db) return stmts;
  stmts = {
    upsert: db.prepare(`
      INSERT OR REPLACE INTO vector_chunks (id, source, campaign_id, entity_id, title, content, embedding, metadata, embedding_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deleteCampaignLore: db.prepare(`
      DELETE FROM vector_chunks
      WHERE campaign_id = ?
      AND source IN ('campaign_chapter', 'campaign_asset', 'world_asset')
    `),
  };
  stmtDb = db;
  return stmts;
}

function makeCacheEntry(id, source, campaignId, title, embeddingJson, kind = null) {
  const embedding = JSON.parse(embeddingJson);
  return {
    id,
    source,
    campaignId: campaignId ?? null,
    title,
    embedding,
    kind: kind || inferEmbeddingKind(embedding),
    lowerTitle: title.toLowerCase(),
  };
}

// Returns the live cache Map only if it is loaded and belongs to the current db.
function liveCache() {
  return cachedVectorIndex && cachedIndexDb === db ? cachedVectorIndex : null;
}

function applyEntriesToCache(entries) {
  const cache = liveCache();
  if (!cache) return;
  for (const e of entries) cache.set(e.id, e);
}

/** Drops every cached entry of a campaign's lore (mirrors the DB delete). */
export function removeCampaignFromVectorCache(campaignId, sources = null) {
  const cache = liveCache();
  if (!cache) return;
  for (const [id, e] of cache) {
    if (e.campaignId === campaignId && (!sources || sources.includes(e.source))) cache.delete(id);
  }
}

/** Removes specific chunk ids from the cache (call after deleting them from SQLite). */
export function removeVectorChunksFromCache(ids) {
  const cache = liveCache();
  if (!cache) return;
  for (const id of ids) cache.delete(id);
}

/** SQL-only batch insert (no cache update); must run inside a transaction or be wrapped. Returns cache entries. */
function insertChunks(items) {
  const { upsert } = getStmts();
  const entries = [];
  for (const item of items) {
    if (!item.embedding && !localFallbackAllowed()) {
      throw new Error(`Refusing to store chunk "${item.id}" without an embedding from the embedding model`);
    }
    const embedding = item.embedding || computeLocalEmbedding(item.content, item.title);
    const embeddingJson = JSON.stringify(embedding);
    const kind = embeddingKind(embedding);
    upsert.run(
      item.id,
      item.source,
      item.campaignId || null,
      item.entityId || null,
      item.title,
      item.content,
      embeddingJson,
      JSON.stringify(item.metadata || {}),
      kind
    );
    entries.push(makeCacheEntry(item.id, item.source, item.campaignId, item.title, embeddingJson, kind));
  }
  return entries;
}

/**
 * Executes batch insertion of vector chunks within a single SQLite transaction
 */
export function batchUpsertVectorChunks(chunks) {
  if (!chunks || chunks.length === 0) return;
  const entries = db.transaction((items) => insertChunks(items))(chunks);
  applyEntriesToCache(entries);
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
  const vector = embedding || await computeSemanticEmbedding(content, title);
  const embeddingJson = JSON.stringify(vector);

  const kind = embeddingKind(vector);

  getStmts().upsert.run(id, source, campaignId, entityId, title, content, embeddingJson, JSON.stringify(metadata), kind);

  applyEntriesToCache([makeCacheEntry(id, source, campaignId, title, embeddingJson, kind)]);
}

/**
 * Indexes SRD rules, spells, and monsters into the vector store.
 * Uses batch transactions and batch semantic embeddings.
 */
export async function indexSrdAndJsonData(force = false) {
  if (!force) {
    try {
      const existing = db.prepare("SELECT COUNT(*) as count FROM vector_chunks WHERE source IN ('srd', 'spell', 'monster', 'magic_item')").get();
      const existingMagic = db.prepare("SELECT COUNT(*) as count FROM vector_chunks WHERE source = 'magic_item'").get();
      if (existing && existing.count > 0 && existingMagic && existingMagic.count > 0) {
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

  // 4. Magic Items
  const magicItemsPath = path.join(PUBLIC_DATA_DIR, 'magic_items.json');
  if (fs.existsSync(magicItemsPath)) {
    try {
      const magicItems = JSON.parse(fs.readFileSync(magicItemsPath, 'utf-8'));
      for (const item of magicItems) {
        let descText = '';
        if (typeof item.description === 'string') {
          descText = item.description;
        } else if (Array.isArray(item.description)) {
          descText = item.description
            .map((d) => (typeof d === 'string' ? d : (d.content || (d.items ? d.items.join(', ') : ''))))
            .join('\n');
        }

        const title = `Magic Item: ${item.name} (${item.rarity || 'Common'} ${item.type || 'Item'})`;
        const details = [
          `Type: ${item.type || 'Item'} ${item.subtype ? `(${item.subtype})` : ''}`,
          `Rarity: ${item.rarity || 'Common'}${item.requires_attunement ? ' (Requires Attunement)' : ''}`,
          item.notes ? `Notes: ${item.notes}` : '',
          descText,
        ];

        chunks.push({
          id: `magic-item-${item.id || item.name.toLowerCase().replace(/\s+/g, '-')}`,
          source: 'magic_item',
          entityId: item.id || item.name,
          title,
          content: details.filter(Boolean).join('\n'),
          metadata: { name: item.name, rarity: item.rarity, type: item.type },
        });
      }
    } catch (err) {
      console.warn('Failed to load magic_items.json:', err.message);
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
 * Splits a chapter's markdown content into semantically coherent vector chunks
 * based on headings (#, ##, ###) and paragraph boundaries, preserving breadcrumbs.
 */
export function chunkMarkdownChapter(title, content, maxChunkChars = 1500) {
  if (!content || !content.trim()) {
    return [{
      sectionTitle: null,
      content: `[Chapter: ${title}]\n\n(No content)`,
    }];
  }

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

  const rawSections = [];

  if (headings.length === 0) {
    rawSections.push({
      sectionTitle: null,
      text: content.trim(),
    });
  } else {
    // Introduction before the first heading if non-empty
    if (headings[0].startIndex > 0) {
      const preText = content.slice(0, headings[0].startIndex).trim();
      if (preText.length > 0) {
        rawSections.push({
          sectionTitle: 'Introduction',
          text: preText,
        });
      }
    }

    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const startPos = h.contentStartIndex;
      const endPos = (i + 1 < headings.length) ? headings[i + 1].startIndex : content.length;
      const bodyText = content.slice(startPos, endPos).trim();
      rawSections.push({
        sectionTitle: h.heading,
        level: h.level,
        text: bodyText,
      });
    }
  }

  const chunks = [];

  for (const sec of rawSections) {
    const breadcrumb = sec.sectionTitle
      ? `[Chapter: ${title} > Section: ${sec.sectionTitle}]`
      : `[Chapter: ${title}]`;

    const fullSectionText = sec.text;
    if (fullSectionText.length <= maxChunkChars) {
      chunks.push({
        sectionTitle: sec.sectionTitle,
        content: fullSectionText ? `${breadcrumb}\n\n${fullSectionText}` : breadcrumb,
      });
    } else {
      // Split by double-newlines (paragraphs)
      const paragraphs = fullSectionText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      let currentSubChunk = '';

      for (const para of paragraphs) {
        if (!currentSubChunk) {
          currentSubChunk = para;
        } else if ((currentSubChunk.length + para.length + 2) <= maxChunkChars) {
          currentSubChunk += '\n\n' + para;
        } else {
          chunks.push({
            sectionTitle: sec.sectionTitle,
            content: `${breadcrumb}\n\n${currentSubChunk}`,
          });
          currentSubChunk = para;
        }
      }

      if (currentSubChunk) {
        chunks.push({
          sectionTitle: sec.sectionTitle,
          content: `${breadcrumb}\n\n${currentSubChunk}`,
        });
      }
    }
  }

  return chunks;
}

// Per-campaign serialization: overlapping saves run one after another so an
// older (slower) run can never overwrite the results of a newer one.
const campaignIndexQueues = new Map();

/**
 * Indexes custom campaign lore, notes, and chapters from SQLite.
 * Runs are serialized per campaign; each run reads the current DB state when it
 * starts, so the last-queued run always wins.
 */
export function indexCampaignLore(campaignId) {
  if (!campaignId) return Promise.resolve(0);

  const previous = campaignIndexQueues.get(campaignId) || Promise.resolve();
  const run = previous.catch(() => {}).then(() => indexCampaignLoreOnce(campaignId));
  campaignIndexQueues.set(campaignId, run);
  const cleanup = () => {
    if (campaignIndexQueues.get(campaignId) === run) campaignIndexQueues.delete(campaignId);
  };
  run.then(cleanup, cleanup);
  return run;
}

const LORE_SOURCES = ['campaign_chapter', 'campaign_asset', 'world_asset'];

async function indexCampaignLoreOnce(campaignId) {
  const chunks = [];

  // Chapters: chunked by heading and paragraph with breadcrumbs
  const chapters = db.prepare('SELECT id, title, content FROM chapters WHERE campaign_id = ?').all(campaignId);
  for (const chap of chapters) {
    const chapterChunks = chunkMarkdownChapter(chap.title, chap.content || '', 1500);
    chapterChunks.forEach((cChunk, cIdx) => {
      const chunkTitle = cChunk.sectionTitle
        ? `Campaign Note: ${chap.title} > ${cChunk.sectionTitle}`
        : `Campaign Note: ${chap.title}`;
      chunks.push({
        id: `camp-${campaignId}-chap-${chap.id}-sec-${cIdx}`,
        source: 'campaign_chapter',
        campaignId,
        entityId: chap.id,
        title: chunkTitle,
        content: cChunk.content,
        metadata: {
          chapterId: chap.id,
          title: chap.title,
          section: cChunk.sectionTitle || null,
          partIndex: cIdx,
        },
      });
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
        id: `camp-${campaignId}-world-${campaign.world_id}-asset-${wa.id}`,
        source: 'world_asset',
        campaignId,
        entityId: wa.id,
        title: `World Lore [${wa.type}]: ${wa.name}`,
        content: wa.description || '',
        metadata: { worldAssetId: wa.id, type: wa.type, name: wa.name },
      });
    }
  }

  // Embed FIRST (async, may fail) so a failure leaves the existing lore intact.
  if (chunks.length > 0) {
    const embeddings = await computeSemanticEmbeddingsBatch(chunks);
    for (let i = 0; i < chunks.length; i++) {
      chunks[i].embedding = embeddings[i];
    }
  }

  // Then swap old for new in one synchronous transaction. Deleting by
  // campaign_id also clears legacy-format world_asset rows (ids of the form
  // `world-<worldId>-asset-<id>`) that were tagged with this campaign.
  const swap = db.transaction(() => {
    getStmts().deleteCampaignLore.run(campaignId);
    return insertChunks(chunks);
  });
  const entries = swap();
  // Only touch the cache after the transaction committed.
  removeCampaignFromVectorCache(campaignId, LORE_SOURCES);
  applyEntriesToCache(entries);

  return chunks.length;
}

/**
 * Lightweight in-memory index: loads ONLY id, campaign_id, title, and embedding into RAM.
 * Heavy text content and metadata are explicitly excluded from memory.
 */
function getOrLoadVectorIndex() {
  const live = liveCache();
  if (live) return live;

  try {
    const rows = db.prepare('SELECT id, source, campaign_id, title, embedding, embedding_kind FROM vector_chunks').all();
    const map = new Map();
    for (const row of rows) {
      map.set(row.id, makeCacheEntry(row.id, row.source, row.campaign_id, row.title, row.embedding, row.embedding_kind));
    }
    cachedVectorIndex = map;
    cachedIndexDb = db;
    loadFailed = false;
    return map;
  } catch {
    // Do not cache; flag so the caller doesn't launch a forced reindex against a broken DB.
    loadFailed = true;
    return new Map();
  }
}

/** Shared in-flight initial SRD index so concurrent queries don't each reindex. */
function ensureInitialIndex() {
  if (!initialIndexPromise) {
    initialIndexPromise = indexSrdAndJsonData(true).finally(() => {
      initialIndexPromise = null;
    });
  }
  return initialIndexPromise;
}

/**
 * Searches the vector store for the top K passages closest to the query embedding.
 * Uses real semantic embeddings when available, calculates Top-K IDs from memory,
 * and fetches full text payloads on-demand from SQLite to eliminate heap bloat.
 */
export async function searchVectorStore(query, { campaignId = null, limit = 3, forceLocal = false, sourceFilter = null } = {}) {
  if (!query || typeof query !== 'string') return [];

  let index = getOrLoadVectorIndex();

  // If index is empty (and the DB is readable), auto-index base SRD and JSON data once
  if (index.size === 0 && !loadFailed) {
    await ensureInitialIndex();
    if (campaignId) await indexCampaignLore(campaignId);
    index = getOrLoadVectorIndex();
  }

  // Semantic dense vector from the embedding model (throws EmbeddingUnavailableError if it is unavailable)
  const queryVec = forceLocal
    ? computeLocalEmbedding(query)
    : await computeSemanticEmbedding(query);

  const queryKind = embeddingKind(queryVec);
  let localQueryVec = queryKind === 'local' ? queryVec : null;

  const GENERIC_QUERY_TERMS = new Set(['spell', 'spells', 'monster', 'monsters', 'rule', 'rules', 'stats', 'stat', 'lore', 'dnd']);
  const queryClean = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const queryTokens = queryClean.split(/\s+/).filter((w) => w.length > 2 && !GENERIC_QUERY_TERMS.has(w));

  const k = Math.max(0, Math.floor(Number(limit) || 0));
  if (k === 0) return [];
  // Bounded top-k, kept sorted descending; ties keep scan order (same as a stable sort).
  const scored = [];
  for (const item of index.values()) {
    if (campaignId && item.campaignId && item.campaignId !== campaignId) {
      continue;
    }
    if (!campaignId && item.campaignId !== null) {
      continue;
    }
    if (sourceFilter) {
      if (typeof sourceFilter === 'string' && item.source !== sourceFilter) {
        continue;
      } else if (Array.isArray(sourceFilter) && !sourceFilter.includes(item.source)) {
        continue;
      } else if (sourceFilter instanceof Set && !sourceFilter.has(item.source)) {
        continue;
      }
    }

    // Only compare vectors from the same space. A chunk indexed with the local fallback is scored
    // against a local query vector; a dense chunk of a different model/dimension cannot be scored
    // (it falls back to the title boost until it is reindexed).
    let score = 0;
    if (item.kind === queryKind) {
      score = cosineSimilarity(queryVec, item.embedding);
    } else if (item.kind === 'local') {
      localQueryVec ??= computeLocalEmbedding(query);
      score = cosineSimilarity(localQueryVec, item.embedding);
    }

    // Title & Entity keyword boost (hybrid dense + sparse matching)
    for (const tok of queryTokens) {
      if (item.lowerTitle.includes(tok)) {
        score += 0.35;
      }
    }

    const rounded = Number(score.toFixed(4));
    if (scored.length === k && !(rounded > scored[k - 1].score)) continue;
    let pos = scored.length;
    while (pos > 0 && scored[pos - 1].score < rounded) pos--;
    scored.splice(pos, 0, { id: item.id, campaignId: item.campaignId, title: item.title, score: rounded });
    if (scored.length > k) scored.pop();
  }

  const topMatches = scored;
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
