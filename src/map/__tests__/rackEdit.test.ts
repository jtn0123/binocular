import { renderHook } from '@testing-library/react-native';
// Namespaced: a bare `react-native` import shares a babel binding with
// `@testing-library/react-native` and the two quietly overwrite each other.
import * as RN from 'react-native';

import { createNodeAdapter, type NodeDbAdapter } from '@/db/nodeAdapter';
import { buildMap, type MapArea } from '@/db/mapView';
import {
  createBin,
  createLocation,
  createShelf,
  listBins,
  listLocations,
  listShelves,
  listUnassignedBins,
} from '@/db/queries';
import { runMigrations } from '@/db/schema';

import { newRackLabel, useRackEdit } from '../useRackEdit';

/**
 * Editing the shape of the wall.
 *
 * The screen test drives the steppers and the rename fields through real
 * presses; what it cannot reach is anything behind a native `Alert` — which
 * is to say the one operation here that deletes a row someone's inventory is
 * filed against. So these go at the hook directly, against a real database,
 * and assert on what is in it afterwards rather than on what was drawn.
 */
type AlertButton = { text?: string; style?: string; onPress?: () => void };

describe('editing the wall', () => {
  let db: NodeDbAdapter;
  let notify: jest.Mock;
  let onSpill: jest.Mock;
  let onChange: jest.Mock;
  let alert: jest.SpyInstance;

  /** The racks as the map screen sees them. */
  const areas = (): MapArea[] =>
    buildMap({
      locations: listLocations(db),
      shelves: listLocations(db).flatMap((l) => listShelves(db, l.id)),
      bins: listBins(db),
      itemCounts: new Map(),
    });

  // `renderHook` resolves rather than returning here, like `render` does.
  const edit = async () => {
    const { result } = await renderHook(() => useRackEdit({ db, onChange, notify, onSpill }));
    return result.current;
  };

  /** Answer the confirm the way a thumb would. */
  const press = (label: string) => {
    const buttons = (alert.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
    const button = buttons.find((b) => b.text === label);
    if (!button) throw new Error(`no "${label}" in [${buttons.map((b) => b.text).join(', ')}]`);
    button.onPress?.();
  };

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    notify = jest.fn();
    onSpill = jest.fn();
    onChange = jest.fn();
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    alert.mockRestore();
    db.close();
  });

  /** A rack with one shelf, optionally holding `bins` bins. */
  const rack = (name: string, bins = 0) => {
    const location = createLocation(db, { name });
    const shelf = createShelf(db, { locationId: location.id, name: 'Top', capacity: 4 });
    for (let i = 0; i < bins; i++) {
      createBin(db, { name: `Bin ${i}`, shortCode: `B-${name}-${i}`, shelfId: shelf.id });
    }
    return { location, shelf };
  };

  describe('taking a rack off the wall', () => {
    it('asks first, and says how many bins are about to move', async () => {
      rack('R1 · Garage');
      rack('R2 · Shed', 2);
      (await edit()).removeRack(areas(), 1);

      expect(alert).toHaveBeenCalled();
      const [title, body] = alert.mock.calls[0];
      expect(title).toBe('Take R2 off the wall?');
      // The count is the whole point of asking: "this rack is empty" and
      // "two bins are about to move" deserve different answers.
      expect(body).toContain('2 bins move');
      expect(body).toContain('Nothing is thrown away');
    });

    it('counts one bin in the singular', async () => {
      rack('R1 · Garage');
      rack('R2 · Shed', 1);
      (await edit()).removeRack(areas(), 1);
      expect(alert.mock.calls[0][1]).toContain('1 bin moves');
    });

    it('says plainly when there is nothing on it', async () => {
      rack('R1 · Garage');
      rack('R2 · Shed');
      (await edit()).removeRack(areas(), 1);
      expect(alert.mock.calls[0][1]).toBe('This rack is empty.');
    });

    it('changes nothing until the confirm is answered', async () => {
      rack('R1 · Garage');
      rack('R2 · Shed', 1);
      (await edit()).removeRack(areas(), 1);

      expect(listLocations(db)).toHaveLength(2);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('leaves the wall alone when the confirm is cancelled', async () => {
      rack('R1 · Garage');
      rack('R2 · Shed', 1);
      (await edit()).removeRack(areas(), 1);
      press('Cancel');

      expect(listLocations(db)).toHaveLength(2);
      expect(listUnassignedBins(db)).toHaveLength(0);
    });

    it('re-homes the bins to the tray rather than deleting them', async () => {
      // §11: nothing here may destroy inventory. The rack goes; the bins that
      // were filed against it are still in the database, unshelved.
      rack('R1 · Garage');
      rack('R2 · Shed', 2);
      (await edit()).removeRack(areas(), 1);
      press('Remove rack');

      expect(listLocations(db)).toHaveLength(1);
      expect(listBins(db)).toHaveLength(2);
      expect(listUnassignedBins(db)).toHaveLength(2);
    });

    it('opens the tray, so the bins never look deleted', async () => {
      // The tray is collapsed by default. Without this the bins are safe in
      // the database and nowhere on the screen, which is the one impression
      // §11 must never give.
      rack('R1 · Garage');
      rack('R2 · Shed', 2);
      (await edit()).removeRack(areas(), 1);
      press('Remove rack');

      expect(onSpill).toHaveBeenCalledWith(2);
      expect(notify).toHaveBeenCalledWith('R2 taken off the wall — its bins are in the tray');
    });

    it('does not promise a tray full of bins when the rack was empty', async () => {
      rack('R1 · Garage');
      rack('R2 · Shed');
      (await edit()).removeRack(areas(), 1);
      press('Remove rack');

      expect(onSpill).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith('R2 taken off the wall');
    });

    it('refuses to empty the wall, without even asking', async () => {
      // A map with no racks has nowhere to put anything back.
      rack('R1 · Garage', 1);
      (await edit()).removeRack(areas(), 0);

      expect(alert).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith('The wall keeps at least one rack.');
      expect(listLocations(db)).toHaveLength(1);
    });

    it('ignores a rack index that is not on the wall', async () => {
      rack('R1 · Garage');
      rack('R2 · Shed');
      (await edit()).removeRack(areas(), 9);
      expect(alert).not.toHaveBeenCalled();
      expect(listLocations(db)).toHaveLength(2);
    });
  });

  describe('the rows stepper, coming down', () => {
    it('takes the last empty shelf off', async () => {
      const { location } = rack('R1 · Garage');
      createShelf(db, { locationId: location.id, name: 'Bottom', capacity: 4 });
      (await edit()).removeLastShelf(areas()[0]);

      expect(listShelves(db, location.id).map((s) => s.name)).toEqual(['Top']);
      expect(notify).toHaveBeenCalledWith('Bottom removed');
    });

    it('skips past a full shelf to the empty one above it', async () => {
      // Deliberately the last *empty* shelf, not the last shelf: a stepper is
      // not where anyone expects their bins to be sent to the tray.
      const { location } = rack('R1 · Garage');
      const middle = createShelf(db, { locationId: location.id, name: 'Middle', capacity: 4 });
      createShelf(db, { locationId: location.id, name: 'Bottom', capacity: 4 });
      createBin(db, { name: 'Wire', shortCode: 'B-900', shelfId: middle.id });
      // Bottom is empty and last, so remove it, then the next press must stop.
      const rackEdit = await edit();
      rackEdit.removeLastShelf(areas()[0]);
      expect(listShelves(db, location.id).map((s) => s.name)).toEqual(['Top', 'Middle']);

      rackEdit.removeLastShelf(areas()[0]);
      expect(listShelves(db, location.id).map((s) => s.name)).toEqual(['Middle']);
      expect(listBins(db)).toHaveLength(1);
    });

    it('says what to do instead when every shelf is holding something', async () => {
      const { location } = rack('R1 · Garage', 1);
      const second = createShelf(db, { locationId: location.id, name: 'Bottom', capacity: 4 });
      createBin(db, { name: 'Wire', shortCode: 'B-901', shelfId: second.id });
      (await edit()).removeLastShelf(areas()[0]);

      expect(notify).toHaveBeenCalledWith('Empty a shelf before removing it.');
      expect(listShelves(db, location.id)).toHaveLength(2);
    });

    it('keeps the last shelf, so a rack is never a bare frame', async () => {
      const { location } = rack('R1 · Garage');
      (await edit()).removeLastShelf(areas()[0]);

      expect(notify).toHaveBeenCalledWith('A rack keeps at least one shelf.');
      expect(listShelves(db, location.id)).toHaveLength(1);
    });
  });

  /**
   * A rack's shelf names describe where the shelves are, so they have to stay
   * true when the ROWS stepper changes how many there are. Only while nobody
   * has said otherwise: a typed name, or a shelf with bins filed against it,
   * and the stepper leaves the names alone (see `ladderFor`).
   */
  describe('the shelf names, as a rack changes height', () => {
    /** A rack built the way "+ RACK" builds one, and its shelves. */
    const shelvesOf = () => listShelves(db, listLocations(db)[0].id).map((s) => s.name);

    it('builds a fresh rack four shelves tall, named top to bottom', async () => {
      (await edit()).addRack(4);
      expect(shelvesOf()).toEqual(['Top', 'Upper', 'Lower', 'Bottom']);
    });

    it('re-reads the ladder all the way down to one shelf', async () => {
      const rackEdit = await edit();
      rackEdit.addRack(4);

      // Four has a word for each rung; three does not, and leaving "Upper"
      // and "Lower" on a rack with nothing between them describes a rack that
      // no longer exists.
      rackEdit.removeLastShelf(areas()[0]);
      expect(shelvesOf()).toEqual(['Top', 'Middle', 'Bottom']);

      rackEdit.removeLastShelf(areas()[0]);
      expect(shelvesOf()).toEqual(['Top', 'Bottom']);

      rackEdit.removeLastShelf(areas()[0]);
      expect(shelvesOf()).toEqual(['Top']);
    });

    it('re-reads it going back up, naming the new shelf as part of the ladder', async () => {
      const rackEdit = await edit();
      rackEdit.addRack(4);
      rackEdit.addShelf(areas()[0], 4);

      // Not Top / Upper / Lower / Bottom / New shelf: the rack got taller, so
      // every shelf on it is somewhere different.
      expect(shelvesOf()).toEqual(['Top', 'Upper', 'Middle', 'Lower', 'Bottom']);
    });

    it('says so, rather than rewriting three labels silently', async () => {
      const rackEdit = await edit();
      rackEdit.addRack(4);
      rackEdit.removeLastShelf(areas()[0]);

      expect(notify).toHaveBeenCalledWith('Bottom removed — now Top, Middle, Bottom');
    });

    it('stops the moment one shelf has been named by hand', async () => {
      const rackEdit = await edit();
      rackEdit.addRack(4);
      const shelves = listShelves(db, listLocations(db)[0].id);
      rackEdit.renameShelf(shelves[1].id, 'Paint tins');

      rackEdit.removeLastShelf(areas()[0]);
      // Nothing renamed, and nothing claimed to have been.
      expect(shelvesOf()).toEqual(['Top', 'Paint tins', 'Lower']);
      expect(notify).toHaveBeenCalledWith('Bottom removed');

      rackEdit.addShelf(areas()[0], 4);
      expect(shelvesOf()).toEqual(['Top', 'Paint tins', 'Lower', 'New shelf']);
    });

    it('stops once anything has been filed on the rack', async () => {
      // A shelf holding bins is a shelf whose name is on every breadcrumb
      // pointing at them, and the ROWS stepper is not where anyone expects
      // that to be rewritten.
      const rackEdit = await edit();
      rackEdit.addRack(4);
      const shelves = listShelves(db, listLocations(db)[0].id);
      createBin(db, { name: 'Wire', shortCode: 'B-800', shelfId: shelves[0].id });

      rackEdit.removeLastShelf(areas()[0]);
      expect(shelvesOf()).toEqual(['Top', 'Upper', 'Lower']);
    });

    it('leaves a rack that was never on the ladder entirely alone', async () => {
      // Racks made before any of this existed, and racks made by hand.
      const { location } = rack('R1 · Garage');
      createShelf(db, { locationId: location.id, name: 'Shelf A', capacity: 4 });
      const rackEdit = await edit();

      rackEdit.addShelf(areas()[0], 4);
      expect(shelvesOf()).toEqual(['Top', 'Shelf A', 'New shelf']);
    });
  });

  describe('the smaller edits', () => {
    it('refuses a shelf name that is only whitespace', async () => {
      const { shelf } = rack('R1 · Garage');
      (await edit()).renameShelf(shelf.id, '   ');

      expect(listShelves(db, listLocations(db)[0].id)[0].name).toBe('Top');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('trims the name it is given rather than storing the spaces', async () => {
      const { shelf } = rack('R1 · Garage');
      (await edit()).renameShelf(shelf.id, '  Middle  ');
      expect(listShelves(db, listLocations(db)[0].id)[0].name).toBe('Middle');
    });

    it('never sizes a shelf down to nothing', async () => {
      // A zero-slot shelf has nowhere to drop and no way back up.
      const { shelf } = rack('R1 · Garage');
      (await edit()).setShelfWidth(shelf.id, 0);
      expect(listShelves(db, listLocations(db)[0].id)[0].capacity).toBe(1);
    });

    it('names a fresh rack the same way whether it is the first or the fifth', async () => {
      // The empty state offers to make one and so does "+ RACK"; if these two
      // disagreed the wall would gain a rack called something else entirely.
      rack('R1 · Garage');
      (await edit()).addRack(4);
      const added = listLocations(db).at(-1);
      expect(added?.name).toContain(newRackLabel());
    });
  });
});
