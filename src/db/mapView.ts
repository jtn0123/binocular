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
  /** When the bin was last audited, for the staleness tint (D21). */
  lastScannedAt: string | null;
}

export interface MapRow {
  shelfId: string | null;
  name: string;
  bins: MapCell[];
  /** D21: how many slots the shelf physically has; null = unsized. */
  capacity: number | null;
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
      lastScannedAt: bin.last_scanned_at ?? null,
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
        capacity: shelf.capacity ?? null,
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
      rows: [{ shelfId: null, name: UNSHELVED, bins: unshelved.map(cell), capacity: null }],
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

export interface MapFind {
  area: MapArea;
  row: MapRow;
  cell: MapCell;
}

/**
 * Every requested bin that is actually drawn, in draw order — a search that
 * matches items in four bins should light all four, not make the user run
 * the search once per bin.
 */
export function locateMany(areas: readonly MapArea[], binIds: readonly string[]): MapFind[] {
  const wanted = new Set(binIds);
  const finds: MapFind[] = [];
  for (const area of areas) {
    for (const row of area.rows) {
      for (const cell of row.bins) {
        if (wanted.has(cell.binId)) finds.push({ area, row, cell });
      }
    }
  }
  return finds;
}

/** Empty slots to draw after a row's bins: how much declared space is free. */
export function rowGaps(row: MapRow): number {
  return row.capacity === null ? 0 : Math.max(0, row.capacity - row.bins.length);
}

// ------------------------------------------------------------------ moving

/**
 * Where a lifted bin is being dropped.
 *
 * Two ways of naming the same place, because there are two ways to move a
 * bin. A tap knows which bin it landed on and nothing about slots, so it
 * says `beforeBinId`. A drag knows which gap the finger is over and not
 * which bin used to be there, so it says `index` — counted over the row
 * *without* the lifted bin, which is exactly what the drag measures.
 */
export interface DropTarget {
  /** The row receiving it; null = the unshelved row. */
  shelfId: string | null;
  /** Slot it lands in front of; omitted = the end of the row. */
  beforeBinId?: string;
  /** Slot number in the row minus the lifted bin. Wins over `beforeBinId`. */
  index?: number;
}

/**
 * What executing a drop would do — computed here, not in the screen,
 * because "insert before, minus yourself, confirm only across shelves" is
 * exactly the kind of arithmetic that hides bugs in JSX.
 */
export interface DropPlan {
  binId: string;
  /** Destination shelf; null unfiles the bin. */
  shelfId: string | null;
  /** The destination row's final order, the lifted bin included. */
  orderedIds: string[];
  /** True when the drop re-homes the bin — the §8.5 move that asks first. */
  crossShelf: boolean;
  /** "Garage › Shelf C" — the sentence the confirm shows. */
  place: string;
}

/** Plans a drop, or returns null when it would change nothing. */
export function planDrop(
  areas: readonly MapArea[],
  binId: string,
  target: DropTarget,
): DropPlan | null {
  if (target.beforeBinId === binId) return null;
  const held = locate(areas, binId);
  if (!held) return null;

  let destination: { area: MapArea; row: MapRow } | null = null;
  for (const area of areas) {
    const row = area.rows.find((r) => r.shelfId === target.shelfId);
    if (row) {
      destination = { area, row };
      break;
    }
  }
  if (!destination) return null;

  const without = destination.row.bins.map((c) => c.binId).filter((id) => id !== binId);
  const at =
    target.index !== undefined
      ? Math.max(0, Math.min(Math.trunc(target.index), without.length))
      : target.beforeBinId
        ? // A bin that is no longer there (a stale tap) means the end, not slot 0.
          indexOrEnd(without, target.beforeBinId)
        : without.length;
  const orderedIds = [...without];
  orderedIds.splice(at, 0, binId);

  const crossShelf = held.row.shelfId !== target.shelfId;
  const current = destination.row.bins.map((c) => c.binId);
  if (!crossShelf && orderedIds.length === current.length) {
    if (orderedIds.every((id, i) => id === current[i])) return null;
  }

  return { binId, shelfId: target.shelfId, orderedIds, crossShelf, place: describePlace(destination) };
}

function indexOrEnd(ids: readonly string[], id: string): number {
  const at = ids.indexOf(id);
  return at === -1 ? ids.length : at;
}

// -------------------------------------------------------------------- heat

export type HeatMode = 'none' | 'items' | 'scanned';
/** 0 = no tint … 3 = strongest; what each step means depends on the mode. */
export type HeatTier = 0 | 1 | 2 | 3;

/**
 * How strongly a cell is tinted. `items` makes full bins glow; `scanned`
 * darkens bins the camera has not visited lately — never-audited hottest of
 * all, because those are the bins the inventory knows least about.
 */
export function heatTier(cell: MapCell, mode: HeatMode, nowIso: string): HeatTier {
  if (mode === 'items') {
    if (cell.items >= 10) return 3;
    if (cell.items >= 5) return 2;
    if (cell.items >= 1) return 1;
    return 0;
  }
  if (mode === 'scanned') {
    if (!cell.lastScannedAt) return 3;
    const days = (Date.parse(nowIso) - Date.parse(cell.lastScannedAt)) / 86_400_000;
    if (days > 90) return 2;
    if (days > 30) return 1;
    return 0;
  }
  return 0;
}
