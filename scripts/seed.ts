/**
 * Seeds a local `dev.db` (better-sqlite3) with the same demo data the app
 * uses, so the schema can be inspected off-device:  npm run seed
 */
import { createNodeAdapter } from '../src/db/nodeAdapter';
import { countItems, listBins, listLocations } from '../src/db/queries';
import { runMigrations } from '../src/db/schema';
import { seedIfEmpty } from '../src/db/seed';

const db = createNodeAdapter('dev.db');
runMigrations(db);
const seeded = seedIfEmpty(db);
console.log(seeded ? 'Seeded dev.db.' : 'dev.db already has data; left untouched.');
console.log(
  `locations=${listLocations(db).length} bins=${listBins(db).length} items=${countItems(db)}`,
);
db.close();
