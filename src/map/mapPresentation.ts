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

/**
 * "Moving B-014 · Grout & spacers" — what the held banner announces. A stack
 * says how many rather than naming one of them, because naming the first and
 * silently carrying four is how a group move surprises someone.
 */
export function heldLabel(
  areas: readonly MapArea[],
  held: string | null,
  carriedCount = 1,
): string {
  if (!held) return '';
  if (carriedCount > 1) return `Moving ${carriedCount} bins together`;
  const found = locateMany(areas, [held])[0];
  return found ? `Moving ${found.cell.code} · ${found.cell.name}` : '';
}

/** How a lifted bin — or a lifted stack — can be put down. */
export function heldHint(carriedCount: number, canSend: boolean): string {
  if (carriedCount > 1) return 'Tap a slot and they all land there, in this order.';
  return canSend
    ? 'Tap a bin to slide in front of it, a slot to drop there, or a side rail to send it to another rack.'
    : 'Tap a bin to slide in front of it, or a slot to drop there.';
}

/**
 * What releasing on a side rail would do. Named cases rather than one
 * sentence with holes in it: "full" and "several racks that way" lead to
 * different actions, and the banner is the only place that says so before
 * the sheet appears.
 */
export function sendHint(input: {
  code: string;
  label: string;
  /** Racks in that direction — more than one means the picker will ask. */
  pool: number;
  full: boolean;
}): string {
  if (input.pool === 0) return '';
  if (input.pool > 1) {
    return `Release to choose a rack — ${input.code} or further along · hold to page there`;
  }
  return input.full
    ? `${input.code} is full — release anyway and the shelf reads over · hold to page there`
    : `Release to send it to ${input.code} · ${input.label} · hold to page there`;
}
