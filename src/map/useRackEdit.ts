import { useCallback } from 'react';
import { Alert } from 'react-native';

import type { DbAdapter } from '@/db/adapter';
import {
  areaFill,
  composeRackName,
  nextRackCode,
  rackCodeOf,
  rackLabelOf,
  type MapArea,
  type MapRow,
} from '@/db/mapView';
import {
  createBin,
  createLocation,
  createShelf,
  deleteLocation,
  deleteShelf,
  listLocations,
  nextShortCode,
  renameLocation,
  renameShelf,
  reorderLocations,
  setRackCapacity,
  setShelfCapacity,
} from '@/db/queries';
import { logEvent } from '@/diagnostics/events';
import { plural } from '@/lib/text';
import { isShelfLadder, shelfLadder } from '@/map/shelfNames';

/** A fresh rack is four shelves tall, top to bottom, like the ones on the wall. */
const NEW_RACK_HEIGHT = 4;
/** What a rack is as wide as when there is nothing to copy it from. */
const DEFAULT_COLUMNS = 4;

/**
 * The names a rack should carry once it is `height` shelves tall — or null to
 * leave the ones it has.
 *
 * The ROWS stepper changes how tall a rack is, and on an untouched rack the
 * shelf names are a description of that height (see `shelfNames`): going from
 * four shelves to three should leave Top / Middle / Bottom, not Top / Upper /
 * Lower with the word for the missing rung still in the middle of it.
 *
 * Two conditions, and both are about not overwriting something someone meant.
 * The names must still be the ladder they were given — one hand-typed name and
 * the rack has names, not positions. And every shelf must be empty: a shelf
 * with bins on it is a shelf someone has filed things against, its name is on
 * every breadcrumb that points at them, and a stepper is not where anyone
 * expects that to be rewritten. So this is really the "fresh rack, still being
 * set up" case, which is the one where it matters.
 */
function ladderFor(rows: readonly MapRow[], height: number): string[] | null {
  if (rows.some((row) => row.bins.length > 0)) return null;
  if (!isShelfLadder(rows.map((row) => row.name))) return null;
  return shelfLadder(height);
}

/** Writes a ladder across shelves that are already in top-to-bottom order. */
function relabel(db: DbAdapter, rows: readonly MapRow[], names: readonly string[]): boolean {
  let changed = false;
  rows.forEach((row, index) => {
    if (!row.shelfId || row.name === names[index]) return;
    renameShelf(db, row.shelfId, names[index]);
    changed = true;
  });
  return changed;
}

/**
 * Editing the shape of the wall (v3): racks, shelves, and how wide they are.
 *
 * Every one of these writes the same rows the rest of the app reads — a rack
 * is a location, a shelf is a shelf — so there is no second truth about where
 * anything is filed (D21). None of them can destroy inventory (§11): taking a
 * rack or a shelf off the wall re-homes its bins to the unshelved tray, and
 * the two that cannot be undone from a snackbar say so in a confirm first.
 */
export interface RackEdit {
  renameRack: (area: MapArea, index: number, label: string) => void;
  /** Adds a rack at the end of the wall; returns its new index. */
  addRack: (columns: number) => number;
  removeRack: (racks: readonly MapArea[], index: number) => void;
  moveRack: (racks: readonly MapArea[], index: number, direction: -1 | 1) => void;
  /** The COLUMNS stepper: one slot count across the whole rack. */
  setColumns: (area: MapArea, columns: number) => void;
  addShelf: (area: MapArea, columns: number) => void;
  /** The ROWS stepper down: takes the last *empty* shelf off, never one with bins. */
  removeLastShelf: (area: MapArea) => void;
  /** Takes one named empty shelf off — the button on the shelf itself. */
  removeShelf: (shelfId: string, name: string) => void;
  renameShelf: (shelfId: string, name: string) => void;
  setShelfWidth: (shelfId: string, capacity: number) => void;
  addBin: (shelfId: string) => void;
}

/** What taking a rack off the wall would do to the bins standing on it. */
function movedWarning(bins: number): string {
  if (bins === 0) return 'This rack is empty.';
  const verb = bins === 1 ? 'moves' : 'move';
  return `${plural(bins, 'bin')} ${verb} to the unshelved tray. Nothing is thrown away.`;
}

