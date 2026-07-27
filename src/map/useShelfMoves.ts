import { useCallback, useEffect, useRef, useState } from 'react';

import type { MoveConfirmRequest } from '@/components/map/MoveConfirmSheet';
import type { DbAdapter } from '@/db/adapter';
import { describePlace, locateMany, planDrop, type DropTarget, type MapArea } from '@/db/mapView';
import { placeBin } from '@/db/queries';
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
  lift: (binId: string) => void;
  executeDrop: (binId: string, target: DropTarget) => void;
  /** Bin that just landed, for the settle ring. */
  settling: string | null;
  confirm: (MoveConfirmRequest & { commit: () => void }) | null;
  cancelConfirm: () => void;
  undo: { label: string; revert: () => void } | null;
  offerUndo: (label: string, revert: () => void) => void;
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
  const [undo, setUndo] = useState<{ label: string; revert: () => void } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const offerUndo = useCallback((label: string, revert: () => void) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ label, revert });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, []);

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
    (binId: string, target: DropTarget) => {
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

      if (plan.crossShelf) {
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

  // Each member is memoized so a caller can hand it straight to a child
  // without the React Compiler having to assume it might run during render.
  const heldNow = useCallback(() => heldRef.current, []);

  const cancelConfirm = useCallback(() => {
    setConfirm(null);
    hold(null);
  }, [hold]);

  const takeUndo = useCallback(() => {
    undo?.revert();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  }, [undo]);

  const clearUndo = useCallback(() => setUndo(null), []);

  return {
    held,
    heldNow,
    hold,
    lift,
    executeDrop,
    settling,
    confirm,
    cancelConfirm,
    undo,
    offerUndo,
    takeUndo,
    clearUndo,
  };
}
