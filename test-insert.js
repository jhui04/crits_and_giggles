import { db, initDb } from './server/db.js';
import fs from 'fs';

initDb();

const data = JSON.parse(fs.readFileSync('./public/data/scraped_world.json', 'utf8'));

const insertWorld = db.transaction((data) => {
  db.prepare('DELETE FROM worlds WHERE id = ?').run(data.id);
  db.prepare('INSERT INTO worlds (id, name, description) VALUES (?, ?, ?)').run(data.id, data.name, data.description);
  
  if (data.assets) {
    const insertAsset = db.prepare('INSERT INTO world_assets (id, world_id, type, name, description, tags) VALUES (?, ?, ?, ?, ?, ?)');
    const insertConnection = db.prepare('INSERT INTO world_asset_connections (id, source_id, target_id, world_id, relationship) VALUES (?, ?, ?, ?, ?)');
    
    data.assets.forEach(as => {
      insertAsset.run(as.id, data.id, as.type, as.name, as.description, JSON.stringify(as.tags || []));
    });
    
    data.assets.forEach(as => {
      if (as.connections) {
        as.connections.forEach(conn => {
          insertConnection.run(conn.id, as.id, conn.targetId, data.id, conn.relationship);
        });
      }
    });
  }
});

try {
  insertWorld(data);
  console.log("Success");
} catch (e) {
  console.error("Failed:", e.message);
}
