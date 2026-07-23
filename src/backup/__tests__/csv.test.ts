import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, createLocation, createShelf, insertItem } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { escapeCsvField, inventoryCsv, itemsToCsv } from '../csv';

describe('CSV export (blueprint D12)', () => {
  describe('escaping', () => {
    it('passes plain fields through and blanks nulls', () => {
      expect(escapeCsvField('Wood glue')).toBe('Wood glue');
      expect(escapeCsvField(42)).toBe('42');
      expect(escapeCsvField(null)).toBe('');
    });

    it('neutralizes spreadsheet formula injection in text fields', () => {
      // A hostile item name must open as text, never execute (dogfood fuzz).
      expect(escapeCsvField('=HYPERLINK("http://evil","x")')).toBe(
        '"\'=HYPERLINK(""http://evil"",""x"")"',
      );
      expect(escapeCsvField('+1-800-PWN')).toBe("'+1-800-PWN");
      expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
      expect(escapeCsvField('-negative note')).toBe("'-negative note");
      // Numbers stay numeric — a negative quantity is data, not a formula.
      expect(escapeCsvField(-5)).toBe('-5');
    });

    it('quotes commas, quotes, and newlines correctly', () => {
      expect(escapeCsvField('Screws, deck')).toBe('"Screws, deck"');
      expect(escapeCsvField('The "good" tape')).toBe('"The ""good"" tape"');
      expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    });
  });

  it('round-trips awkward names through the sheet layout', () => {
    const csv = itemsToCsv([
      {
        location: 'Garage',
        shelf: 'Shelf A',
        bin_code: 'B-001',
        bin_name: 'Misc, overflow',
        item: 'Screws "torx", 5mm\nlong',
        brand: null,
        category: 'fastener',
        quantity: 200,
        label_text: null,
        notes: null,
        checked_out_to: null,
        low_stock_threshold: 50,
      },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'location,shelf,bin_code,bin_name,item,brand,category,quantity,label_text,notes,checked_out_to,low_stock_threshold',
    );
    // The embedded newline stays inside its quoted field, so the record
    // count is headers + 1 logical row even though it spans lines.
    expect(csv).toContain('"Misc, overflow"');
    expect(csv).toContain('"Screws ""torx"", 5mm\nlong"');
    expect(csv).toContain(',200,');
  });

  it('emits one row per item with the full breadcrumb from the database', () => {
    const db: NodeDbAdapter = createNodeAdapter(':memory:');
    runMigrations(db);
    const loc = createLocation(db, { name: 'Garage' });
    const shelf = createShelf(db, { locationId: loc.id, name: 'Shelf A' });
    const bin = createBin(db, { name: 'Fasteners', shortCode: 'B-001', shelfId: shelf.id });
    insertItem(db, { binId: bin.id, name: 'Deck screws', category: 'fastener', quantity: 200 });
    insertItem(db, { binId: bin.id, name: 'Anchors', category: 'fastener' });

    const csv = inventoryCsv(db);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('Garage,Shelf A,B-001,Fasteners,Anchors,,fastener,1,,,,');
    expect(lines[2]).toBe('Garage,Shelf A,B-001,Fasteners,Deck screws,,fastener,200,,,,');
    db.close();
  });
});
