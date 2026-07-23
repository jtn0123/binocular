import type { DbAdapter } from '../db/adapter';

/**
 * CSV export of the whole inventory (blueprint D12): one row per item
 * with the location/shelf/bin breadcrumb, Excel/Sheets-compatible.
 * Hand-rolled escaping, unit-tested — no dependency.
 */
export const CSV_HEADERS = [
  'location',
  'shelf',
  'bin_code',
  'bin_name',
  'item',
  'brand',
  'category',
  'quantity',
  'label_text',
  'notes',
  'checked_out_to',
  'low_stock_threshold',
] as const;

export function escapeCsvField(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Formula-injection guard (text fields only): a name like
  // `=HYPERLINK(...)` must open in Excel/Sheets as text, not execute.
  // Numbers are exempt so negative quantities stay numeric.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

interface CsvItemRow {
  location: string | null;
  shelf: string | null;
  bin_code: string | null;
  bin_name: string | null;
  item: string;
  brand: string | null;
  category: string;
  quantity: number;
  label_text: string | null;
  notes: string | null;
  checked_out_to: string | null;
  low_stock_threshold: number | null;
}

export function itemsToCsv(rows: CsvItemRow[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((h) => escapeCsvField(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function inventoryCsv(db: DbAdapter): string {
  const rows = db.getAllSync<CsvItemRow>(
    `SELECT
       locations.name  AS location,
       shelves.name    AS shelf,
       bins.short_code AS bin_code,
       bins.name       AS bin_name,
       items.name      AS item,
       items.brand     AS brand,
       items.category  AS category,
       items.quantity  AS quantity,
       items.label_text AS label_text,
       items.notes     AS notes,
       items.checked_out_to AS checked_out_to,
       items.low_stock_threshold AS low_stock_threshold
     FROM items
     LEFT JOIN bins ON bins.id = items.bin_id
     LEFT JOIN shelves ON shelves.id = bins.shelf_id
     LEFT JOIN locations ON locations.id = shelves.location_id
     ORDER BY locations.name, shelves.name, bins.short_code, items.name`,
  );
  return itemsToCsv(rows);
}
