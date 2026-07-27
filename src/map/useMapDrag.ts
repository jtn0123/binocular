import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import type { WallShelfFrame } from '@/components/map/WallStrip';
import type { DropTarget, MapArea } from '@/db/mapView';

import {
  autoScrollStep,
  binAt,
  freezeGeometry,
  hitTest,
  type DragGeometry,
  type DropSlot,
} from './dragGeometry';
import type { MapFrames } from './useMapFrames';

/** How long a bin must be held before it comes off the shelf. */
export const HOLD_MS = 400;

/**
 * A finger, in both spaces at once: relative to the map's gesture view, and
 * on the glass. The boards are measured in the first and the wall strip in
 * the second, so both travel together rather than being converted at the
 * point of use, where a missing offset is invisible.
 */
export interface DragPoint {
  x: number;
  y: number;
  absX: number;
  absY: number;
}

export interface MapDrag {
  /** The one gesture for the whole map. */
  pan: ReturnType<typeof Gesture.Pan>;
  /** Bin under the finger, drawn as the hole it left. */
  dragging: string | null;
  /** Where it would land, for the landing slot and the banner. */
  slot: DropSlot | null;
  ghost: {
    x: SharedValue<number>;
    y: SharedValue<number>;
    scale: SharedValue<number>;
    opacity: SharedValue<number>;
  };
  /** Registers a wall strip's window-space frame as a drop target. */
  setWallFrame: (key: string, frame: WallShelfFrame) => void;
}

/**
 * The map's drag, as one gesture.
 *
 * The previous attempt at this wrapped *every cell* in its own detector
 * driving reanimated worklets and killed the process on the field phone
 * (docs/PLAN.md, "Map customization › Withdrawn"). This is the opposite
 * shape: one `Gesture.Pan` for the whole map and one animated node (the
 * ghost). Which bin was grabbed is a hit-test against measured frames, so a
 * wall of forty bins costs exactly one detector.
 *
 * The pan activates only after a hold, which is also what keeps it from
 * racing the vertical map scroll and each shelf's own sideways scroll — and
 * what makes a hold that never moves simply today's lift.
 */
