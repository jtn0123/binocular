import type { ViewStyle } from 'react-native';

import { locateMany, type HeatMode, type MapArea, type MapRow } from '@/db/mapView';

/**
 * Small answers the map screen needs about what it is drawing. Here rather
 * than in the screen so each is one testable expression, and so the screen
 * reads as layout.
 */

/**
 * Cell background per heat tier — a garnish over the cell, never over the
 * found/held states, which stay the loudest thing on the screen.
 */
export function tint(tier: 0 | 1 | 2 | 3, mode: HeatMode): ViewStyle | null {
  if (tier === 0 || mode === 'none') return null;
  const scale =
    mode === 'items'
      ? ['rgba(255,196,0,0.10)', 'rgba(255,196,0,0.22)', 'rgba(255,196,0,0.38)']
      : ['rgba(255,176,32,0.12)', 'rgba(255,107,94,0.18)', 'rgba(255,107,94,0.32)'];
  return { backgroundColor: scale[tier - 1] };
}

export const HEAT_LEGEND: Record<Exclude<HeatMode, 'none'>, string> = {
  items: 'Brighter amber = more items in the bin.',
  scanned: 'Darker = longer since the bin was scanned; red = never scanned.',
};

/** The row with this shelf id, wherever it is drawn. */
export function findRow(areas: readonly MapArea[], shelfId: string | null): MapRow | null {
  for (const area of areas) {
    const row = area.rows.find((r) => r.shelfId === shelfId);
    if (row) return row;
  }
  return null;
}

/** "Garage › Shelf B" for a row the drag is hovering, area included. */
export function describeRow(areas: readonly MapArea[], row: MapRow): string {
  const area = areas.find((a) => a.rows.includes(row));
  return area ? `${area.name} › ${row.name}` : row.name;
}

/** What the idle banner says the map is: the places, and how many shelves. */
export function summarize(areas: readonly MapArea[], total: number, busy: boolean): string {
  if (busy) return `${total} bins`;
  const places = areas.map((a) => a.name).join(', ');
  const shelves = areas.reduce((n, a) => n + a.rows.filter((r) => r.shelfId).length, 0);
  return `${places} — ${shelves} shelf${shelves === 1 ? '' : 'ves'}`;
}

/** The footer's one-line instruction, which depends on what is switched on. */
export function footHint(busy: boolean, dragEnabled: boolean): string {
  if (busy) return '';
  return dragEnabled
    ? ' Hold a bin and drag it, or hold and tap where it goes.'
    : ' Hold a bin to lift it, then tap where it goes.';
}

/** "Moving B-014 · Grout & spacers" — what the held banner announces. */
export function heldLabel(areas: readonly MapArea[], held: string | null): string {
  if (!held) return '';
  const found = locateMany(areas, [held])[0];
  return found ? `Moving ${found.cell.code} · ${found.cell.name}` : '';
}
