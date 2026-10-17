import { db, initDb } from './db.js';

// Tests run against a fresh in-memory DB (DB_MODE=memory); give it the schema
// so test files don't depend on the on-disk prod DB having been initialized.
initDb(db);
