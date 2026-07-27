import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutRectangle,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';

import { DragGhost } from '@/components/map/DragGhost';
import { CARD_W, slotMidlines } from '@/components/map/metrics';
import { MoveConfirmSheet, type MoveConfirmRequest } from '@/components/map/MoveConfirmSheet';
import { ShelfBoard } from '@/components/map/ShelfBoard';
import { ShelfSheet, type ShelfDraft } from '@/components/map/ShelfSheet';
import { WallStrip, type WallShelfFrame } from '@/components/map/WallStrip';
import { useDb } from '@/db/DbProvider';
import {
  buildMap,
  describePlace,
  heatTier,
  locateMany,
  mapSize,
  planDrop,
  type DropTarget,
  type HeatMode,
  type MapCell,
  type MapRow,
} from '@/db/mapView';
import {
  createBin,
  deleteShelf,
  itemsForBin,
  listBins,
  listLocations,
  listShelves,
  nextShortCode,
  placeBin,
  renameShelf,
  setShelfCapacity,
} from '@/db/queries';
import { logEvent } from '@/diagnostics/events';
import { hapticShutter, hapticSuccess } from '@/lib/haptics';
import { useFocusTick } from '@/lib/useFocusTick';
import {
  binAt,
  freezeGeometry,
  hitTest,
  autoScrollStep,
  type DragGeometry,
  type DropSlot,
  type RowMeasurement,
} from '@/map/dragGeometry';
import { DEFAULT_MAP_PREFS, loadMapPrefs, type MapPrefs } from '@/settings/mapPrefs';
import { colors, mono, radius, shelf as shelfTheme, sp, type } from '@/theme';

/**
 * The workshop map (blueprint D21, amended): a schematic of the wall that is
 * also the place you arrange it. Shelves are rows, bins are cells, and the
 * layout is the data — there is no map-only position that can drift from
 * where a bin is really filed.
 *
 * Bins stand on planks in a straight strip rather than wrapping in a grid,
 * which is both how they sit on the wall and what makes the drag tractable:
 * every card is the same width, so the slot under a finger is arithmetic on
 * one row measurement instead of a measurement of every card.
 *
 * ## The gesture layer, and why it is back
 *
 * A finger-following drag was built here once, shipped to the field phone and
 * withdrawn the same day: it wrapped *every cell* in its own gesture-handler
 * detector driving reanimated worklets, and the process died natively — an
 * `app_start` seconds after every `screen//map` with no `app_background`
 * between them (docs/PLAN.md, "Map customization › Withdrawn").
 *
 * This is a different shape, and the difference is the point:
 *
 * - **One detector for the whole map**, not one per cell. Which bin was
 *   grabbed is answered by hit-testing a measurement, not by owning a
 *   handler. A wall of 40 bins costs exactly one detector.
 * - **One animated node** — the ghost. Cells are ordinary Views; nothing
 *   under the finger re-renders on the UI thread.
 * - **The pan activates only after a hold**, so it never competes with the
 *   two ScrollViews it sits inside.
 *
 * It is still not proven on the field phone, so it has an off switch
 * (Settings › Map › Drag bins to rearrange). Turning it off costs no
 * capability: lift-and-place moves any bin anywhere, and that is the path a
 * screen reader drives regardless. If the map ever closes itself again,
 * that switch is the first thing to try.
 *
 * `highlight` may carry several comma-separated bin ids: a search that
 * matched items in four bins lights all four, and the banner walks them.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // A field-test phone has no Metro console, so a screen that throws is just
  // a blank rectangle. expo-router renders this in the route's place instead.
  return (
    <ScrollView contentContainerStyle={styles.center}>
      <Text style={styles.crashTitle}>The map could not be drawn.</Text>
      <Text style={styles.crashMessage} selectable>
        {error?.message ?? String(error)}
      </Text>
      {error?.stack ? (
        <Text style={styles.crashStack} selectable>
          {error.stack.split('\n').slice(0, 8).join('\n')}
        </Text>
      ) : null}
      <Pressable
        style={styles.crashRetry}
        onPress={() => void retry()}
        accessibilityRole="button"
        accessibilityLabel="Try drawing the map again"
        testID="map-retry"
      >
        <Text style={styles.crashRetryText}>Try again</Text>
      </Pressable>
      <Text style={styles.dim}>
        Settings › Open diagnostics keeps a copy of this, and can copy it out.
      </Text>
    </ScrollView>
  );
}

/** How long a bin must be held before it comes off the shelf. */
const HOLD_MS = 400;

