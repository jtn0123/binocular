import { useCallback, useEffect, useRef, useState } from 'react';

import type { MoveConfirmRequest } from '@/components/map/MoveConfirmSheet';
import type { DbAdapter } from '@/db/adapter';
import {
  describePlace,
  locateMany,
  planDrop,
  planMultiDrop,
  type DropTarget,
  type MapArea,
} from '@/db/mapView';
import { placeBin, placeBins, restoreBins } from '@/db/queries';
import { logEvent } from '@/diagnostics/events';
import { hapticShutter, hapticSuccess } from '@/lib/haptics';

import { findRow } from './mapPresentation';

export interface ShelfMoves {
  /** The bin in hand, whether lifted by a hold or carried by a drag. */
  held: string | null;
  /**
   * The bin in hand, read synchronously. A tap handler must not read `held`
   * from state: a lift and the tap that places it can land in the same task,
   * and the stale value drops the wrong bin — or navigates instead.
   */
  heldNow: () => string | null;
  hold: (binId: string | null) => void;
  /** Puts down whatever is in hand. Stable, so the pan can depend on it. */
  cancelHold: () => void;
  lift: (binId: string) => void;
  /**
   * `settled` skips the re-home confirm because something else already was
   * one — the rack picker names the rack, the shelf and the slot before you
   * choose it, so asking again straight afterwards is a tax, not a safeguard.
   */
  executeDrop: (binId: string, target: DropTarget, options?: { settled?: boolean }) => void;
  /**
   * The same drop for a picked stack (v3). One transaction, one undo, and
   * no confirm: the group move was already an explicit "move them", so a
   * second modal on top of it is a tax rather than a safeguard.
   */
  executeMultiDrop: (binIds: readonly string[], target: DropTarget) => void;
  /** Bin that just landed, for the settle ring. */
  settling: string | null;
  confirm: (MoveConfirmRequest & { commit: () => void }) | null;
  cancelConfirm: () => void;
  /** `revert` is null when the thing that happened cannot be taken back. */
  undo: { label: string; revert: (() => void) | null } | null;
  offerUndo: (label: string, revert: () => void) => void;
  /** Says what happened without offering to undo it. */
  notify: (label: string) => void;
  takeUndo: () => void;
  clearUndo: () => void;
}

/**
 * Moving a bin on the map (D21), independent of how the move was expressed.
 *
 * Drag, lift-and-tap and drop-on-a-free-slot all arrive here as one
 * `DropTarget`, so the three paths cannot drift apart — an earlier version
 * had the tap path computing an index a different way and landing one slot
 * off. A drop that crosses shelves is the §8.5 move and asks first; a drop
 * within a shelf just writes the stored order.
 */
