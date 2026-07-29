import { renderHook } from '@testing-library/react-native';

import { buildMap, withTray, type MapArea } from '@/db/mapView';
import { createNodeAdapter, type NodeDbAdapter } from '@/db/nodeAdapter';
import {
  createBin,
  createLocation,
  createShelf,
  listBins,
  listBinsForShelf,
  listLocations,
  listShelves,
  listUnassignedBins,
} from '@/db/queries';
import { runMigrations } from '@/db/schema';

import { useShelfMoves } from '../useShelfMoves';

/**
 * Actually performing a move, and taking it back.
 *
 * The screen test presses these through the UI and covers the ordinary paths.
 * What it cannot reach are the ones that exist only because of the tray and
 * the rack picker: a bin that was never filed anywhere, and a move that has
 * already been agreed to somewhere else and must not ask twice.
 *
 * Undo matters most. A move that cannot be taken back is the one thing on
 * this screen that turns a mis-tap into an afternoon of searching, so it is
 * asserted against the database rather than against the banner offering it.
 */
describe('performing a move', () => {
  let db: NodeDbAdapter;
  let onChange: jest.Mock;
  let top: string;
  let lower: string;

  const areas = (): MapArea[] =>
    withTray(
      buildMap({
        locations: listLocations(db),
        shelves: listLocations(db).flatMap((l) => listShelves(db, l.id)),
        bins: listBins(db),
        itemCounts: new Map(),
      }),
    );

  /**
   * One hook for the whole test, with a way to let React catch up.
   *
   * `undo` and `confirm` are state, and these calls arrive from a gesture
   * rather than from an event React knows about — the same as on a device.
   * So the update is scheduled rather than applied, and reading it back needs
   * a turn of the loop.
   */
  const harness = async () => {
    const { result } = await renderHook(() => useShelfMoves({ db, areas: areas(), onChange }));
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    return {
      moves: result.current,
      // Waits for the re-render rather than for a fixed number of turns of
      // the loop, which is the difference between a test and a race.
      settle: async () => {
        const before = result.current;
        for (let turn = 0; turn < 20 && result.current === before; turn++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return result.current;
      },
    };
  };

  /** The codes on a shelf, in stored order. */
  const on = (shelfId: string) => listBinsForShelf(db, shelfId).map((b) => b.short_code);
  const binId = (code: string) => listBins(db).find((b) => b.short_code === code)!.id;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    onChange = jest.fn();
    const rack = createLocation(db, { name: 'R1 · Garage' });
    top = createShelf(db, { locationId: rack.id, name: 'Top', capacity: 4 }).id;
    lower = createShelf(db, { locationId: rack.id, name: 'Lower', capacity: 2 }).id;
    createBin(db, { name: 'Connectors', shortCode: 'B-001', shelfId: top });
    createBin(db, { name: 'Hand tools', shortCode: 'B-002', shelfId: top });
  });
  afterEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    db.close();
  });

  describe('the confirm a filing change asks for', () => {
    it('says where the bin is coming from and where it is going', async () => {
      const h = await harness();
      h.moves.executeDrop(binId('B-001'), { shelfId: lower, index: 0 });

      const confirm = (await h.settle()).confirm;
      expect(confirm).not.toBeNull();
      expect(confirm?.code).toBe('B-001');
      expect(confirm?.from).toBe('R1 · Garage › Top');
      expect(confirm?.to).toContain('Lower');
      // Nothing is written until it is answered.
      expect(on(lower)).toEqual([]);
    });

    it('says so plainly for a bin that has never been filed anywhere', async () => {
      // "from: undefined › undefined" is the kind of thing that makes someone
      // cancel a move that was perfectly correct.
      createBin(db, { name: 'Loose bits', shortCode: 'B-009', shelfId: null });
      const h = await harness();
      h.moves.executeDrop(binId('B-009'), { shelfId: top, index: 0 });

      expect((await h.settle()).confirm?.from).toBe('Not filed anywhere yet');
    });

    it('warns when the shelf is about to hold more than it says it can', async () => {
      // A warning, not a refusal: the shelf is a note about the shelf, and the
      // bin is already in someone's hand.
      const h = await harness();
      h.moves.executeMultiDrop([binId('B-001'), binId('B-002')], { shelfId: lower, index: 0 });
      const first = await h.settle();
      first.confirm?.commit();

      createBin(db, { name: 'Third', shortCode: 'B-003', shelfId: top });
      const h2 = await harness();
      h2.moves.executeDrop(binId('B-003'), { shelfId: lower, index: 0 });
      expect((await h2.settle()).confirm?.overCapacity).toBe(2);
    });

    it('does not warn about an unsized shelf, which has no limit to exceed', async () => {
      const rack = listLocations(db)[0];
      const open = createShelf(db, { locationId: rack.id, name: 'Open', capacity: null }).id;
      const h = await harness();
      h.moves.executeDrop(binId('B-001'), { shelfId: open, index: 0 });

      expect((await h.settle()).confirm?.overCapacity).toBeNull();
    });
  });

  describe('a move already agreed to elsewhere', () => {
    it('does not ask a second time', async () => {
      // The rack picker asks which rack *and* confirms. Asking again on
      // arrival turns a two-tap move into a four-tap one.
      const h = await harness();
      h.moves.executeDrop(binId('B-001'), { shelfId: lower, index: 0 }, { settled: true });

      expect((await h.settle()).confirm).toBeNull();
      expect(on(lower)).toEqual(['B-001']);
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('taking a move back', () => {
    it('puts the bin back on the shelf it came from, in its old order', async () => {
      const h = await harness();
      h.moves.executeDrop(binId('B-002'), { shelfId: lower, index: 0 }, { settled: true });
      expect(on(top)).toEqual(['B-001']);

      (await h.settle()).undo?.revert?.();
      expect(on(top)).toEqual(['B-001', 'B-002']);
      expect(on(lower)).toEqual([]);
    });

    it('puts a bin back in the tray it was dragged out of', async () => {
      // Undo has to restore "nowhere" as faithfully as it restores a shelf,
      // or dragging a loose bin by accident is a one-way trip.
      createBin(db, { name: 'Loose bits', shortCode: 'B-009', shelfId: null });
      const h = await harness();
      h.moves.executeDrop(binId('B-009'), { shelfId: top, index: 0 }, { settled: true });
      expect(listUnassignedBins(db)).toHaveLength(0);

      (await h.settle()).undo?.revert?.();
      expect(listUnassignedBins(db).map((b) => b.short_code)).toEqual(['B-009']);
    });

    it('restores every bin of a stack, not just the first', async () => {
      // One undo for the whole group: restoring one of four and calling it
      // done would be worse than not offering an undo at all.
      const h = await harness();
      h.moves.executeMultiDrop([binId('B-001'), binId('B-002')], { shelfId: lower, index: 0 });
      expect(on(lower)).toEqual(['B-001', 'B-002']);
      expect(on(top)).toEqual([]);

      (await h.settle()).undo?.revert?.();
      expect(on(top)).toEqual(['B-001', 'B-002']);
      expect(on(lower)).toEqual([]);
    });

    it('names what it would take back, so the offer is not a blind one', async () => {
      const h = await harness();
      h.moves.executeDrop(binId('B-002'), { shelfId: lower, index: 0 }, { settled: true });
      expect((await h.settle()).undo?.label).toContain('B-002');
    });
  });

  describe('a move that would change nothing', () => {
    it('writes nothing rather than recording a move that never happened', async () => {
      const h = await harness();
      h.moves.executeDrop(binId('B-001'), { shelfId: top, index: 0 });

      expect(onChange).not.toHaveBeenCalled();
      expect(on(top)).toEqual(['B-001', 'B-002']);
      expect((await h.settle()).confirm).toBeNull();
    });
  });

  describe('holding a bin', () => {
    it('keeps hold of it when the same bin is lifted twice', async () => {
      const h = await harness();
      h.moves.lift(binId('B-001'));
      h.moves.lift(binId('B-001'));
      expect(h.moves.heldNow()).toBe(binId('B-001'));
    });

    it('puts it down again on cancel', async () => {
      const h = await harness();
      h.moves.lift(binId('B-001'));
      h.moves.cancelHold();
      expect(h.moves.heldNow()).toBeNull();
    });
  });
});