export function useRackEdit({
  db,
  onChange,
  notify,
  onSpill,
}: {
  db: DbAdapter;
  onChange: () => void;
  /** Says what happened, for the things that have no meaningful undo. */
  notify: (message: string) => void;
  /**
   * Bins have just landed in the unshelved tray. The tray is collapsed by
   * default, so without this a removed rack's bins appear to evaporate —
   * they are safe in the database and nowhere on the screen, which is the
   * one impression §11 must never give.
   */
  onSpill: (count: number) => void;
}): RackEdit {
  const renameRack = useCallback(
    (area: MapArea, index: number, label: string) => {
      if (!area.locationId) return;
      // Only the label is rewritten. The code is on a sticker at the end of
      // the run, and renumbering the wall because someone reworded a name is
      // exactly the drift D21 exists to prevent.
      renameLocation(db, area.locationId, composeRackName(rackCodeOf(area.name, index), label));
      onChange();
    },
    [db, onChange],
  );

  const addRack = useCallback(
    (columns: number) => {
      const existing = listLocations(db);
      const location = createLocation(db, {
        name: composeRackName(nextRackCode(existing.map((l) => l.name)), 'New rack'),
      });
      const width = Math.max(1, columns || DEFAULT_COLUMNS);
      for (const name of shelfLadder(NEW_RACK_HEIGHT)) {
        createShelf(db, { locationId: location.id, name, capacity: width });
      }
      logEvent(db, { kind: 'organize', name: 'rack_added', detail: { columns: width } });
      onChange();
      return existing.length;
    },
    [db, onChange],
  );

  const removeRack = useCallback(
    (racks: readonly MapArea[], index: number) => {
      const area = racks[index];
      if (!area?.locationId) return;
      if (racks.length <= 1) {
        notify('The wall keeps at least one rack.');
        return;
      }
      const code = rackCodeOf(area.name, index);
      const bins = areaFill(area).filled;
      Alert.alert(
        `Take ${code} off the wall?`,
        movedWarning(bins),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove rack',
            style: 'destructive',
            onPress: () => {
              // deleteLocation unassigns before it deletes, so the bins land
              // in the tray rather than pointing at a shelf that is gone.
              deleteLocation(db, area.locationId as string);
              logEvent(db, { kind: 'organize', name: 'rack_removed', detail: { code, bins } });
              onChange();
              if (bins > 0) onSpill(bins);
              notify(
                bins > 0
                  ? `${code} taken off the wall — its bins are in the tray`
                  : `${code} taken off the wall`,
              );
            },
          },
        ],
      );
    },
    [db, notify, onChange, onSpill],
  );

  const moveRack = useCallback(
    (racks: readonly MapArea[], index: number, direction: -1 | 1) => {
      const to = index + direction;
      if (to < 0 || to >= racks.length) return;
      const order = racks.map((r) => r.locationId).filter((id): id is string => id !== null);
      const [moved] = order.splice(index, 1);
      order.splice(to, 0, moved);
      reorderLocations(db, order);
      onChange();
    },
    [db, onChange],
  );

  const setColumns = useCallback(
    (area: MapArea, columns: number) => {
      if (!area.locationId) return;
      setRackCapacity(db, area.locationId, Math.max(1, columns));
      onChange();
    },
    [db, onChange],
  );

  const addShelf = useCallback(
    (area: MapArea, columns: number) => {
      if (!area.locationId) return;
      const shelves = area.rows.filter((row) => row.shelfId !== null);
      // Read at the height the rack is *about* to be, so the shelf being made
      // is named as part of the ladder rather than added to the bottom of one.
      const ladder = ladderFor(shelves, shelves.length + 1);
      createShelf(db, {
        locationId: area.locationId,
        name: ladder ? ladder[shelves.length] : 'New shelf',
        capacity: Math.max(1, columns || DEFAULT_COLUMNS),
      });
      if (ladder) relabel(db, shelves, ladder);
      onChange();
    },
    [db, onChange],
  );

  const removeLastShelf = useCallback(
    (area: MapArea) => {
      if (area.rows.length <= 1) {
        notify('A rack keeps at least one shelf.');
        return;
      }
      // Deliberately the last *empty* one, not the last one: a shelf holding
      // bins would send them to the tray, and a stepper is not where someone
      // expects that to happen.
      const gone = [...area.rows].reverse().find((row) => row.shelfId && row.bins.length === 0);
      if (!gone?.shelfId) {
        notify('Empty a shelf before removing it.');
        return;
      }
      const shelves = area.rows.filter((row) => row.shelfId !== null);
      const staying = shelves.filter((row) => row.shelfId !== gone.shelfId);
      const ladder = ladderFor(shelves, staying.length);
      deleteShelf(db, gone.shelfId);
      const renamed = ladder ? relabel(db, staying, ladder) : false;
      onChange();
      // Said rather than left to be noticed: on a rack still being set up this
      // press changes the name of every shelf on it, and a stepper that
      // quietly rewrites three labels is alarming even when it is right.
      notify(renamed ? `${gone.name} removed — now ${ladder?.join(', ')}` : `${gone.name} removed`);
    },
    [db, notify, onChange],
  );

  const removeShelf = useCallback(
    (shelfId: string, name: string) => {
      // Only ever offered on an empty shelf, so nothing is re-homed and there
      // is nothing to warn about — the caller owns that condition.
      deleteShelf(db, shelfId);
      onChange();
      notify(`${name} removed`);
    },
    [db, notify, onChange],
  );

  const rename = useCallback(
    (shelfId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      renameShelf(db, shelfId, trimmed);
      onChange();
    },
    [db, onChange],
  );

  const setShelfWidth = useCallback(
    (shelfId: string, capacity: number) => {
      setShelfCapacity(db, shelfId, Math.max(1, capacity));
      onChange();
    },
    [db, onChange],
  );

  const addBin = useCallback(
    (shelfId: string) => {
      const code = nextShortCode(db);
      createBin(db, { name: `Bin ${code}`, shortCode: code, shelfId });
      onChange();
    },
    [db, onChange],
  );

  return {
    renameRack,
    addRack,
    removeRack,
    moveRack,
    setColumns,
    addShelf,
    removeLastShelf,
    removeShelf,
    renameShelf: rename,
    setShelfWidth,
    addBin,
  };
}

/** The rack label a fresh wall shows, so the empty state and the first add agree. */
export function newRackLabel(): string {
  return rackLabelOf(composeRackName('R1', 'New rack'));
}
