/**
 * DM corrections to compiled maps, stored in the map_overrides table.
 *
 * The compiled MapDocuments in public/data/maps are generated and never edited. A correction is a
 * small operation (see MapOverride in src/shared/spatial/types.ts) that buildMapModel applies on top
 * of the document, in insertion order. Writing happens only from the confirmed propose_map_patch tool.
 */
import crypto from 'crypto';
import { db, MAP_OVERRIDES_DDL } from '../db.js';

let tableReady = false;
/** The table is also created by initDb; this keeps the store usable when a caller never ran it. */
function ensureTable() {
  if (tableReady) return;
  db.exec(MAP_OVERRIDES_DDL);
  tableReady = true;
}

/** Operations for a map, oldest first. A row that no longer parses is skipped, never thrown. */
export function listOverrides(mapId) {
  if (!mapId) return [];
  ensureTable();
  const rows = db.prepare('SELECT op_json FROM map_overrides WHERE map_id = ? ORDER BY id').all(mapId);
  const ops = [];
  for (const r of rows) {
    try {
      ops.push(JSON.parse(r.op_json));
    } catch {
      /* ignore a corrupt row */
    }
  }
  return ops;
}

/** Inserts operations in one transaction and returns how many were stored. */
export function addOverrides(mapId, ops) {
  ensureTable();
  const insert = db.prepare('INSERT INTO map_overrides (map_id, op_json) VALUES (?, ?)');
  db.transaction(() => {
    for (const op of ops) insert.run(mapId, JSON.stringify(op));
  })();
  return ops.length;
}

/** A short fingerprint of a map's corrections, used to detect that they changed after staging. */
export function overridesHash(mapId) {
  ensureTable();
  const rows = db.prepare('SELECT id, op_json FROM map_overrides WHERE map_id = ? ORDER BY id').all(mapId);
  return crypto.createHash('sha256').update(JSON.stringify([mapId, rows])).digest('hex').slice(0, 16);
}