export function useShelfMoves({
  db,
  areas,
  onChange,
}: {
  db: DbAdapter;
  areas: readonly MapArea[];
  /** Redraw from the database — the map never trusts its own render tree. */
  onChange: () => void;
}): ShelfMoves {
  const [held, setHeld] = useState<string | null>(null);
  const heldRef = useRef<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirm, setConfirm] = useState<(MoveConfirmRequest & { commit: () => void }) | null>(
    null,
  );

  // The same one-slot undo bin detail offers, for the same reason: a move is
  // one press away and was otherwise only reversible by doing it again
  // backwards — which means remembering where the bin actually came from.
  const [undo, setUndo] = useState<{ label: string; revert: (() => void) | null } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const say = useCallback((label: string, revert: (() => void) | null) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ label, revert });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, []);

  const offerUndo = useCallback(
    (label: string, revert: () => void) => say(label, revert),
    [say],
  );

  /**
   * The same strip without the UNDO button, for things that genuinely cannot
   * be taken back — deleting a shelf, whose id no recreation would restore.
   * Offering a button that does nothing reads as a silent failure.
   */
  const notify = useCallback((label: string) => say(label, null), [say]);

  const hold = useCallback((binId: string | null) => {
    heldRef.current = binId;
    setHeld(binId);
  }, []);

  /**
   * Lifts a bin. Idempotent on purpose: lifting twice must not toggle. On a
   * device both the pan's long press and Pressable's `onLongPress` fire for
   * one hold, and when this toggled, the second call put the bin straight
   * back down.
   */
  const lift = useCallback(
    (binId: string) => {
      if (heldRef.current === binId) return;
      hapticShutter();
      hold(binId);
    },
    [hold],
  );

  const executeDrop = useCallback(
    (binId: string, target: DropTarget, options?: { settled?: boolean }) => {
      const plan = planDrop(areas, binId, target);
      if (!plan) {
        hold(null);
        return;
      }
      const came = locateMany(areas, [binId])[0] ?? null;
      // Where it sat before, captured now: after the write the map is redrawn
      // from the database and the old arrangement is gone.
      const previous = {
        shelfId: came?.row.shelfId ?? null,
        orderedIds: came ? came.row.bins.map((c) => c.binId) : [],
      };
      const code = came?.cell.code ?? 'Bin';

      const commit = () => {
        placeBin(db, { binId: plan.binId, shelfId: plan.shelfId, orderedIds: plan.orderedIds });
        // "That bin is not where I left it" needs an answer, and the move
        // writes the same shelf_id everything else reads — so without this
        // there is no trace of it having happened here.
        logEvent(db, {
          kind: 'organize',
          name: plan.crossShelf ? 'bin_moved' : 'bin_reordered',
          detail: { bin: code, to: plan.place, position: plan.orderedIds.indexOf(plan.binId) },
        });
        hapticSuccess();
        hold(null);
        setConfirm(null);
        setSettling(plan.binId);
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => setSettling(null), 600);
        onChange();
        offerUndo(`${code} moved`, () => {
          placeBin(db, { binId: plan.binId, ...previous });
          logEvent(db, { kind: 'organize', name: 'move_undone', detail: { bin: code } });
          onChange();
        });
      };

      if (plan.crossShelf && !options?.settled) {
        // The §8.5 move — a real filing change, so it asks first.
        const destination = findRow(areas, plan.shelfId);
        const capacity = destination?.capacity ?? null;
        setConfirm({
          code,
          name: came?.cell.name ?? '',
          from: came ? describePlace(came) : 'Not filed anywhere yet',
          to: plan.place,
          slot: plan.orderedIds.indexOf(plan.binId) + 1,
          destination: destination?.name ?? plan.place,
          overCapacity: capacity !== null && plan.orderedIds.length > capacity ? capacity : null,
          commit,
        });
        return;
      }
      commit();
    },
    [areas, db, hold, offerUndo, onChange],
  );

  const executeMultiDrop = useCallback(
    (binIds: readonly string[], target: DropTarget) => {
      const plan = planMultiDrop(areas, binIds, target);
      if (!plan) {
        hold(null);
        return;
      }
      // Where each one sat before, captured now: after the write the map is
      // redrawn from the database and the old arrangement is gone.
      //
      // Grouped by source shelf, and it has to be: a stack can be picked up
      // off several shelves at once, and restoring a shelf means rewriting
      // that whole row's order — once, not once per bin that came off it.
      const bySource = new Map<
        string | null,
        { binIds: string[]; shelfId: string | null; orderedIds: string[] }
      >();
      for (const id of plan.binIds) {
        const came = locateMany(areas, [id])[0] ?? null;
        const shelfId = came?.row.shelfId ?? null;
        const group = bySource.get(shelfId) ?? {
          binIds: [],
          shelfId,
          orderedIds: came ? came.row.bins.map((c) => c.binId) : [],
        };
        group.binIds.push(id);
        bySource.set(shelfId, group);
      }
      const previous = [...bySource.values()];

      placeBins(db, { binIds: plan.binIds, shelfId: plan.shelfId, orderedIds: plan.orderedIds });
      logEvent(db, {
        kind: 'organize',
        name: 'bins_moved',
        detail: { bins: plan.binIds.length, to: plan.place },
      });
      hapticSuccess();
      hold(null);
      setSettling(plan.binIds[0]);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => setSettling(null), 600);
      onChange();
      offerUndo(`${plan.binIds.length} bins → ${plan.place}`, () => {
        // One transaction for the whole undo, however many shelves it spans.
        restoreBins(db, previous);
        logEvent(db, { kind: 'organize', name: 'move_undone', detail: { bins: plan.binIds.length } });
        onChange();
      });
    },
    [areas, db, hold, offerUndo, onChange],
  );

  // Each member is memoized so a caller can hand it straight to a child
  // without the React Compiler having to assume it might run during render.
  const heldNow = useCallback(() => heldRef.current, []);

  const cancelHold = useCallback(() => hold(null), [hold]);

  const cancelConfirm = useCallback(() => {
    setConfirm(null);
    hold(null);
  }, [hold]);

  const takeUndo = useCallback(() => {
    undo?.revert?.();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  }, [undo]);

  const clearUndo = useCallback(() => setUndo(null), []);

  return {
    held,
    heldNow,
    hold,
    cancelHold,
    lift,
    executeDrop,
    executeMultiDrop,
    settling,
    confirm,
    cancelConfirm,
    undo,
    offerUndo,
    notify,
    takeUndo,
    clearUndo,
  };
}