/**
 * A finger, in both spaces at once: relative to the map's gesture view, and
 * on the glass. The boards are measured in the first and the wall strip in
 * the second, so both travel together rather than being converted at the
 * point of use, where a missing offset is invisible.
 */
interface DragPoint {
  x: number;
  y: number;
  absX: number;
  absY: number;
}

export default function MapScreen() {
  // The map is a tab now, so it is usually opened with no params at all;
  // `highlight` only arrives when Home or a bin sent you here to find one.
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const db = useDb();
  const router = useRouter();
  useFocusTick();

  // Bumped after every mutation so the map redraws what the database says.
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const areas = useMemo(() => {
    const locations = listLocations(db);
    const shelves = locations.flatMap((l) => listShelves(db, l.id));
    const bins = listBins(db);
    const itemCounts = new Map(bins.map((b) => [b.id, itemsForBin(db, b.id).length]));
    return buildMap({ locations, shelves, bins, itemCounts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, tick]);

  const [prefs, setPrefs] = useState<MapPrefs>(DEFAULT_MAP_PREFS);
  useEffect(() => {
    void loadMapPrefs().then(setPrefs);
  }, []);

  // ---------------------------------------------------------------- finding
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [wallOpen, setWallOpen] = useState(false);

  const highlightIds = useMemo(
    () => (highlight ? highlight.split(',').filter(Boolean) : []),
    [highlight],
  );

  /**
   * Typing on the map searches the *bins* drawn on it — name and short code.
   * Item-level search is Home's job and arrives here as `highlight`, which
   * wins: it is a specific answer to a specific question.
   */
  const queryIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searchOpen || !q) return [];
    return areas.flatMap((area) =>
      area.rows.flatMap((row) =>
        row.bins
          .filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
          .map((c) => c.binId),
      ),
    );
  }, [areas, query, searchOpen]);

  const wantedIds = highlightIds.length > 0 ? highlightIds : queryIds;
  const finds = useMemo(() => locateMany(areas, wantedIds), [areas, wantedIds]);
  const [focusIndex, setFocusIndex] = useState(0);
  const focused = finds.length > 0 ? finds[Math.min(focusIndex, finds.length - 1)] : null;

  const [heat, setHeat] = useState<HeatMode>('none');
  // Recomputed per render on purpose: staleness tints must not fossilize.
  const nowIso = new Date().toISOString();

  const [sheet, setSheet] = useState<ShelfDraft | null>(null);
  const [confirm, setConfirm] = useState<(MoveConfirmRequest & { commit: () => void }) | null>(
    null,
  );

  // The same one-slot undo bin detail offers, for the same reason: a move is
  // one press away and was otherwise only reversible by doing it again
  // backwards — which means remembering where the bin actually came from.
  const [undo, setUndo] = useState<{ label: string; revert: () => void } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerUndo = useCallback((label: string, revert: () => void) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ label, revert });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, []);

  const [settling, setSettling] = useState<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Runs while a bin is dragged near an edge; declared here so the unmount
   *  cleanup below can stop it. */
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      // Leaving the tab mid-drag must not leave the auto-scroll clock running.
      if (autoScroll.current) clearInterval(autoScroll.current);
    },
    [],
  );

  // ------------------------------------------------------------- scrolling
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const viewport = useRef<LayoutRectangle | null>(null);
  const areaFrames = useRef<Record<string, LayoutRectangle>>({});
  /** The recessed well inside an area; boards are laid out relative to it. */
  const wellFrames = useRef<Record<string, LayoutRectangle>>({});
  const boardFrames = useRef<Record<string, LayoutRectangle>>({});
  const stripFrames = useRef<Record<string, LayoutRectangle>>({});
  const stripScrollX = useRef<Record<string, number>>({});
  /** Wall strips in window coordinates; see `wallHit`. */
  const wallFrames = useRef<Record<string, WallShelfFrame>>({});
  const scrolledOnce = useRef(false);

  const areaKeyOf = (index: number, locationId: string | null) => locationId ?? `unplaced-${index}`;
  const rowKey = (row: MapRow) => row.shelfId ?? 'unshelved';

  const scrollToRow = useCallback((areaKey: string, key: string) => {
    const y =
      (areaFrames.current[areaKey]?.y ?? 0) +
      (wellFrames.current[areaKey]?.y ?? 0) +
      (boardFrames.current[key]?.y ?? 0);
    scrollRef.current?.scrollTo({ y: Math.max(0, y - sp(6)), animated: true });
  }, []);

  const jumpToShelf = useCallback(
    (shelfId: string | null) => {
      areas.forEach((area, index) => {
        const row = area.rows.find((r) => r.shelfId === shelfId);
        if (row) scrollToRow(areaKeyOf(index, area.locationId), rowKey(row));
      });
    },
    [areas, scrollToRow],
  );

  useEffect(() => {
    if (!focused || scrolledOnce.current) return;
    const index = areas.indexOf(focused.area);
    const areaKey = areaKeyOf(index, focused.area.locationId);
    // Give the rows one frame to report their layout before the first jump.
    const t = setTimeout(() => {
      scrolledOnce.current = true;
      scrollToRow(areaKey, rowKey(focused.row));
    }, 120);
    return () => clearTimeout(t);
  }, [areas, focused, scrollToRow]);

  const stepFocus = useCallback(() => {
    if (finds.length < 2) return;
    const next = (focusIndex + 1) % finds.length;
    setFocusIndex(next);
    const find = finds[next];
    scrollToRow(areaKeyOf(areas.indexOf(find.area), find.area.locationId), rowKey(find.row));
  }, [areas, finds, focusIndex, scrollToRow]);

  // ---------------------------------------------------------------- moving
  // A mirror of `held` that is readable synchronously, so a long press that
  // arrives twice cannot undo itself — and so the drop reads the bin that is
  // actually in hand rather than a value React has not committed yet.
  const [held, setHeld] = useState<string | null>(null);
  const heldRef = useRef<string | null>(null);
  const hold = useCallback((binId: string | null) => {
    heldRef.current = binId;
    setHeld(binId);
  }, []);

  const heldFind = useMemo(
    () => (held ? (locateMany(areas, [held])[0] ?? null) : null),
    [areas, held],
  );

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
        bump();
        offerUndo(`${code} moved`, () => {
          placeBin(db, { binId: plan.binId, ...previous });
          logEvent(db, { kind: 'organize', name: 'move_undone', detail: { bin: code } });
          bump();
        });
      };

      if (plan.crossShelf) {
        // The §8.5 move — a real filing change, so it asks first.
        const destination = findRow(areas, plan.shelfId);
        const capacity = destination?.capacity ?? null;
        const landing = plan.orderedIds.indexOf(plan.binId) + 1;
        setConfirm({
          code,
          name: came?.cell.name ?? '',
          from: came ? describePlace(came) : 'Not filed anywhere yet',
          to: plan.place,
          slot: landing,
          destination: destination?.name ?? plan.place,
          overCapacity: capacity !== null && plan.orderedIds.length > capacity ? capacity : null,
          commit,
        });
        return;
      }
      commit();
    },
    [areas, bump, db, hold, offerUndo],
  );

  const onCellPress = useCallback(
    (cell: MapCell, row: MapRow) => {
      const inHand = heldRef.current;
      if (!inHand) {
        router.push({ pathname: '/bin/[id]', params: { id: cell.binId } });
        return;
      }
      if (cell.binId === inHand) {
        hold(null);
        return;
      }
      executeDrop(inHand, { shelfId: row.shelfId, beforeBinId: cell.binId });
    },
    [executeDrop, hold, router],
  );

  // ----------------------------------------------------------------- drag
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const [slot, setSlot] = useState<DropSlot | null>(null);
  /**
   * The live drop target. It is a ref and not state on purpose: a gesture can
   * end in the same task as its last move, and reading state there commits
   * the *previous* slot — which is what made an earlier version of this land
   * one slot short, but only sometimes.
   */
  const slotRef = useRef<DropSlot | null>(null);
  const geometry = useRef<DragGeometry | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const pointer = useRef<DragPoint | null>(null);

  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostScale = useSharedValue(1);
  const ghostOpacity = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const dragLive = useSharedValue(0);

  /**
   * Every shelf row as it sits on screen right now, in the gesture view's
   * space. Layout events only ever report a position relative to the direct
   * parent, so the whole chain is summed — area, the well inside it, the
   * board inside that, and the scrolling strip inside that. Dropping any link
   * silently lands the bin on the wrong shelf.
   */
  const measureRows = useCallback((): RowMeasurement[] => {
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
  }, [areas]);

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
      return geo ? hitTest(geo, { x: point.x, y: point.y }, scrollY.current) : null;
    },
    [wallHit],
  );

  const endDragCleanup = useCallback(() => {
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
      const { x, y } = point;
      const rows = measureRows();
      const binId = binAt(rows, { x, y });
      if (!binId) return;

      lift(binId);
      const card = rows.flatMap((r) => r.cards).find((c) => c.binId === binId);
      const band = rows.find((r) => r.cards.some((c) => c.binId === binId));
      const cardX = card?.x ?? x;
      const cardY = band?.top ?? y;

      geometry.current = freezeGeometry(rows, scrollY.current, binId);
      origin.current = { x: cardX, y: cardY };
      pointer.current = point;
      draggingRef.current = binId;
      slotRef.current = null;

      grabX.value = x - cardX;
      grabY.value = y - cardY;
      ghostX.value = cardX;
      ghostY.value = cardY;
      ghostOpacity.value = 1;
      // The lift-pop: the card jumps a little as it leaves the shelf.
      ghostScale.value = withTiming(1.05, { duration: 160 });
      dragLive.value = 1;

      setDragging(binId);
      setUndo(null);

      // A finger held still at the edge still needs the map to travel, so the
      // scroll runs on a clock rather than on move events.
      if (autoScroll.current) clearInterval(autoScroll.current);
      autoScroll.current = setInterval(() => {
        const p = pointer.current;
        const box = viewport.current;
        if (!p || !box) return;
        const step = autoScrollStep(p.y, { top: 0, bottom: box.height });
        if (step === 0) return;
        const next = Math.max(0, scrollY.current + step);
        scrollRef.current?.scrollTo({ y: next, animated: false });
        slotRef.current = resolveSlot(p);
        setSlot(slotRef.current);
      }, 16);
    },
    [
      dragLive,
      ghostOpacity,
      ghostScale,
      ghostX,
      ghostY,
      grabX,
      grabY,
      lift,
      measureRows,
      resolveSlot,
    ],
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
      ghostScale.value = withTiming(1, { duration: 200 });
      if (home) {
        ghostX.value = withTiming(home.x, { duration: 200 });
        ghostY.value = withTiming(home.y, { duration: 200 });
      }
      ghostOpacity.value = withTiming(0, { duration: 200 });
      endDragCleanup();
      hold(null);
      return;
    }

    ghostOpacity.value = 0;
    ghostScale.value = 1;
    endDragCleanup();
    executeDrop(
      binId,
      target.viaWall
        ? { shelfId: target.shelfId }
        : { shelfId: target.shelfId, index: target.index },
    );
  }, [endDragCleanup, executeDrop, ghostOpacity, ghostScale, ghostX, ghostY, hold]);

  /**
   * One detector for the whole map. It activates only after a hold, so it
   * never races the vertical map scroll or a row's own sideways scroll, and
   * a hold that never moves is simply today's lift.
   */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(prefs.dragEnabled)
        .maxPointers(1)
        .activateAfterLongPress(HOLD_MS)
        .onStart((e) => {
          runOnJS(beginDrag)({ x: e.x, y: e.y, absX: e.absoluteX, absY: e.absoluteY });
        })
        .onUpdate((e) => {
          if (dragLive.value === 0) return;
          ghostX.value = e.x - grabX.value;
          ghostY.value = e.y - grabY.value;
          runOnJS(trackDrag)({ x: e.x, y: e.y, absX: e.absoluteX, absY: e.absoluteY });
        })
        // Unconditional on purpose. A gesture that ends before `beginDrag`
        // has run on the JS thread would otherwise leave a bin in the air
        // with nothing left to put it down; `finishDrag` no-ops when there is
        // nothing in hand, and runOnJS preserves the order of the two calls.
        .onFinalize(() => {
          runOnJS(finishDrag)();
        }),
    [beginDrag, dragLive, finishDrag, ghostX, ghostY, grabX, grabY, prefs.dragEnabled, trackDrag],
  );

  // -------------------------------------------------------------- editing
  const addBinToShelf = (shelfId: string) => {
    const code = nextShortCode(db);
    createBin(db, { name: `Bin ${code}`, shortCode: code, shelfId });
    bump();
  };

  const openShelfSheet = (row: MapRow, locationName: string) => {
    if (!row.shelfId) return;
    setSheet({
      shelfId: row.shelfId,
      locationName,
      name: row.name,
      capacity: row.capacity,
      binCount: row.bins.length,
    });
  };

  const total = mapSize(areas);
  if (total === 0) {
    return (
      <ScrollView contentContainerStyle={styles.center}>
        <Text style={styles.dim}>
          Nothing to draw yet. Once you have a bin or two, this shows them laid out by shelf.
        </Text>
      </ScrollView>
    );
  }

  const dragged = dragging ? (locateMany(areas, [dragging])[0]?.cell ?? null) : null;
  const targetRow = slot ? findRow(areas, slot.shelfId) : null;

  return (
    <View style={styles.screen}>
      {searchOpen ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setFocusIndex(0);
              scrolledOnce.current = false;
            }}
            placeholder="Find a bin on the shelves"
            placeholderTextColor={colors.textFaint}
            autoFocus
            accessibilityLabel="Find a bin on the shelves"
            testID="map-search-input"
          />
          <Pressable
            onPress={() => {
              setSearchOpen(false);
              setQuery('');
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close the search"
            testID="map-search-close"
          >
            <Ionicons name="close" size={16} color={colors.textFaint} />
          </Pressable>
        </View>
      ) : null}

      <Banner
        dragged={dragged}
        targetName={targetRow ? describeRow(areas, targetRow) : null}
        targetSlot={slot && !slot.viaWall ? slot.index + 1 : null}
        viaWall={slot?.viaWall ?? false}
        held={held !== null && dragging === null}
        heldLabel={heldFind ? `Moving ${heldFind.cell.code} · ${heldFind.cell.name}` : ''}
        onCancelHold={() => hold(null)}
        focused={
          focused
            ? { code: focused.cell.code, name: focused.cell.name, where: describePlace(focused) }
            : null
        }
        findCount={finds.length}
        findIndex={focusIndex}
        onStepFocus={stepFocus}
        searching={searchOpen && query.trim().length > 0}
        query={query.trim()}
        wantedButMissing={highlightIds.length > 0 && finds.length === 0}
        summary={summarize(areas, total, held !== null || dragging !== null)}
      />

      {/*
        The map's own toolbar. These stay in the screen rather than in the
        navigator's header: they reflect screen state, and pushing state up
        into `navigation.setOptions` puts the controls somewhere the screen
        cannot see — including from a test.
      */}
      <View style={styles.toolbar}>
        <Text style={styles.heatLabel}>Tint</Text>
        {(
          [
            ['none', 'none'],
            ['items', 'items'],
            ['scanned', 'last scan'],
          ] as const
        ).map(([mode, label]) => (
          <Pressable
            key={mode}
            style={[styles.heatChip, heat === mode && styles.heatChipOn]}
            onPress={() => setHeat(mode)}
            accessibilityRole="button"
            accessibilityLabel={`Tint cells by ${label}`}
            testID={`map-heat-${mode}`}
          >
            <Text style={[styles.heatChipText, heat === mode && styles.heatChipTextOn]}>
              {label}
            </Text>
          </Pressable>
        ))}
        <View style={styles.toolbarSpacer} />
        <Pressable
          onPress={() => {
            setSearchOpen((open) => !open);
            setQuery('');
            setFocusIndex(0);
            hold(null);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Search the shelves"
          testID="map-search-toggle"
        >
          <Ionicons
            name={searchOpen ? 'search' : 'search-outline'}
            size={19}
            color={searchOpen ? colors.amber : colors.textDim}
          />
        </Pressable>
        <Pressable
          onPress={() => setWallOpen((open) => !open)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Show the whole wall"
          testID="map-wall-toggle"
        >
          <Ionicons
            name={wallOpen ? 'grid' : 'grid-outline'}
            size={19}
            color={wallOpen ? colors.amber : colors.textDim}
          />
        </Pressable>
      </View>
      {heat !== 'none' ? (
        <Text style={styles.legend}>
          {heat === 'items'
            ? 'Brighter amber = more items in the bin.'
            : 'Darker = longer since the bin was scanned; red = never scanned.'}
        </Text>
      ) : null}

      {wallOpen ? (
        <WallStrip
          areas={areas}
          matchedBinIds={wantedIds}
          draggingBinId={dragging}
          targetShelfId={slot?.viaWall ? slot.shelfId : undefined}
          onJump={jumpToShelf}
          onShelfFrame={(shelfId, frame) => {
            wallFrames.current[shelfId ?? 'unshelved'] = frame;
          }}
        />
      ) : null}

      <GestureDetector gesture={pan}>
        <View
          style={styles.mapArea}
          onLayout={(e) => {
            viewport.current = e.nativeEvent.layout;
          }}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.container}
            scrollEnabled={dragging === null}
            scrollEventThrottle={16}
            onScroll={(e) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
            }}
          >
            {areas.map((area, index) => {
              const areaKey = areaKeyOf(index, area.locationId);
              return (
                <View
                  key={areaKey}
                  style={styles.area}
                  onLayout={(e) => {
                    areaFrames.current[areaKey] = e.nativeEvent.layout;
                  }}
                >
                  <View style={styles.areaHead}>
                    <Text style={styles.areaName}>{area.name}</Text>
                  </View>

                  {/* The well the boards are recessed into, with an upright at each end.
                      Measured because a board's layout is reported relative to
                      it, not to the area — the drag sums the whole chain. */}
                  <View
                    style={styles.well}
                    onLayout={(e) => {
                      wellFrames.current[areaKey] = e.nativeEvent.layout;
                    }}
                  >
                    <View pointerEvents="none" style={[styles.upright, styles.uprightLeft]} />
                    <View pointerEvents="none" style={[styles.upright, styles.uprightRight]} />
                    {area.rows.map((row) => {
                      const key = rowKey(row);
                      const isTarget =
                        slot !== null && !slot.viaWall && slot.shelfId === row.shelfId;
                      return (
                        <ShelfBoard
                          key={key}
                          row={row}
                          lit={isTarget}
                          landingIndex={isTarget ? slot.index : null}
                          draggingBinId={dragging}
                          heldBinId={held}
                          matchedBinIds={wantedIds}
                          focusedBinId={focused?.cell.binId ?? null}
                          settlingBinId={settling}
                          showTicks={prefs.showTicks}
                          heatFor={(cell) => tint(heatTier(cell, heat, nowIso), heat)}
                          onCellPress={(cell) => onCellPress(cell, row)}
                          onCellLongPress={(cell) => lift(cell.binId)}
                          onDropAtEnd={() => {
                            const inHand = heldRef.current;
                            if (inHand) executeDrop(inHand, { shelfId: row.shelfId });
                          }}
                          onEditShelf={row.shelfId ? () => openShelfSheet(row, area.name) : null}
                          onAddBin={row.shelfId ? () => addBinToShelf(row.shelfId!) : null}
                          onLayout={(e) => {
                            boardFrames.current[key] = e.nativeEvent.layout;
                          }}
                          onRowLayout={(e) => {
                            stripFrames.current[key] = e.nativeEvent.layout;
                          }}
                          onRowScroll={(e) => {
                            stripScrollX.current[key] = e.nativeEvent.contentOffset.x;
                          }}
                        />
                      );
                    })}
                  </View>
                </View>
              );
            })}

            <Text style={styles.foot}>
              {total} bin{total === 1 ? '' : 's'} drawn, laid out the way they are filed.
              {held || dragging
                ? ''
                : prefs.dragEnabled
                  ? ' Hold a bin and drag it, or hold and tap where it goes.'
                  : ' Hold a bin to lift it, then tap where it goes.'}
            </Text>
          </ScrollView>

          {dragged ? (
            <DragGhost
              cell={dragged}
              x={ghostX}
              y={ghostY}
              scale={ghostScale}
              opacity={ghostOpacity}
            />
          ) : null}
        </View>
      </GestureDetector>

      {undo && (
        <View style={styles.snackbar} testID="map-undo-snackbar">
          <Text style={styles.snackbarText} numberOfLines={1}>
            {undo.label}
          </Text>
          <Pressable
            onPress={() => {
              undo.revert();
              if (undoTimer.current) clearTimeout(undoTimer.current);
              setUndo(null);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Undo the move"
            testID="map-undo"
          >
            <Text style={styles.snackbarUndo}>UNDO</Text>
          </Pressable>
        </View>
      )}

      <ShelfSheet
        shelf={sheet}
        onRename={(name) => {
          if (!sheet) return;
          renameShelf(db, sheet.shelfId, name);
          setSheet({ ...sheet, name });
          bump();
        }}
        onCapacity={(capacity) => {
          if (!sheet) return;
          setShelfCapacity(db, sheet.shelfId, capacity);
          setSheet({ ...sheet, capacity });
          bump();
        }}
        onAddBin={() => {
          if (!sheet) return;
          addBinToShelf(sheet.shelfId);
          setSheet({ ...sheet, binCount: sheet.binCount + 1 });
        }}
        onDelete={() => {
          if (!sheet) return;
          const target = sheet;
          const before = areas.flatMap((a) => a.rows).find((r) => r.shelfId === target.shelfId);
          const orphaned = before ? before.bins.map((c) => c.binId) : [];
          deleteShelf(db, target.shelfId);
          logEvent(db, {
            kind: 'organize',
            name: 'shelf_deleted',
            detail: { shelf: target.name, bins: orphaned.length },
          });
          setSheet(null);
          bump();
          offerUndo(
            orphaned.length > 0
              ? `${target.name} removed — its bins are in the tray`
              : `${target.name} removed`,
            () => {
              // Deliberately not offered: recreating a shelf would mint a new
              // id, and every bin that pointed at the old one would be lying.
            },
          );
        }}
        onClose={() => setSheet(null)}
      />

      <MoveConfirmSheet
        request={confirm}
        onConfirm={() => confirm?.commit()}
        onCancel={() => {
          setConfirm(null);
          hold(null);
        }}
      />
    </View>
  );
}

/**
 * The banner above the shelves: one line that always says what the map is
 * doing. Idle it names the workshop, holding it names the bin in your hand,
 * dragging it names the exact slot, searching it walks the matches.
 */
function Banner({
  dragged,
  targetName,
  targetSlot,
  viaWall,
  held,
  heldLabel,
  onCancelHold,
  focused,
  findCount,
  findIndex,
  onStepFocus,
  searching,
  query,
  wantedButMissing,
  summary,
}: {
  dragged: MapCell | null;
  targetName: string | null;
  targetSlot: number | null;
  viaWall: boolean;
  held: boolean;
  heldLabel: string;
  onCancelHold: () => void;
  focused: { code: string; name: string; where: string } | null;
  findCount: number;
  findIndex: number;
  onStepFocus: () => void;
  searching: boolean;
  query: string;
  wantedButMissing: boolean;
  summary: string;
}) {
  if (dragged) {
    return (
      <View style={[styles.banner, styles.bannerActive]} testID="map-banner-drag">
        <Ionicons name="move" size={18} color={colors.amber} />
        <View style={styles.bannerText}>
          <Text style={styles.bannerName} numberOfLines={1}>
            Moving {dragged.code} · {dragged.name}
          </Text>
          <Text style={styles.bannerWhere} numberOfLines={2}>
            {targetName === null
              ? 'Release away from a shelf to cancel'
              : viaWall
                ? `Drop on the wall strip → end of ${targetName}`
                : `Lands in ${targetName}, slot ${targetSlot}`}
          </Text>
        </View>
      </View>
    );
  }

  if (held) {
    return (
      <View style={[styles.banner, styles.bannerActive]}>
        <Ionicons name="move" size={18} color={colors.amber} />
        <View style={styles.bannerText}>
          <Text style={styles.bannerName} numberOfLines={1}>
            {heldLabel}
          </Text>
          <Text style={styles.bannerWhere} numberOfLines={2}>
            Tap a bin to slide in front of it, or a slot to drop there.
          </Text>
        </View>
        <Pressable
          onPress={onCancelHold}
          accessibilityRole="button"
          accessibilityLabel="Cancel the move"
          hitSlop={8}
          testID="map-cancel-move"
        >
          <Ionicons name="close-circle" size={22} color={colors.textDim} />
        </Pressable>
      </View>
    );
  }

  if (focused) {
    return (
      <View style={styles.banner}>
        <Ionicons name="locate" size={18} color={colors.amber} />
        <View style={styles.bannerText}>
          <Text style={styles.bannerName} numberOfLines={1}>
            {focused.code} · {focused.name}
          </Text>
          <Text style={styles.bannerWhere} numberOfLines={1}>
            {focused.where}
          </Text>
        </View>
        {findCount > 1 ? (
          <Pressable
            style={styles.nextButton}
            onPress={onStepFocus}
            accessibilityRole="button"
            accessibilityLabel={`Match ${findIndex + 1} of ${findCount}. Show the next one`}
            testID="map-next-match"
          >
            <Text style={styles.nextCount}>
              {findIndex + 1}/{findCount}
            </Text>
            <Ionicons name="chevron-forward-circle" size={20} color={colors.amber} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (searching) {
    return (
      <View style={styles.bannerQuiet} testID="map-banner-nohits">
        <Ionicons name="search-outline" size={18} color={colors.textFaint} />
        <Text style={styles.bannerWhere}>Nothing on the shelves matches “{query}”.</Text>
      </View>
    );
  }

  if (wantedButMissing) {
    return (
      <View style={styles.banner}>
        <Ionicons name="help-circle-outline" size={18} color={colors.textDim} />
        <Text style={styles.bannerWhere}>That bin is not on the map.</Text>
      </View>
    );
  }

  return (
    <View style={styles.bannerQuiet}>
      <Ionicons name="hand-left-outline" size={18} color={colors.textDim} />
      <View style={styles.bannerText}>
        <Text style={styles.bannerSummary} numberOfLines={1}>
          {summary}
        </Text>
        <Text style={styles.bannerWhere} numberOfLines={1}>
          Drag a bin to rearrange. The map is the arrangement.
        </Text>
      </View>
    </View>
  );
}

/** Cell background per heat tier — a garnish over the cell, never over the
 *  found/held states, which stay the loudest thing on the screen. */
function tint(tier: 0 | 1 | 2 | 3, mode: HeatMode): ViewStyle | null {
  if (tier === 0 || mode === 'none') return null;
  const scale =
    mode === 'items'
      ? ['rgba(255,196,0,0.10)', 'rgba(255,196,0,0.22)', 'rgba(255,196,0,0.38)']
      : ['rgba(255,176,32,0.12)', 'rgba(255,107,94,0.18)', 'rgba(255,107,94,0.32)'];
  return { backgroundColor: scale[tier - 1] };
}

function findRow(areas: readonly { rows: readonly MapRow[] }[], shelfId: string | null) {
  for (const area of areas) {
    const row = area.rows.find((r) => r.shelfId === shelfId);
    if (row) return row;
  }
  return null;
}

function describeRow(
  areas: readonly { name: string; rows: readonly MapRow[] }[],
  row: MapRow,
): string {
  const area = areas.find((a) => a.rows.includes(row));
  return area ? `${area.name} › ${row.name}` : row.name;
}

function summarize(
  areas: readonly { name: string; rows: readonly MapRow[] }[],
  total: number,
  busy: boolean,
): string {
  const places = areas.map((a) => a.name).join(', ');
  const shelves = areas.reduce((n, a) => n + a.rows.filter((r) => r.shelfId).length, 0);
  return busy ? `${total} bins` : `${places} — ${shelves} shelf${shelves === 1 ? '' : 'ves'}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  mapArea: { flex: 1 },
  container: { paddingBottom: sp(12), gap: sp(2), flexGrow: 1 },
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: sp(6),
    gap: sp(3),
    backgroundColor: colors.bg,
  },
  dim: { ...type.dim, textAlign: 'center', lineHeight: 20 },
  crashTitle: { ...type.h2, textAlign: 'center' },
  crashMessage: { color: colors.danger, fontFamily: mono, fontSize: 13, lineHeight: 18 },
  crashStack: { color: colors.textFaint, fontFamily: mono, fontSize: 10, lineHeight: 14 },
  crashRetry: {
    alignSelf: 'center',
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    paddingHorizontal: sp(5),
    paddingVertical: sp(2.5),
  },
  crashRetryText: { color: colors.amberInkOn, fontWeight: '800' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.25),
    marginHorizontal: sp(4),
    marginBottom: sp(2.5),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2.25),
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 13.5, padding: 0 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    marginHorizontal: sp(4),
    marginBottom: sp(2.5),
    backgroundColor: colors.chipSelectedBg,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    borderRadius: radius.md,
    padding: sp(3),
    minHeight: 54,
  },
  bannerActive: { borderStyle: 'dashed' },
  bannerQuiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    marginHorizontal: sp(4),
    marginBottom: sp(2.5),
    backgroundColor: '#1A1D20',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: sp(3),
    minHeight: 54,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerName: { color: colors.amber, fontFamily: mono, fontSize: 13 },
  bannerSummary: { color: colors.text, fontFamily: mono, fontSize: 13 },
  bannerWhere: { color: colors.textDim, fontSize: 11.5, lineHeight: 15 },
  nextButton: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  nextCount: { color: colors.amber, fontFamily: mono, fontSize: 12 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
    paddingHorizontal: sp(4),
    paddingBottom: sp(2),
  },
  toolbarSpacer: { flex: 1 },
  heatLabel: { ...type.stamp },
  heatChip: {
    paddingHorizontal: sp(2.75),
    paddingVertical: sp(1.25),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.chipBg,
  },
  heatChipOn: { backgroundColor: colors.chipSelectedBg, borderColor: colors.chipSelectedBorder },
  heatChipText: { color: colors.textDim, fontSize: 12 },
  heatChipTextOn: { color: colors.amber },
  legend: { color: colors.textFaint, fontSize: 11, paddingHorizontal: sp(4), paddingBottom: sp(2) },
  area: { paddingHorizontal: sp(3), paddingBottom: sp(2), gap: sp(1) },
  areaHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp(1),
    paddingVertical: sp(1.5),
  },
  areaName: { ...type.stamp },
  well: {
    borderRadius: radius.md,
    backgroundColor: shelfTheme.well,
    borderWidth: 1,
    borderColor: shelfTheme.wellBorder,
    paddingTop: sp(3),
    paddingBottom: sp(2.5),
    paddingHorizontal: 15,
  },
  upright: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    width: 6,
    borderRadius: 3,
    backgroundColor: shelfTheme.upright,
  },
  uprightLeft: { left: 5 },
  uprightRight: { right: 5 },
  foot: {
    ...type.dim,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: sp(4.5),
    paddingTop: sp(1),
  },
  snackbar: {
    position: 'absolute',
    left: sp(3),
    right: sp(3),
    bottom: sp(4),
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingHorizontal: sp(4),
    paddingVertical: sp(3),
  },
  snackbarText: { ...type.dim, flex: 1 },
  snackbarUndo: { color: colors.amber, fontWeight: '800', letterSpacing: 1 },
});
