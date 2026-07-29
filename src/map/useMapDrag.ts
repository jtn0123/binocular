import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

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
 * How far the finger may wander during a hold and still count as standing
 * still. A thumb is never perfectly steady, and treating a two-pixel tremor
 * as a drag is what turns "lift it" into "lift it and put it back".
 */
const LIFT_SLOP = 6;

/**
 * A finger, in both spaces at once: relative to the map's gesture view, and
 * on the glass. The boards are measured in the first and the tray drawer and
 * side rails in the second, so both travel together rather than being
 * converted at the point of use, where a missing offset is invisible.
 */
export interface DragPoint {
  x: number;
  y: number;
  absX: number;
  absY: number;
}

/** A drop target's position on the glass, so a drag can be tested against it. */
export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which way off this rack (v3). Resting on a rail pages the wall under you
 * with the bin still in hand; releasing on one sends it to the rack that way.
 */
export type RackEdge = 'prev' | 'next';

export interface MapDrag {
  /** The one gesture for the whole map. */
  pan: ReturnType<typeof Gesture.Pan>;
  /** Bin under the finger, drawn as the hole it left. */
  dragging: string | null;
  /** Where it would land, for the landing slot and the banner. */
  slot: DropSlot | null;
  /** Over a side rail — leaving this rack entirely, so no slot applies. */
  edge: RackEdge | null;
  ghost: {
    x: SharedValue<number>;
    y: SharedValue<number>;
    scale: SharedValue<number>;
    opacity: SharedValue<number>;
  };
  /**
   * Registers a drop target that lives outside the map's own scroll area, in
   * window coordinates — today the unshelved tray drawer. Anything registered
   * here must stay mounted, because a stale window rectangle keeps matching
   * the band of screen it used to occupy.
   */
  setWallFrame: (key: string, frame: WindowFrame) => void;
  /** Registers a side rail. Pass null to forget it when it stops being drawn. */
  setEdgeFrame: (edge: RackEdge, frame: WindowFrame | null) => void;
  /**
   * Re-freezes the drop geometry against what is on screen *now*. The frozen
   * snapshot exists so a drag cannot chase its own landing slot (see
   * dragGeometry.ts), but resting on a rail pages the whole rack under the
   * finger — and then the snapshot describes shelves that are no longer
   * drawn. Call this after the new rack has laid out.
   */
  refreeze: () => void;
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
  onEdgeDrop,
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
  /** Released over a side rail: send it to a rack further along the wall. */
  onEdgeDrop: (binId: string, edge: RackEdge) => void;
  /** Released over nothing: the bin goes back where it came from. */
  onCancel: () => void;
  /** Picked up — a chance to clear transient UI like the undo snackbar. */
  onDragStart: () => void;
}): MapDrag {
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const [slot, setSlot] = useState<DropSlot | null>(null);
  const [edge, setEdge] = useState<RackEdge | null>(null);
  const edgeRef = useRef<RackEdge | null>(null);
  const edgeFrames = useRef<Partial<Record<RackEdge, WindowFrame>>>({});
  /**
   * The live drop target. A ref and not state on purpose: a gesture can end
   * in the same task as its last move, and reading state there commits the
   * *previous* slot — which is what made an earlier version land one slot
   * short, but only sometimes.
   */
  const slotRef = useRef<DropSlot | null>(null);
  const geometry = useRef<DragGeometry | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /**
   * Where the finger came down, and whether it ever went anywhere.
   *
   * The pan activates on the hold itself, which means a hold that never moves
   * still runs the whole drag — and releasing it used to land on "released
   * over nothing" and put the bin straight back down. That silently removed
   * lift-and-place whenever the drag was switched on: the one path that has
   * to work, and the only one a screen reader drives.
   */
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const pointer = useRef<DragPoint | null>(null);
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Out-of-scroll drop targets in window coordinates; see `wallHit`. */
  const wallFrames = useRef<Record<string, WindowFrame>>({});

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
   * The tray drawer sits outside the map's own scroll area, so it is tested
   * in window coordinates — the space `measureInWindow` reported it in and
   * the space the gesture calls `absoluteX/absoluteY`. Rows stay in the
   * gesture's view-relative space; each target is compared in the space it
   * was measured in, and the two are never mixed.
   */
  const wallHit = useCallback(
    (absX: number, absY: number): DropSlot | null => {
      for (const [key, frame] of Object.entries(wallFrames.current)) {
        if (absX < frame.x - 4 || absX > frame.x + frame.width + 4) continue;
        if (absY < frame.y - 3 || absY > frame.y + frame.height + 3) continue;
        const shelfId = key === 'unshelved' ? null : key;
        // A shelf deleted while its frame is registered stays registered
        // until the next layout. Dropping onto a shelf that no longer exists
        // would resolve to nothing, so ignore the stale target and let the
        // boards underneath answer instead.
        if (!areas.some((area) => area.rows.some((row) => row.shelfId === shelfId))) continue;
        return { shelfId, index: -1, viaWall: true };
      }
      return null;
    },
    [areas],
  );

  /**
   * The side rails, tested first and in window coordinates like the tray. A
   * rail hit means "leave this rack" — the rack, not a slot, is the target —
   * so it short-circuits everything underneath it.
   */
  const edgeHit = useCallback((absX: number, absY: number): RackEdge | null => {
    for (const [key, frame] of Object.entries(edgeFrames.current)) {
      if (!frame) continue;
      if (absX < frame.x - 8 || absX > frame.x + frame.width + 8) continue;
      if (absY < frame.y - 4 || absY > frame.y + frame.height + 4) continue;
      return key as RackEdge;
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
    start.current = null;
    slotRef.current = null;
    pointer.current = null;
    edgeRef.current = null;
    dragLive.value = 0;
    setDragging(null);
    setSlot(null);
    setEdge(null);
    if (autoScroll.current) {
      clearInterval(autoScroll.current);
      autoScroll.current = null;
    }
  }, [dragLive]);

  /**
   * Declared above `beginDrag` because the edge auto-scroll routes its ticks
   * through it: the clock runs at 16 ms, and setting state unconditionally
   * there re-renders the whole map sixty times a second while a finger rests
   * at the edge. The equality guard below is what makes that cost nothing.
   */
  const trackDrag = useCallback(
    (point: DragPoint) => {
      if (!draggingRef.current) return;
      pointer.current = point;
      const from = start.current;
      if (from && Math.abs(point.x - from.x) + Math.abs(point.y - from.y) > LIFT_SLOP) {
        moved.current = true;
      }

      const overEdge = edgeHit(point.absX, point.absY);
      if (overEdge !== edgeRef.current) {
        edgeRef.current = overEdge;
        setEdge(overEdge);
      }
      if (overEdge) {
        // The rail wins outright: a bin over it is leaving the rack, and a
        // landing slot drawn underneath would claim otherwise.
        if (slotRef.current !== null) {
          slotRef.current = null;
          setSlot(null);
        }
        return;
      }

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
    [edgeHit, resolveSlot],
  );

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
      start.current = { x: point.x, y: point.y };
      moved.current = false;
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
        trackDrag(p);
      }, 16);
    },
    [areas, dragLive, frames, grabX, grabY, onDragStart, onLift, opacity, scale, trackDrag, x, y],
  );

  const finishDrag = useCallback(() => {
    const binId = draggingRef.current;
    const target = slotRef.current;
    const overEdge = edgeRef.current;
    if (!binId) return;

    /**
     * A hold that never travelled is a **lift**, not a drop.
     *
     * This has to come before every other branch. The edge auto-scroll ticks
     * `trackDrag` on a clock, so even a motionless finger resolves the slot
     * it is sitting on — and releasing then took the ordinary drop path,
     * where `planDrop` correctly reported "this changes nothing" and put the
     * bin straight back down. The visible symptom was that holding a bin did
     * nothing at all, which quietly removed lift-and-place whenever the drag
     * was switched on: the one path that must always work.
     */
    if (!moved.current) {
      opacity.value = withTiming(0, { duration: 150 });
      scale.value = withTiming(1, { duration: 150 });
      cleanup();
      return;
    }

    if (overEdge) {
      opacity.value = 0;
      scale.value = 1;
      cleanup();
      onEdgeDrop(binId, overEdge);
      return;
    }

    if (!target) {
      // A real drag, released over nothing. The ghost flies home rather than
      // blinking out, so the bin never looks like it went missing.
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
  }, [cleanup, onCancel, onDrop, onEdgeDrop, opacity, scale, x, y]);

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

  // Memoized like everything else this hook hands out: the map screen clears
  // the wall frames from an effect keyed on this identity, and a fresh
  // function each render would re-run that effect on every render instead of
  // on the transition it is written for.
  const setWallFrame = useCallback((key: string, frame: WindowFrame) => {
    wallFrames.current[key] = frame;
  }, []);

  const setEdgeFrame = useCallback((which: RackEdge, frame: WindowFrame | null) => {
    if (frame) edgeFrames.current[which] = frame;
    else delete edgeFrames.current[which];
  }, []);

  const refreeze = useCallback(() => {
    const binId = draggingRef.current;
    if (!binId) return;
    geometry.current = freezeGeometry(frames.measureRows(areas), frames.getScrollY(), binId);
    // The old slot named a shelf on the rack that just left the screen.
    //
    // `trackDrag` below would clear it too, since it only keeps a slot it can
    // still resolve. This does not rely on that: it only takes one early
    // return added to `trackDrag` for a stale outline to survive a page, and
    // an outline pointing at a shelf that is no longer on screen is a promise
    // about where a bin will land that the drop will not keep.
    slotRef.current = null;
    setSlot(null);
    const point = pointer.current;
    if (point) trackDrag(point);
  }, [areas, frames, trackDrag]);

  return {
    pan,
    dragging,
    slot,
    edge,
    ghost: { x, y, scale, opacity },
    setWallFrame,
    setEdgeFrame,
    refreeze,
  };
}
