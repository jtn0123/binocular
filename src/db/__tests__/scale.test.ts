import { dumpAll, restoreAll } from '../backupQueries';
import { inventoryCsv } from '../../backup/csv';
import { searchBins, searchItems } from '../../search/fts';
import { createNodeAdapter, type NodeDbAdapter } from '../nodeAdapter';
import {
  countItemsForBin,
  createBin,
  createLocation,
  createShelf,
  insertItem,
  listLowStockItems,
  listRecentBins,
  setLowStockThreshold,
} from '../queries';
import { runMigrations } from '../schema';

/**
 * Scale + perf pass (dogfood #8). Blueprint §8.3 promises search returns
 * in <100ms on 1,000 items — this makes that a tested number instead of a
 * hope. Node timings aren't device timings, but a regression that trips
 * these bounds would be an order-of-magnitude bug, not noise.
 */
const NOUNS = [
  'screwdriver', 'wrench', 'hammer', 'pliers', 'drill', 'saw', 'chisel', 'clamp',
  'level', 'square', 'file', 'punch', 'socket', 'ratchet', 'bit', 'blade',
  'sander', 'router', 'vise', 'mallet', 'scraper', 'snips', 'stripper', 'crimper',
];
const BRANDS = [null, 'DeWalt', 'Makita', 'Knipex', 'Wera', 'GRK', 'Bosch', null, null];
const SIZES = ['', ' 6mm', ' 8mm', ' 10mm', ' 13mm', ' small', ' large', ' torx', ' phillips'];
const CATEGORIES = ['hand_tool', 'power_tool', 'fastener', 'hardware', 'bit_blade_accessory'] as const;

function seedAtScale(db: NodeDbAdapter, itemCount: number) {
  const bins: string[] = [];
  db.withTransactionSync(() => {
    for (let l = 0; l < 5; l++) {
      const loc = createLocation(db, { name: `Location ${l}` });
      for (let s = 0; s < 4; s++) {
        const shelf = createShelf(db, { locationId: loc.id, name: `Shelf ${l}-${s}` });
        for (let b = 0; b < 3; b++) {
          const n = bins.length + 1;
          const bin = createBin(db, {
            name: `Bin ${l}-${s}-${b}`,
            shortCode: `B-${String(n).padStart(3, '0')}`,
            shelfId: shelf.id,
          });
          bins.push(bin.id);
        }
      }
    }
    for (let i = 0; i < itemCount; i++) {
      insertItem(db, {
        binId: bins[i % bins.length],
        name: `${NOUNS[i % NOUNS.length]}${SIZES[i % SIZES.length]} #${i}`,
        brand: BRANDS[i % BRANDS.length],
        category: CATEGORIES[i % CATEGORIES.length],
        quantity: (i % 40) + 1,
        labelText: i % 7 === 0 ? `SKU-${i} lot ${i % 90}` : null,
      });
    }
  });
  return bins;
}

function medianMs(runs: number, fn: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

describe('scale: 1,000 items across 60 bins', () => {
  let db: NodeDbAdapter;
  let bins: string[];

  beforeAll(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    bins = seedAtScale(db, 1000);
  });
  afterAll(() => {
    db.close();
  });

  it('search returns useful results in <100ms (blueprint §8.3 AC)', () => {
    const ms = medianMs(11, () => searchItems(db, 'scre', 50));
    expect(searchItems(db, 'scre', 50).length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(100);
  });

  it('worst-case-ish multi-token search also stays under 100ms', () => {
    const ms = medianMs(11, () => searchItems(db, 'wrench 10mm dewalt', 50));
    expect(ms).toBeLessThan(100);
  });

  it('bin search and recent bins stay fast', () => {
    expect(medianMs(11, () => searchBins(db, 'B-0'))).toBeLessThan(100);
    expect(medianMs(11, () => listRecentBins(db, 12))).toBeLessThan(100);
  });

  it('low-stock scan over 1,000 items is instant enough for Home', () => {
    for (let i = 0; i < 50; i++) {
      const items = db.getAllSync<{ id: string }>('SELECT id FROM items LIMIT 50');
      setLowStockThreshold(db, items[i].id, 100);
    }
    expect(medianMs(11, () => listLowStockItems(db))).toBeLessThan(100);
  });

  it('CSV export of the full inventory completes in under a second', () => {
    const t0 = performance.now();
    const csv = inventoryCsv(db);
    const ms = performance.now() - t0;
    expect(csv.split('\r\n').length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1000);
  });

  it('backup dump + restore at scale round-trips fast and completely', () => {
    const t0 = performance.now();
    const dump = dumpAll(db, '2026-07-22T00:00:00Z');
    const target = createNodeAdapter(':memory:');
    runMigrations(target);
    restoreAll(target, dump);
    const ms = performance.now() - t0;

    expect(dump.items).toHaveLength(1000);
    expect(dumpAll(target, '2026-07-22T00:00:00Z')).toEqual(dump);
    expect(ms).toBeLessThan(2000);
    expect(countItemsForBin(target, bins[0])).toBe(countItemsForBin(db, bins[0]));
    target.close();
  });
});