export function useMapDrag({
  areas,
  enabled,
  frames,
  onLift,
  onDrop,
  onCancel,
  onDragStart,
}: {
  areas: readonly MapArea[];
  enabled: boolean;
  frames: MapFrames;
  /** Called as the bin leaves the shelf — the same lift a long press does. */
  onLift: (binId: string) => void;
  /** Released over a shelf. */
  onDrop: (binId: string, target: DropTarget) => void;
  /** Released over nothing: the bin goes back where it came from. */
  onCancel: () => void;
  /** Picked up — a chance to clear transient UI like the undo snackbar. */
  onDragStart: () => void;
}): MapDrag {
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const [slot, setSlot] = useState<DropSlot | null>(null);
  /**
   * The live drop target. A ref and not state on purpose: a gesture can end
   * in the same task as its last move, and reading state there commits the
   * *previous* slot — which is what made an earlier version land one slot
   * short, but only sometimes.
   */
  const slotRef = useRef<DropSlot | null>(null);
  const geometry = useRef<DragGeometry | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const pointer = useRef<DragPoint | null>(null);
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Wall strips in window coordinates; see `wallHit`. */
  const wallFrames = useRef<Record<string, WallShelfFrame>>({});

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const dragLive = useSharedValue(0);

  useEffect(
    () => () => {
      if (autoScroll.current) clearInterval(autoScroll.current);
    },
    [],
  );

  /**
   * The wall strip sits outside the map's own scroll area, so it is tested in
   * window coordinates — the space `measureInWindow` reported it in and the
   * space the gesture calls `absoluteX/absoluteY`. Rows stay in the gesture's
   * view-relative space; each target is compared in the space it was measured
   * in, and the two are never mixed.
   */
  const wallHit = useCallback((absX: number, absY: number): DropSlot | null => {
    for (const [key, frame] of Object.entries(wallFrames.current)) {
      if (absX < frame.x - 4 || absX > frame.x + frame.width + 4) continue;
      if (absY < frame.y - 3 || absY > frame.y + frame.height + 3) continue;
      return { shelfId: key === 'unshelved' ? null : key, index: -1, viaWall: true };
    }
    return null;
  }, []);

  const resolveSlot = useCallback(
    (point: DragPoint): DropSlot | null => {
      const wall = wallHit(point.absX, point.absY);
      if (wall) return wall;
      const geo = geometry.current;
      return geo ? hitTest(geo, { x: point.x, y: point.y }, frames.getScrollY()) : null;
    },
    [frames, wallHit],
  );

  const cleanup = useCallback(() => {
    draggingRef.current = null;
    geometry.current = null;
    slotRef.current = null;
    pointer.current = null;
    dragLive.value = 0;
    setDragging(null);
    setSlot(null);
    if (autoScroll.current) {
      clearInterval(autoScroll.current);
      autoScroll.current = null;
    }
  }, [dragLive]);

  const beginDrag = useCallback(
    (point: DragPoint) => {
      const rows = frames.measureRows(areas);
      const binId = binAt(rows, { x: point.x, y: point.y });
      if (!binId) return;

      onLift(binId);
      onDragStart();

      const card = rows.flatMap((r) => r.cards).find((c) => c.binId === binId);
      const band = rows.find((r) => r.cards.some((c) => c.binId === binId));
      const cardX = card?.x ?? point.x;
      const cardY = band?.top ?? point.y;

      geometry.current = freezeGeometry(rows, frames.getScrollY(), binId);
      origin.current = { x: cardX, y: cardY };
      pointer.current = point;
      draggingRef.current = binId;
      slotRef.current = null;

      grabX.value = point.x - cardX;
      grabY.value = point.y - cardY;
      x.value = cardX;
      y.value = cardY;
      opacity.value = 1;
      // The lift-pop: the card jumps a little as it leaves the shelf.
      scale.value = withTiming(1.05, { duration: 160 });
      dragLive.value = 1;
      setDragging(binId);

      // A finger held still at the edge still needs the map to travel, so the
      // scroll runs on a clock rather than on move events.
      if (autoScroll.current) clearInterval(autoScroll.current);
      autoScroll.current = setInterval(() => {
        const p = pointer.current;
        const box = frames.getViewport();
        if (!p || !box) return;
        const step = autoScrollStep(p.y, { top: 0, bottom: box.height });
        if (step === 0) return;
        frames.scrollTo(frames.getScrollY() + step);
        slotRef.current = resolveSlot(p);
        setSlot(slotRef.current);
      }, 16);
    },
    [areas, dragLive, frames, grabX, grabY, onDragStart, onLift, opacity, resolveSlot, scale, x, y],
  );

  const trackDrag = useCallback(
    (point: DragPoint) => {
      if (!draggingRef.current) return;
      pointer.current = point;
      const next = resolveSlot(point);
      const before = slotRef.current;
      slotRef.current = next;
      if (
        before?.shelfId !== next?.shelfId ||
        before?.index !== next?.index ||
        before?.viaWall !== next?.viaWall
      ) {
        setSlot(next);
      }
    },
    [resolveSlot],
  );

  const finishDrag = useCallback(() => {
    const binId = draggingRef.current;
    const target = slotRef.current;
    if (!binId) return;

    if (!target) {
      // Released over nothing. The ghost flies home rather than blinking out,
      // so the bin never looks like it went missing.
      const home = origin.current;
      scale.value = withTiming(1, { duration: 200 });
      if (home) {
        x.value = withTiming(home.x, { duration: 200 });
        y.value = withTiming(home.y, { duration: 200 });
      }
      opacity.value = withTiming(0, { duration: 200 });
      cleanup();
      onCancel();
      return;
    }

    opacity.value = 0;
    scale.value = 1;
    cleanup();
    onDrop(
      binId,
      target.viaWall
        ? { shelfId: target.shelfId }
        : { shelfId: target.shelfId, index: target.index },
    );
  }, [cleanup, onCancel, onDrop, opacity, scale, x, y]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .activateAfterLongPress(HOLD_MS)
        .onStart((e) => {
          runOnJS(beginDrag)({ x: e.x, y: e.y, absX: e.absoluteX, absY: e.absoluteY });
        })
        .onUpdate((e) => {
          if (dragLive.value === 0) return;
          x.value = e.x - grabX.value;
          y.value = e.y - grabY.value;
          runOnJS(trackDrag)({ x: e.x, y: e.y, absX: e.absoluteX, absY: e.absoluteY });
        })
        // Unconditional on purpose. A gesture that ends before `beginDrag`
        // has run on the JS thread would otherwise leave a bin in the air
        // with nothing left to put it down; `finishDrag` no-ops when there is
        // nothing in hand, and runOnJS preserves the order of the two calls.
        .onFinalize(() => {
          runOnJS(finishDrag)();
        }),
    [beginDrag, dragLive, enabled, finishDrag, grabX, grabY, trackDrag, x, y],
  );

  return {
    pan,
    dragging,
    slot,
    ghost: { x, y, scale, opacity },
    setWallFrame: (key, frame) => {
      wallFrames.current[key] = frame;
    },
  };
}
