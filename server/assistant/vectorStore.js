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

/**
 * Indexes custom campaign lore, notes, and chapters from SQLite
 */
export async function indexCampaignLore(campaignId) {
  if (!campaignId) return 0;

  // Wipe existing dynamic chunks for this campaign to ensure a clean slate and avoid staleness/orphaned chunks
  try {
    db.prepare(`
      DELETE FROM vector_chunks 
      WHERE campaign_id = ? 
      AND source IN ('campaign_chapter', 'campaign_asset', 'world_asset')
    `).run(campaignId);
    invalidateVectorCache();
  } catch {}

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
  } else {
    invalidateVectorCache();
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
    const rows = db.prepare('SELECT id, source, campaign_id, title, embedding FROM vector_chunks').all();
    cachedVectorIndex = rows.map((row) => ({
      id: row.id,
      source: row.source,
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
export async function searchVectorStore(query, { campaignId = null, limit = 3, forceLocal = false, sourceFilter = null } = {}) {
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
    if (sourceFilter) {
      if (typeof sourceFilter === 'string' && item.source !== sourceFilter) {
        continue;
      } else if (Array.isArray(sourceFilter) && !sourceFilter.includes(item.source)) {
        continue;
      } else if (sourceFilter instanceof Set && !sourceFilter.has(item.source)) {
        continue;
      }
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
