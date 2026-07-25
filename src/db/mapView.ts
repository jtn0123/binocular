import type { BinRow, LocationRow, ShelfRow } from './queries';

/**
 * The workshop map (blueprint D21).
 *
 * A schematic drawn from the hierarchy that already exists: a location's
 * shelves are the rows, its bins are the cells. Nothing is stored and
 * nothing is laid out by hand, so every workshop has a map the moment the
 * screen opens — the shelf already *is* the row in the data, and usually on
 * the wall too.
 *
 * Pure on purpose: the arrangement rules are the part worth testing, and a
 * screen is a bad place to hide them.
 */
export interface MapCell {
  binId: string;
  code: string;
  name: string;
  items: number;
  /** Drawn dimmer, so an empty bin reads as space rather than stock. */
  empty: boolean;
  /** The bin's cover photo, so a cell looks like the bin and not a square. */
  photoUri: string | null;
}

export interface MapRow {
  shelfId: string | null;
  name: string;
  bins: MapCell[];
}

export interface MapArea {
  locationId: string | null;
  name: string;
  rows: MapRow[];
  bins: number;
}

/** A bin with no shelf still belongs somewhere visible. */
export const UNSHELVED = 'Not on a shelf';
/** Locations are named; a bin with no location at all has to go somewhere. */
export const UNPLACED = 'Not in a location';

export interface MapInput {
  locations: readonly LocationRow[];
  shelves: readonly ShelfRow[];
  bins: readonly BinRow[];
  /** Item count per bin id; a bin missing from the map counts as zero. */
  itemCounts: ReadonlyMap<string, number>;
}

/**
 * Groups everything into areas → rows → cells, in the order they should be
 * drawn. Empty shelves are kept: a shelf you have not filled yet is part of
 * the map of the wall, and hiding it would make the picture lie.
 */
export function buildMap({ locations, shelves, bins, itemCounts }: MapInput): MapArea[] {
  const cell = (bin: BinRow): MapCell => {
    const items = itemCounts.get(bin.id) ?? 0;
    return {
      binId: bin.id,
      code: bin.short_code,
      name: bin.name,
      items,
      empty: items === 0,
      photoUri: bin.cover_photo_uri ?? null,
    };
  };

  const byShelf = new Map<string, BinRow[]>();
  const unshelved: BinRow[] = [];
  for (const bin of bins) {
    if (bin.shelf_id) {
      const list = byShelf.get(bin.shelf_id);
      if (list) list.push(bin);
      else byShelf.set(bin.shelf_id, [bin]);
    } else {
      unshelved.push(bin);
    }
  }

  const areas: MapArea[] = locations.map((location) => {
    const rows = shelves
      .filter((shelf) => shelf.location_id === location.id)
      .map((shelf) => ({
        shelfId: shelf.id,
        name: shelf.name,
        bins: (byShelf.get(shelf.id) ?? []).map(cell),
      }));
    return {
      locationId: location.id,
      name: location.name,
      rows,
      bins: rows.reduce((n, row) => n + row.bins.length, 0),
    };
  });

  // Bins with no shelf are collected into one row at the end rather than
  // dropped — a map that silently omits things is worse than no map.
  if (unshelved.length > 0) {
    areas.push({
      locationId: null,
      name: UNPLACED,
      rows: [{ shelfId: null, name: UNSHELVED, bins: unshelved.map(cell) }],
      bins: unshelved.length,
    });
  }

  // An area with no bins at all is noise on a map of where things are.
  return areas.filter((area) => area.bins > 0 || area.rows.length > 0);
}

/** Which area and row a bin sits in, for opening the map already scrolled. */
export function locate(
  areas: readonly MapArea[],
  binId: string,
): { area: MapArea; row: MapRow; cell: MapCell } | null {
  for (const area of areas) {
    for (const row of area.rows) {
      const cell = row.bins.find((b) => b.binId === binId);
      if (cell) return { area, row, cell };
    }
  }
  return null;
}

/**
 * "Garage › Shelf A" — the sentence that tells you where to walk. Written
 * here rather than in the screen so the map and anything else that points at
 * a bin say it the same way.
 */
export function describePlace(found: { area: MapArea; row: MapRow }): string {
  const parts = [found.area.name, found.row.name].filter((p) => p !== UNPLACED && p !== UNSHELVED);
  return parts.length > 0 ? parts.join(' › ') : 'Not filed anywhere yet';
}

/** Total bins drawn — the map's own claim about how complete it is. */
export function mapSize(areas: readonly MapArea[]): number {
  return areas.reduce((n, area) => n + area.bins, 0);
}
