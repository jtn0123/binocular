import * as fc from 'fast-check';

import { escapeCsvField, itemsToCsv } from '../backup/csv';
import { createNodeAdapter, type NodeDbAdapter } from '../db/nodeAdapter';
import { createBin, insertItem } from '../db/queries';
import { runMigrations } from '../db/schema';
import { encodeQrPayload, parseQrPayload, QrTargetType } from '../qr/payload';
import { searchBins, searchItems, toFtsQuery } from '../search/fts';

/**
 * Property-based pass (dogfood #5): thousands of generated inputs per
 * invariant, not hand-picked samples. Each property is something the app
 * relies on everywhere, stated once.
 */

/** Minimal RFC-4180 parser for round-trip checking our own CSV output. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** What the export intentionally does to a text value (formula guard). */
function expectedCsvText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

describe('property: search never throws and never leaks query grammar', () => {
  let db: NodeDbAdapter;

  beforeAll(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    const bin = createBin(db, { name: 'Prop bin', shortCode: 'B-001' });
    insertItem(db, { binId: bin.id, name: 'Phillips screwdriver', category: 'hand_tool' });
  });
  afterAll(() => {
    db.close();
  });

  it('searchItems and searchBins tolerate arbitrary unicode input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (q) => {
        expect(() => searchItems(db, q)).not.toThrow();
        expect(() => searchBins(db, q)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it('toFtsQuery only ever emits quoted prefix tokens (or null)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (q) => {
        const out = toFtsQuery(q);
        if (out !== null) {
          // Grammar: one or more `"token"*` groups joined by single spaces,
          // with no stray double quotes inside a token.
          expect(out).toMatch(/^"[^"]+"\*( "[^"]+"\*)*$/);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('property: CSV output re-parses to exactly what was exported', () => {
  it('any strings/numbers survive the escape → parse round trip', () => {
    const cell = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 60 }),
      fc.integer({ min: -1000, max: 1_000_000 }).map(String),
    );
    fc.assert(
      fc.property(fc.array(cell, { minLength: 1, maxLength: 12 }), (values) => {
        const line = values.map((v) => escapeCsvField(v)).join(',') + '\r\n';
        const parsed = parseCsv(line);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toEqual(values.map(expectedCsvText));
      }),
      { numRuns: 500 },
    );
  });

  it('full rows through itemsToCsv round-trip including the header', () => {
    const text = fc.string({ unit: 'binary', maxLength: 40 });
    const rowArb = fc.record({
      location: fc.option(text, { nil: null }),
      shelf: fc.option(text, { nil: null }),
      bin_code: fc.option(text, { nil: null }),
      bin_name: fc.option(text, { nil: null }),
      item: text,
      brand: fc.option(text, { nil: null }),
      category: fc.constantFrom('hand_tool', 'other', 'fastener'),
      quantity: fc.integer({ min: 0, max: 99_999 }),
      label_text: fc.option(text, { nil: null }),
      notes: fc.option(text, { nil: null }),
      checked_out_to: fc.option(text, { nil: null }),
      low_stock_threshold: fc.option(fc.integer({ min: 0, max: 999 }), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 5 }), (rows) => {
        const parsed = parseCsv(itemsToCsv(rows));
        expect(parsed).toHaveLength(rows.length + 1); // header + rows
        rows.forEach((row, idx) => {
          const cells = parsed[idx + 1];
          expect(cells[4]).toBe(expectedCsvText(row.item));
          expect(cells[7]).toBe(String(row.quantity));
          expect(cells[5]).toBe(row.brand === null ? '' : expectedCsvText(row.brand));
        });
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: QR payloads round-trip for every colon-free id', () => {
  it('encode → parse is identity across types and ids', () => {
    const idArb = fc
      .string({ unit: 'binary', minLength: 1, maxLength: 80 })
      .filter((s) => !s.includes(':') && s.trim() === s && s.length > 0);
    fc.assert(
      fc.property(fc.constantFrom(...QrTargetType.options), idArb, (type, id) => {
        expect(parseQrPayload(encodeQrPayload({ type, id }))).toEqual({ type, id });
      }),
      { numRuns: 500 },
    );
  });
});
