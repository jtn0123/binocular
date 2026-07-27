import { useCallback, useRef } from 'react';
import type { ScrollView, LayoutRectangle } from 'react-native';

import { CARD_W, slotMidlines } from '@/components/map/metrics';
import type { MapArea, MapRow } from '@/db/mapView';
import { sp } from '@/theme';

import type { RowMeasurement } from './dragGeometry';

/**
 * Where everything on the map currently is.
 *
 * React Native only ever reports a view's position relative to its direct
 * parent, so nothing here can be read from a single layout event: a board
 * sits inside a well, inside an area, inside a scroll view. This hook
 * collects each link as it lays out and sums the chain on demand — for
 * scrolling a shelf into view, and for telling the drag which slot a finger
 * is over. Dropping any link silently lands a bin on the wrong shelf.
 */
export interface MapFrames {
  scrollRef: React.RefObject<ScrollView | null>;
  /** Current vertical offset, written from the scroll event. */
  getScrollY: () => number;
  /** The gesture view's own box, for edge auto-scroll. */
  getViewport: () => LayoutRectangle | null;
  /** Scrolls without animation — used by the drag's edge auto-scroll. */
  scrollTo: (y: number) => void;
  areaKeyOf: (index: number, locationId: string | null) => string;
  rowKey: (row: MapRow) => string;
  setViewport: (frame: LayoutRectangle) => void;
  setScrollY: (y: number) => void;
  setAreaFrame: (areaKey: string, frame: LayoutRectangle) => void;
  setWellFrame: (areaKey: string, frame: LayoutRectangle) => void;
  setBoardFrame: (rowKey: string, frame: LayoutRectangle) => void;
  setStripFrame: (rowKey: string, frame: LayoutRectangle) => void;
  setStripScroll: (rowKey: string, x: number) => void;
  scrollToRow: (areaKey: string, rowKey: string) => void;
  jumpToShelf: (areas: readonly MapArea[], shelfId: string | null) => void;
  measureRows: (areas: readonly MapArea[]) => RowMeasurement[];
}

export function useMapFrames(): MapFrames {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const viewport = useRef<LayoutRectangle | null>(null);
  const areaFrames = useRef<Record<string, LayoutRectangle>>({});
  /** The recessed well inside an area; boards lay out relative to it. */
  const wellFrames = useRef<Record<string, LayoutRectangle>>({});
  const boardFrames = useRef<Record<string, LayoutRectangle>>({});
  const stripFrames = useRef<Record<string, LayoutRectangle>>({});
  const stripScrollX = useRef<Record<string, number>>({});

  const areaKeyOf = useCallback(
    (index: number, locationId: string | null) => locationId ?? `unplaced-${index}`,
    [],
  );
  const rowKey = useCallback((row: MapRow) => row.shelfId ?? 'unshelved', []);

  const scrollToRow = useCallback((areaKey: string, key: string) => {
    const y =
      (areaFrames.current[areaKey]?.y ?? 0) +
      (wellFrames.current[areaKey]?.y ?? 0) +
      (boardFrames.current[key]?.y ?? 0);
    scrollRef.current?.scrollTo({ y: Math.max(0, y - sp(6)), animated: true });
  }, []);

  const jumpToShelf = useCallback(
    (areas: readonly MapArea[], shelfId: string | null) => {
      areas.forEach((area, index) => {
        const row = area.rows.find((r) => r.shelfId === shelfId);
        if (row) scrollToRow(areaKeyOf(index, area.locationId), rowKey(row));
      });
    },
    [areaKeyOf, rowKey, scrollToRow],
  );

  /**
   * Every shelf row as it sits on screen right now, in the gesture view's
   * space. Card positions are arithmetic rather than measured: every card is
   * the same width, so a row is a uniform strip offset by its own sideways
   * scroll. That is what keeps the drag to one detector for the whole map.
   */
  const measureRows = useCallback(
    (areas: readonly MapArea[]): RowMeasurement[] => {
      const rows: RowMeasurement[] = [];
      areas.forEach((area, index) => {
        const areaKey = areaKeyOf(index, area.locationId);
        const a = areaFrames.current[areaKey];
        const well = wellFrames.current[areaKey];
        if (!a || !well) return;
        area.rows.forEach((row) => {
          const key = rowKey(row);
          const board = boardFrames.current[key];
          const strip = stripFrames.current[key];
          if (!board || !strip) return;
          const top = a.y + well.y + board.y - scrollY.current;
          const left = a.x + well.x + board.x + strip.x - (stripScrollX.current[key] ?? 0);
          rows.push({
            shelfId: row.shelfId,
            top,
            bottom: top + board.height,
            cards: slotMidlines(left, row.bins.length).map((mid, i) => ({
              binId: row.bins[i].binId,
              x: mid - CARD_W / 2,
              width: CARD_W,
            })),
          });
        });
      });
      return rows;
    },
    [areaKeyOf, rowKey],
  );

  // Written from layout and scroll events, never during render — which is
  // also why each is its own callback rather than a shared factory taking the
  // ref as an argument.
  const setAreaFrame = useCallback((key: string, frame: LayoutRectangle) => {
    areaFrames.current[key] = frame;
  }, []);
  const setWellFrame = useCallback((key: string, frame: LayoutRectangle) => {
    wellFrames.current[key] = frame;
  }, []);
  const setBoardFrame = useCallback((key: string, frame: LayoutRectangle) => {
    boardFrames.current[key] = frame;
  }, []);
  const setStripFrame = useCallback((key: string, frame: LayoutRectangle) => {
    stripFrames.current[key] = frame;
  }, []);
  const setStripScroll = useCallback((key: string, x: number) => {
    stripScrollX.current[key] = x;
  }, []);
  const setViewport = useCallback((frame: LayoutRectangle) => {
    viewport.current = frame;
  }, []);
  const setScrollY = useCallback((y: number) => {
    scrollY.current = y;
  }, []);

  const getScrollY = useCallback(() => scrollY.current, []);
  const getViewport = useCallback(() => viewport.current, []);
  const scrollTo = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false });
  }, []);

  return {
    scrollRef,
    getScrollY,
    getViewport,
    scrollTo,
    areaKeyOf,
    rowKey,
    setViewport,
    setScrollY,
    setAreaFrame,
    setWellFrame,
    setBoardFrame,
    setStripFrame,
    setStripScroll,
    scrollToRow,
    jumpToShelf,
    measureRows,
  };
}
