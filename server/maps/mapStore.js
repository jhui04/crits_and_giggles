/**
 * Read-only access to compiled MapDocuments (public/data/maps/, built by tools/maps/build_maps.py).
 *
 * Documents are cached by file mtime, so rebuilding the maps while the server runs is picked up
 * without a restart. MapModels (the spatial engine) are cached per document and override set.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildMapModel, mapDocumentToGridConfig } from '../../src/shared/spatial/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function mapsDir() {
  return process.env.MAPS_DATA_DIR || path.resolve(__dirname, '../../public/data/maps');
}

const fileCache = new Map(); // absolute path -> { mtimeMs, size, value } (size too: two writes in one timestamp tick still differ)

function readJsonCached(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    fileCache.delete(file);
    return null;
  }
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf-8'));
    fileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  } catch {
    return null;
  }
}

function readIndex() {
  return readJsonCached(path.join(mapsDir(), 'index.json'));
}

function candidateKeys(url) {
  const cleaned = String(url).split('?')[0].trim();
  const basename = path.posix.basename(cleaned.replaceAll('\\', '/'));
  // Only bundled maps (bare names or /maps/ paths) may be found by basename; an uploaded image
  // that happens to share a file name must not pick up a compiled map.
  const bundled = !cleaned.includes('/') || cleaned.endsWith(`/maps/${basename}`) || cleaned.startsWith('maps/');
  return bundled ? [...new Set([cleaned, `/maps/${basename}`, `maps/${basename}`, basename, `/${basename}`])] : [cleaned];
}

/** The compiled document for a map id, or null. */
export function getMapDocumentById(mapId) {
  const entry = readIndex()?.maps?.[mapId];
  if (!entry || entry.file.includes('/') || entry.file.includes('\\')) return null;
  return readJsonCached(path.join(mapsDir(), entry.file));
}

/** The compiled document for an image URL (DM or player image), or null. */
export function getMapDocumentByUrl(url) {
  if (!url) return null;
  const byImage = readIndex()?.byImage;
  if (!byImage) return null;
  for (const k of candidateKeys(url)) {
    if (byImage[k]) return getMapDocumentById(byImage[k]);
  }
  return null;
}

const modelCache = new WeakMap(); // document object -> Map(overrideKey -> model)

/** A spatial-engine model for a document. Overrides are DM corrections applied at load time. */
export function getMapModel(doc, overrides = []) {
  if (!doc) return null;
  const key = JSON.stringify(overrides);
  let perDoc = modelCache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    modelCache.set(doc, perDoc);
  }
  let model = perDoc.get(key);
  if (!model) {
    model = buildMapModel(doc, { overrides });
    perDoc.set(key, model);
  }
  return model;
}

/** Legacy-shaped grid data (cellPitch, offsets, regions, walls) for an image URL, or null. */
export function getGridDataFromDocument(doc, url) {
  // Overview maps (regions, hex travel maps) carry no tactical grid; saved positions were never migrated for them.
  if (!doc || doc.kind !== 'tactical') return null;
  return mapDocumentToGridConfig(doc, url || doc.images[0]?.url || '');
}
