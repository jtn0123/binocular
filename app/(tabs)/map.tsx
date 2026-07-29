import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { ScreenTop } from '@/components/ScreenHeader';
import { DragGhost } from '@/components/map/DragGhost';
import { PEGBOARD_TILE } from '@/components/map/pegboard';
import { HitsBar, type RackHit } from '@/components/map/HitsBar';
import { MapCarryBar, MapFindBar } from '@/components/map/MapBanner';
import { MapSettingsSheet } from '@/components/map/MapSettingsSheet';
import { MapToolbar, MAX_COLUMNS, MAX_ROWS } from '@/components/map/MapToolbar';
import { MoveConfirmSheet } from '@/components/map/MoveConfirmSheet';
import { RackHeader } from '@/components/map/RackHeader';
import { RackPickSheet, type RackPickRequest } from '@/components/map/RackPickSheet';
import { RackRail } from '@/components/map/RackRail';
import { RackScrubber, type RackSegment } from '@/components/map/RackScrubber';
import { ShelfBoard } from '@/components/map/ShelfBoard';
import { ShelfSheet, shelfDraft, type ShelfDraft } from '@/components/map/ShelfSheet';
import { UnshelvedTray } from '@/components/map/UnshelvedTray';
import { WallSheet } from '@/components/map/WallSheet';
import { useDb } from '@/db/DbProvider';
import {
  areaFill,
  buildMap,
  describePlace,
  heatTier,
  locateMany,
  mapSize,
  openRowOf,
  overflowTarget,
  rackCodeOf,
  rackLabelOf,
  rackRoom,
  withTray,
  type HeatMode,
  type MapArea,
  type MapCell,
  type MapRow,
} from '@/db/mapView';
import {
  deleteShelf,
  itemCountsByBin,
  listBins,
  listLocations,
  listShelves,
  renameShelf,
  setShelfCapacity,
} from '@/db/queries';
import { logEvent } from '@/diagnostics/events';
import { useFocusTick } from '@/lib/useFocusTick';
import {
  describeRow,
  findRow,
  heldHint,
  heldLabel,
  sendHint,
  tint,
} from '@/map/mapPresentation';
import { DEFAULT_MAP_VIEW, loadMapView, saveMapView } from '@/map/mapViewState';
import { useMapDrag, type RackEdge } from '@/map/useMapDrag';
import { useMapFrames } from '@/map/useMapFrames';
import { useRackSwipe } from '@/map/useRackSwipe';
import { useRackEdit } from '@/map/useRackEdit';
import { useShelfMoves } from '@/map/useShelfMoves';
import {
  DEFAULT_MAP_PREFS,
  loadMapPrefs,
  saveMapPrefs,
  type MapPrefs,
} from '@/settings/mapPrefs';
import { colors, shelf as shelfTheme, sp, type } from '@/theme';

/**
 * The workshop map (blueprint D21, amended) — the v3 wall.
 *
 * A schematic drawn from the hierarchy that already exists, and the place the
 * wall is arranged: a location is a **rack**, its shelves are the boards, its
 * bins stand on them. Nothing is stored that could drift from where a bin is
 * really filed — moving one writes the same `shelf_id` every breadcrumb reads.
 *
 * ## Why one rack at a time
 *
 * The previous version scrolled every location in one column, which is a
 * truthful picture of a *list* and a poor picture of a *room*. A real
 * workshop is a run of shelving you walk along, so the map pages: one rack
 * fills the screen, the scrubber along the bottom is the wall, and the side
 * rails are the way to the next one — including with a bin in your hand,
 * which is the move you make when you decide something lives at the far end
 * of the garage.
 *
 * ## The gesture layer, and why it is back
 *
 * A finger-following drag was built here once, shipped to the field phone and
 * withdrawn the same day: it wrapped *every cell* in its own gesture-handler
 * detector driving reanimated worklets, and the process died natively — an
 * `app_start` seconds after every `screen//map` with no `app_background`
 * between them (docs/PLAN.md, "Map customization › Withdrawn").
 *
 * `useMapDrag` is the opposite shape — one detector and one animated node for
 * the whole map — and it rides on top of lift-and-place rather than replacing
 * it, so a hold that never moves is exactly today's lift and every tap path
 * is untouched. It is still not proven on the field phone, so it has an off
 * switch (Settings › Map › Drag bins to rearrange). If the map ever closes
 * itself again, that switch is the first thing to try. Paging is deliberately
 * *not* a second gesture on the same surface for the same reason: the rails,
 * the scrubber and the whole-wall sheet all page, and none of them is a pan.
 *
 * `highlight` may carry several comma-separated bin ids: a search that
 * matched items in four bins lights all four, and the banner walks them.
 */
export { MapErrorBoundary as ErrorBoundary } from '@/components/map/MapErrorBoundary';

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
    // One grouped count rather than one query per bin: this memo re-runs on
    // every mutation and every screen focus, and a real wall is a few hundred
    // bins. Bins with no items are absent from the map, hence the `?? 0`.
    const counted = itemCountsByBin(db);
    const itemCounts = new Map(bins.map((b) => [b.id, counted.get(b.id) ?? 0]));
    // The tray is fixed chrome on this screen, so it has to exist as a real
    // row even when it is empty — otherwise it is drawn but cannot be dropped
    // into, which is worse than not drawing it.
    return withTray(buildMap({ locations, shelves, bins, itemCounts }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, tick]);

  const racks = useMemo(() => areas.filter((area) => area.locationId !== null), [areas]);
  const trayRow: MapRow = areas.find((a) => a.locationId === null)?.rows[0] ?? {
    shelfId: null,
    name: 'Not on a shelf',
    bins: [],
    capacity: null,
  };

  const [prefs, setPrefs] = useState<MapPrefs>(DEFAULT_MAP_PREFS);
  const [prefsOpen, setPrefsOpen] = useState(false);
  useEffect(() => {
    void loadMapPrefs().then(setPrefs);
  }, []);

  const changePref = useCallback(<K extends keyof MapPrefs>(key: K, value: MapPrefs[K]) => {
    setPrefs((current) => {
      const next = { ...current, [key]: value };
      void saveMapPrefs(next);
      return next;
    });
  }, []);

  // ------------------------------------------------------------- the wall
  const [rackIndex, setRackIndex] = useState(DEFAULT_MAP_VIEW.rackIndex);
  const [heat, setHeat] = useState<HeatMode>(DEFAULT_MAP_VIEW.heat);
  const [trayOpen, setTrayOpen] = useState(DEFAULT_MAP_VIEW.trayOpen);
  const viewLoaded = useRef(false);

  useEffect(() => {
    void loadMapView().then((view) => {
      setRackIndex(view.rackIndex);
      setHeat(view.heat);
      setTrayOpen(view.trayOpen);
      viewLoaded.current = true;
    });
  }, []);

  // Written back only after the stored view has been read, or the first
  // render would immediately overwrite it with the defaults.
  useEffect(() => {
    if (!viewLoaded.current) return;
    void saveMapView({ rackIndex, heat, trayOpen });
  }, [heat, rackIndex, trayOpen]);

  // Clamped rather than stored-and-trusted: a rack can come off the wall
  // while the stored index still points past the end of it.
  const rackAt = racks.length > 0 ? Math.min(rackIndex, racks.length - 1) : 0;
  const rack: MapArea | null = racks[rackAt] ?? null;

  const [editing, setEditing] = useState(false);
  const [wallOpen, setWallOpen] = useState(false);
  const [wallEditing, setWallEditing] = useState(false);

  // ---------------------------------------------------------------- finding
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Recomputed per render on purpose: staleness tints must not fossilize.
  const nowIso = new Date().toISOString();

  const highlightIds = useMemo(
    () => (highlight ? highlight.split(',').filter(Boolean) : []),
    [highlight],
  );

  /**
   * Typing on the map searches the *bins* drawn on it — name and short code,
   * across the whole wall rather than the rack in front of you. Item-level
   * search is Home's job and arrives here as `highlight`, which wins: it is a
   * specific answer to a specific question.
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
  // Clamped once and used everywhere: a new `highlight` can shrink the match
  // set without resetting the step counter, and the banner read "3/2".
  const focusAt = finds.length > 0 ? Math.min(focusIndex, finds.length - 1) : 0;
  const focused = finds.length > 0 ? finds[focusAt] : null;

  /** Matches per rack, so a rack with none can still say where they are. */
  const rackHits = useMemo(
    () =>
      racks.map((area, index) => ({
        index,
        code: rackCodeOf(area.name, index),
        count: area.rows.reduce(
          (n, row) => n + row.bins.filter((c) => wantedIds.includes(c.binId)).length,
          0,
        ),
      })),
    [racks, wantedIds],
  );
  const hitsElsewhere: RackHit[] = rackHits.filter((h) => h.index !== rackAt && h.count > 0);

  // ------------------------------------------------------- layout and moves
  const frames = useMapFrames();
  const scrolledOnce = useRef(false);
  const moves = useShelfMoves({ db, areas, onChange: bump });
  const [sheet, setSheet] = useState<ShelfDraft | null>(null);
  const edit = useRackEdit({
    db,
    onChange: bump,
    notify: moves.notify,
    // Bins that just lost their shelf must be visible where they landed, or
    // removing a rack reads as deleting its contents (§11).
    onSpill: () => setTrayOpen(true),
  });

  // A stack picked for a group move. `picking` is the mode; `carried` is what
  // is actually in hand once "Move them" has been pressed — kept apart so the
  // second tap on a bin reads as "also this one" and not "put it here".
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [carried, setCarried] = useState<string[]>([]);
  const carriedRef = useRef<string[]>([]);
  const setCarriedBoth = useCallback((ids: string[]) => {
    carriedRef.current = ids;
    setCarried(ids);
  }, []);

  const [rackPick, setRackPick] = useState<(RackPickRequest & { binIds: string[] }) | null>(null);

  /**
   * The bin the *gesture* just lifted, if any.
   *
   * Releasing a hold fires the pan's finalize AND the underlying Pressable's
   * `onPress`, and a press on the bin in your hand means "put it back down" —
   * so a hold-to-lift used to undo itself the instant you let go, silently
   * removing lift-and-place whenever the drag was on. The first press after a
   * lift belongs to that lift and is swallowed; every later one is a real tap.
   */
  const justLifted = useRef<string | null>(null);

  /**
   * Pages the wall, resetting anything that only made sense on the old rack.
   *
   * Deliberately not clamped against `racks.length` here: adding a rack pages
   * to it in the same tick, when `racks` is still the list from before the
   * write and the clamp would send you back to where you started. `rackAt`
   * clamps on render instead, against a list that is actually current.
   */
  const goToRack = useCallback(
    (index: number) => {
      setRackIndex(Math.max(0, index));
      setWallOpen(false);
      scrolledOnce.current = false;
      frames.scrollTo(0);
    },
    [frames],
  );

  /** Puts a bin — or a stack — down at the end of a shelf. */
  const dropOnShelf = useCallback(
    (binIds: readonly string[], shelfId: string | null, settled = false) => {
      justLifted.current = null;
      if (binIds.length > 1) moves.executeMultiDrop(binIds, { shelfId });
      else if (binIds.length === 1) moves.executeDrop(binIds[0], { shelfId }, { settled });
      setCarriedBoth([]);
    },
    [moves, setCarriedBoth],
  );

  /**
   * Off this rack and on to another (v3). One rack that way is unambiguous
   * and just goes — the re-home confirm still asks. Two or more and the
   * direction alone cannot say which, so it asks rather than guessing.
   */
  const sendToRack = useCallback(
    (edge: RackEdge, binIds: readonly string[]) => {
      const pool =
        edge === 'prev'
          ? racks.map((area, index) => ({ index, area })).slice(0, rackAt).reverse()
          : racks.map((area, index) => ({ index, area })).slice(rackAt + 1);
      if (pool.length === 0 || binIds.length === 0) {
        moves.cancelHold();
        setCarriedBoth([]);
        return;
      }
      if (pool.length === 1) {
        const row = openRowOf(pool[0].area) ?? pool[0].area.rows[0] ?? null;
        if (row?.shelfId) {
          dropOnShelf(binIds, row.shelfId);
          goToRack(pool[0].index);
          return;
        }
      }
      const first = locateMany(areas, [binIds[0]])[0] ?? null;
      moves.cancelHold();
      setRackPick({
        binIds: [...binIds],
        which: `${edge === 'prev' ? 'Racks left of' : 'Racks right of'} ${rackCodeOf(
          racks[rackAt].name,
          rackAt,
        )}`,
        code: binIds.length > 1 ? String(binIds.length) : (first?.cell.code ?? ''),
        name: binIds.length > 1 ? 'bins, moving together' : (first?.cell.name ?? ''),
        candidates: pool,
      });
    },
    [areas, dropOnShelf, goToRack, moves, rackAt, racks, setCarriedBoth, setRackPick],
  );

  /**
   * What the drag is allowed to hit: the rack on screen and the tray, never
   * the whole wall. Board frames live in refs keyed by shelf id and outlive
   * the rack that reported them, so measuring every area would let a drop on
   * rack 2 land against rack 1's last known layout.
   */
  const visibleAreas = useMemo(
    () => areas.filter((area) => area === rack || area.locationId === null),
    [areas, rack],
  );

  const drag = useMapDrag({
    areas: visibleAreas,
    enabled: prefs.dragEnabled && !picking,
    frames,
    onLift: (binId) => {
      moves.lift(binId);
      setCarriedBoth([binId]);
      justLifted.current = binId;
    },
    onDrop: (binId, target) => {
      justLifted.current = null;
      const stack = carriedRef.current;
      if (stack.length > 1 && stack.includes(binId)) moves.executeMultiDrop(stack, target);
      else moves.executeDrop(binId, target);
      setCarriedBoth([]);
    },
    onEdgeDrop: (binId, edge) => {
      const stack = carriedRef.current;
      sendToRack(edge, stack.length > 1 && stack.includes(binId) ? stack : [binId]);
    },
    // Stable identities only: `useMapDrag` memoizes the pan on these, and an
    // inline arrow would rebuild the gesture on every render — including the
    // many renders a drag itself produces.
    onCancel: moves.cancelHold,
    onDragStart: moves.clearUndo,
  });

  const { dragging, slot, edge } = drag;
  const busyWithBin = moves.held !== null || dragging !== null;

  const page = useCallback(
    (direction: -1 | 1) => goToRack(rackAt + direction),
    [goToRack, rackAt],
  );
  const swipe = useRackSwipe({
    // Off while carrying: with a bin in hand the rails are how you travel,
    // and a sideways drag towards one would be the same motion as a swipe.
    enabled: !busyWithBin && !picking && racks.length > 1,
    canPrev: rackAt > 0,
    canNext: rackAt < racks.length - 1,
    onPage: page,
  });

  /**
   * One detector for the drag, one for the swipe, raced. They are recognised
   * by different evidence — a 400 ms hold that has not moved versus 24pt of
   * travel that has not waited — so the race has a clear winner rather than
   * being a coin toss.
   */
  const gesture = useMemo(() => Gesture.Race(swipe.pan, drag.pan), [drag.pan, swipe.pan]);

  // Pulled out before the worklet: a worklet captures whole base objects, so
  // `swipe.offset.value` would drag `swipe.pan` to the UI thread with it — and
  // a PanGesture is not something that can be copied across.
  const swipeOffset = swipe.offset;
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: swipeOffset.value }] }));
  /** Everything currently being carried, whether that is a stack or one bin. */
  const carriedNow = carried.length > 0 ? carried : moves.held ? [moves.held] : [];

  /**
   * Resting on a rail pages the wall under you with the bin still in hand —
   * the same move as walking sideways along the shelves. Deliberately slower
   * than a glance: a rail crossed on the way to a shelf must not page.
   */
  useEffect(() => {
    if (!edge) return;
    const timer = setTimeout(() => goToRack(rackAt + (edge === 'prev' ? -1 : 1)), 620);
    // Leaving the rail — or paging off it — cancels the next page, so a rail
    // crossed on the way to a shelf never carries the bin somewhere else.
    return () => clearTimeout(timer);
  }, [edge, goToRack, rackAt]);

  // Paging while a bin is in hand swaps every shelf on screen, and the drag's
  // frozen geometry still describes the rack that left. Re-freeze once the
  // new boards have had a frame to report their layout.
  const refreeze = drag.refreeze;
  useEffect(() => {
    if (!dragging) return;
    const timer = setTimeout(refreeze, 160);
    return () => clearTimeout(timer);
  }, [dragging, rackAt, refreeze]);

  // Jump to the match the banner is on, first time only — after that the
  // stepper drives it, and re-jumping on every redraw fights the scroll.
  // Everything happens on the timer rather than in the effect body: the rows
  // need a frame to report their layout before a scroll can land, and paging
  // synchronously here would cascade a render mid-layout.
  useEffect(() => {
    if (!focused || scrolledOnce.current) return;
    const home = racks.findIndex((r) => r.rows.includes(focused.row));
    const areaKey = frames.areaKeyOf(areas.indexOf(focused.area), focused.area.locationId);
    const timer = setTimeout(() => {
      scrolledOnce.current = true;
      if (home >= 0 && home !== rackAt) {
        setRackIndex(home);
        return;
      }
      frames.scrollToRow(areaKey, frames.rowKey(focused.row));
    }, 120);
    return () => clearTimeout(timer);
  }, [areas, focused, frames, rackAt, racks]);

  const stepFocus = useCallback(() => {
    if (finds.length < 2) return;
    const next = (focusIndex + 1) % finds.length;
    setFocusIndex(next);
    const find = finds[next];
    const home = racks.findIndex((r) => r.rows.includes(find.row));
    if (home >= 0 && home !== rackAt) {
      goToRack(home);
      return;
    }
    const areaKey = frames.areaKeyOf(areas.indexOf(find.area), find.area.locationId);
    frames.scrollToRow(areaKey, frames.rowKey(find.row));
  }, [areas, finds, focusIndex, frames, goToRack, rackAt, racks]);

  /**
   * What a tap on a bin means, which depends entirely on what is going on:
   * picking a stack, placing one, or just wanting to see what is in it.
   */
  const onCellPress = useCallback(
    (cell: MapCell, row: MapRow) => {
      // The tail of the gesture that lifted this very bin — not a tap.
      if (justLifted.current === cell.binId) {
        justLifted.current = null;
        return;
      }
      if (picking) {
        setPicked((current) =>
          current.includes(cell.binId)
            ? current.filter((id) => id !== cell.binId)
            : [...current, cell.binId],
        );
        return;
      }
      const inHand = moves.heldNow();
      if (!inHand) {
        router.push({ pathname: '/bin/[id]', params: { id: cell.binId } });
        return;
      }
      const stack = carriedRef.current;
      if (stack.length <= 1 && cell.binId === inHand) {
        moves.hold(null);
        setCarriedBoth([]);
        return;
      }
      justLifted.current = null;
      if (stack.length > 1) {
        moves.executeMultiDrop(stack, { shelfId: row.shelfId, beforeBinId: cell.binId });
      } else {
        moves.executeDrop(inHand, { shelfId: row.shelfId, beforeBinId: cell.binId });
      }
      setCarriedBoth([]);
    },
    [moves, picking, router, setCarriedBoth, setPicked],
  );

  const onDropAtEnd = useCallback(
    (row: MapRow) => {
      const inHand = moves.heldNow();
      if (!inHand) return;
      const stack = carriedRef.current;
      dropOnShelf(stack.length > 1 ? stack : [inHand], row.shelfId);
    },
    [dropOnShelf, moves],
  );

  const total = mapSize(areas);
  if (total === 0 && racks.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.center}>
        <ScreenTop />
        <Text style={styles.dim}>
          Nothing to draw yet. Once you have a bin or two, this shows them laid out by shelf.
        </Text>
      </ScrollView>
    );
  }

  const dragged = dragging ? (locateMany(areas, [dragging])[0]?.cell ?? null) : null;
  const targetRow = slot ? findRow(areas, slot.shelfId) : null;
  const trayLit = slot !== null && slot.shelfId === null;

  // ------------------------------------------------------------ the rails
  const railFor = (side: RackEdge) => {
    const pool = side === 'prev' ? racks.slice(0, rackAt) : racks.slice(rackAt + 1);
    if (pool.length === 0) return null;
    const neighbour = side === 'prev' ? rackAt - 1 : rackAt + 1;
    return {
      code: rackCodeOf(racks[neighbour].name, neighbour),
      label: rackLabelOf(racks[neighbour].name),
      pool: pool.length,
      full: rackRoom(racks[neighbour]) === 0,
    };
  };
  const prevRail = railFor('prev');
  const nextRail = railFor('next');
  const activeRail = edge === 'prev' ? prevRail : edge === 'next' ? nextRail : null;

  const columns = rack
    ? Math.max(1, ...rack.rows.map((row) => row.capacity ?? row.bins.length), 1)
    : DEFAULT_COLUMNS_FALLBACK;

  const segments: RackSegment[] = racks.map((area, index) => {
    const fill = areaFill(area);
    return {
      key: area.locationId ?? String(index),
      code: rackCodeOf(area.name, index),
      label: rackLabelOf(area.name),
      fill: `${fill.filled}/${fill.slots}`,
      ratio: fill.slots > 0 ? fill.filled / fill.slots : 0,
      room: rackRoom(area),
      hits: rackHits[index]?.count ?? 0,
      current: index === rackAt,
    };
  });

  return (
    <View style={styles.screen}>
      {/* The design gives the map no title bar: the panel is a picture of a
          wall, and 54pt of chrome above it is half a shelf. */}
      <ScreenTop />
      {editing && rack ? (
        <RackHeader
          code={rackCodeOf(rack.name, rackAt)}
          label={rackLabelOf(rack.name)}
          fill={`${areaFill(rack).filled}/${areaFill(rack).slots}`}
          onRename={(label) => edit.renameRack(rack, rackAt, label)}
          onOpenSettings={() => setPrefsOpen(true)}
          onDone={() => setEditing(false)}
        />
      ) : null}

      <MapToolbar
        heat={heat}
        onHeat={setHeat}
        searchOpen={searchOpen}
        onToggleSearch={() => {
          setSearchOpen((open) => !open);
          setQuery('');
          setFocusIndex(0);
          moves.hold(null);
          setCarriedBoth([]);
        }}
        query={query}
        onQuery={(text) => {
          setQuery(text);
          setFocusIndex(0);
          scrolledOnce.current = false;
        }}
        editing={editing}
        onToggleEdit={() => setEditing((on) => !on)}
        columns={columns}
        onColumns={(next) => {
          if (!rack) return;
          edit.setColumns(rack, Math.max(1, Math.min(MAX_COLUMNS, next)));
        }}
        canShrinkColumns={columns > 1}
        rows={rack?.rows.length ?? 0}
        onAddRow={() => rack && edit.addShelf(rack, columns)}
        onRemoveRow={() => rack && edit.removeLastShelf(rack)}
        canAddRow={!!rack && rack.rows.length < MAX_ROWS}
        canRemoveRow={
          !!rack && rack.rows.length > 1 && rack.rows.some((row) => row.bins.length === 0)
        }
      />

      <HitsBar
        hereCount={rackHits[rackAt]?.count ?? 0}
        elsewhere={hitsElsewhere}
        onGo={goToRack}
      />

      <MapFindBar
        focused={
          focused
            ? { code: focused.cell.code, name: focused.cell.name, where: describePlace(focused) }
            : null
        }
        findCount={finds.length}
        findIndex={focusAt}
        onStepFocus={stepFocus}
        searching={searchOpen && query.trim().length > 0}
        query={query.trim()}
        wantedButMissing={highlightIds.length > 0 && finds.length === 0}
      />

      <GestureDetector gesture={gesture}>
        <View
          style={styles.mapArea}
          testID="map-viewport"
          onLayout={(e) => frames.setViewport(e.nativeEvent.layout)}
        >
          {rack ? (
            <Animated.View
              key={rack.locationId ?? 'rack'}
              style={[styles.area, panelStyle]}
              testID={`map-area-${frames.areaKeyOf(areas.indexOf(rack), rack.locationId)}`}
              onLayout={(e) =>
                frames.setAreaFrame(
                  frames.areaKeyOf(areas.indexOf(rack), rack.locationId),
                  e.nativeEvent.layout,
                )
              }
            >
              {/*
                The panel *is* the scroller, as in the design: a rack taller
                than the screen scrolls inside its own recess rather than
                taking the page with it, which is what keeps the rails, the
                tray and the scrubber fixed either side of it. Measured
                because a board's layout is reported relative to this, not to
                the area — the drag sums the whole chain.
              */}
              {/* In v3 the well *is* the scroller, so it answers to both
                  handles the drag tests reach for. */}
              <ScrollView
                ref={frames.scrollRef}
                testID="map-scroll"
                style={styles.well}
                contentContainerStyle={styles.wellBody}
                scrollEnabled={dragging === null}
                scrollEventThrottle={16}
                onScroll={(e) => frames.setScrollY(e.nativeEvent.contentOffset.y)}
                onLayout={(e) =>
                  frames.setWellFrame(
                    frames.areaKeyOf(areas.indexOf(rack), rack.locationId),
                    e.nativeEvent.layout,
                  )
                }
              >
                  {/* The pegboard the rack is recessed into — a tiled dot
                      grid, because the panel is a picture of a wall and a
                      flat rectangle reads as a form field. */}
                  <Image
                    source={{ uri: PEGBOARD_TILE }}
                    resizeMode="repeat"
                    style={styles.pegboard}
                  />
                  {rack.rows.map((row) => {
                    const key = frames.rowKey(row);
                    const isTarget = slot !== null && !slot.viaWall && slot.shelfId === row.shelfId;
                    const spill =
                      row.capacity !== null && row.bins.length > row.capacity
                        ? overflowTarget(areas, rack, row)
                        : null;
                    return (
                      <ShelfBoard
                        key={key}
                        row={row}
                        lit={isTarget}
                        landingIndex={isTarget ? slot.index : null}
                        draggingBinId={dragging}
                        heldBinId={moves.held}
                        selectedBinIds={picking ? picked : carried.length > 1 ? carried : []}
                        matchedBinIds={wantedIds}
                        focusedBinId={focused?.cell.binId ?? null}
                        settlingBinId={moves.settling}
                        showTicks={prefs.showTicks}
                        editing={editing}
                        heatFor={(cell) => tint(heatTier(cell, heat, nowIso), heat)}
                        onCellPress={(cell) => onCellPress(cell, row)}
                        onCellLongPress={(cell) => {
                          if (picking) return;
                          moves.lift(cell.binId);
                          setCarriedBoth([cell.binId]);
                        }}
                        onDropAtEnd={() => onDropAtEnd(row)}
                        onEditShelf={row.shelfId ? () => setSheet(shelfDraft(row, rack.name)) : null}
                        onAddBin={row.shelfId ? () => edit.addBin(row.shelfId as string) : null}
                        onRename={
                          row.shelfId
                            ? (name) => edit.renameShelf(row.shelfId as string, name)
                            : null
                        }
                        onWidth={
                          row.shelfId
                            ? (capacity) => edit.setShelfWidth(row.shelfId as string, capacity)
                            : null
                        }
                        onRemove={
                          editing &&
                          row.shelfId &&
                          row.bins.length === 0 &&
                          rack.rows.filter((r) => r.shelfId).length > 1
                            ? () => edit.removeShelf(row.shelfId as string, row.name)
                            : null
                        }
                        overflow={
                          spill
                            ? {
                                label: `move 1 → ${spill.shelfId === null ? 'tray' : spill.name}`,
                                run: () => {
                                  const last = row.bins[row.bins.length - 1];
                                  if (last) {
                                    moves.executeDrop(last.binId, { shelfId: spill.shelfId });
                                  }
                                },
                              }
                            : null
                        }
                        onLayout={(e) => frames.setBoardFrame(key, e.nativeEvent.layout)}
                        onRowLayout={(e) => frames.setStripFrame(key, e.nativeEvent.layout)}
                      />
                    );
                  })}
              </ScrollView>
            </Animated.View>
          ) : (
            <Text style={styles.foot}>
              No racks on the wall yet — Edit, then RACK, puts one up.
            </Text>
          )}

          {/*
            Over the shelves, not above them: picking a bin up must not move
            the row you were aiming at.
          */}
          <MapCarryBar
            dragged={dragged}
            targetName={targetRow ? describeRow(areas, targetRow) : null}
            targetSlot={slot && !slot.viaWall ? slot.index + 1 : null}
            viaWall={slot?.viaWall ?? false}
            edgeHint={activeRail ? sendHint(activeRail) : null}
            held={moves.held !== null && dragging === null}
            heldLabel={heldLabel(areas, moves.held, carried.length)}
            heldHint={heldHint(carried.length, !!prevRail || !!nextRail)}
            onCancelHold={() => {
              justLifted.current = null;
              moves.cancelHold();
              setCarriedBoth([]);
            }}
            onSelectMore={
              moves.held !== null && carried.length <= 1
                ? () => {
                    setPicking(true);
                    setPicked(moves.held ? [moves.held] : []);
                    moves.hold(null);
                    setCarriedBoth([]);
                  }
                : null
            }
            picking={picking}
            pickedCount={picked.length}
            onMovePicked={() => {
              if (picked.length === 0) return;
              setPicking(false);
              moves.lift(picked[0]);
              setCarriedBoth(picked);
              setPicked([]);
            }}
            onClearPicked={() => {
              setPicking(false);
              setPicked([]);
            }}
          />

          {prevRail ? (
            <RackRail
              side="prev"
              code={prevRail.code}
              more={prevRail.pool > 1}
              carrying={busyWithBin}
              hot={edge === 'prev'}
              onPress={() => (busyWithBin ? sendToRack('prev', carriedNow) : goToRack(rackAt - 1))}
              onFrame={(frame) => drag.setEdgeFrame('prev', frame)}
            />
          ) : null}
          {nextRail ? (
            <RackRail
              side="next"
              code={nextRail.code}
              more={nextRail.pool > 1}
              carrying={busyWithBin}
              hot={edge === 'next'}
              onPress={() => (busyWithBin ? sendToRack('next', carriedNow) : goToRack(rackAt + 1))}
              onFrame={(frame) => drag.setEdgeFrame('next', frame)}
            />
          ) : null}

          {dragged ? (
            <DragGhost
              cell={dragged}
              x={drag.ghost.x}
              y={drag.ghost.y}
              scale={drag.ghost.scale}
              opacity={drag.ghost.opacity}
            />
          ) : null}

          {/*
            Anchored to the shelves, not to the screen. At the bottom of the
            screen it sat on top of the tray drawer and the rack scrubber —
            so for the six seconds after every move, the way to the rest of
            the wall was underneath the notice telling you the move happened.
          */}
          {moves.undo && (
            <View style={styles.snackbar} testID="map-undo-snackbar">
              <Text style={styles.snackbarText} numberOfLines={2}>
                {moves.undo.label}
              </Text>
              {moves.undo.revert ? (
                <Pressable
                  onPress={moves.takeUndo}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Undo the move"
                  testID="map-undo"
                >
                  <Text style={styles.snackbarUndo}>UNDO</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </GestureDetector>

      <UnshelvedTray
        row={trayRow}
        open={trayOpen}
        onToggle={() => setTrayOpen((open) => !open)}
        holding={moves.held !== null}
        draggingBinId={dragging}
        heldBinId={moves.held}
        selectedBinIds={picking ? picked : carried.length > 1 ? carried : []}
        matchedBinIds={wantedIds}
        focusedBinId={focused?.cell.binId ?? null}
        settlingBinId={moves.settling}
        lit={trayLit}
        onCellPress={(cell) => onCellPress(cell, trayRow)}
        onCellLongPress={(cell) => {
          if (picking) return;
          moves.lift(cell.binId);
          setCarriedBoth([cell.binId]);
        }}
        onDropAtEnd={() => onDropAtEnd(trayRow)}
        // Registered under the unshelved key so a drag released over the
        // drawer files the bin off the shelves, the same as tapping it down.
        onFrame={(frame) => drag.setWallFrame('unshelved', frame)}
        heatFor={(cell) => tint(heatTier(cell, heat, nowIso), heat)}
      />

      <RackScrubber
        segments={segments}
        editing={editing}
        onGo={goToRack}
        onOpenWall={() => setWallOpen(true)}
        onAddRack={() => goToRack(edit.addRack(columns))}
      />

      {wallOpen ? (
        <WallSheet
          racks={racks}
          currentIndex={rackAt}
          matchedBinIds={wantedIds}
          editing={wallEditing}
          onToggleEdit={() => setWallEditing((on) => !on)}
          onClose={() => {
            setWallOpen(false);
            setWallEditing(false);
          }}
          onGo={goToRack}
          onMove={(index, direction) => edit.moveRack(racks, index, direction)}
          onRename={(index, label) => edit.renameRack(racks[index], index, label)}
          onRemove={(index) => edit.removeRack(racks, index)}
          // Pages to it, as the scrubber's button does: the same errand from
          // two places should not have two outcomes.
          onAddRack={() => goToRack(edit.addRack(columns))}
          trayLabel={`Not on a shelf · ${trayRow.bins.length} bin${
            trayRow.bins.length === 1 ? '' : 's'
          }`}
        />
      ) : null}

      <RackPickSheet
        request={rackPick}
        onPick={(index, shelfId) => {
          const ids = rackPick?.binIds ?? [];
          setRackPick(null);
          // The picker named the rack, the shelf and the slot, so it was the
          // confirm — a second sheet on top of it would only be in the way.
          dropOnShelf(ids, shelfId, true);
          goToRack(index);
        }}
        onCancel={() => {
          setRackPick(null);
          setCarriedBoth([]);
          moves.cancelHold();
        }}
      />

      <MapSettingsSheet
        visible={prefsOpen}
        prefs={prefs}
        onChange={changePref}
        onClose={() => setPrefsOpen(false)}
      />

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
          edit.addBin(sheet.shelfId);
          setSheet({ ...sheet, binCount: sheet.binCount + 1 });
        }}
        onDelete={() => {
          if (!sheet) return;
          const target = sheet;
          deleteShelf(db, target.shelfId);
          logEvent(db, {
            kind: 'organize',
            name: 'shelf_deleted',
            detail: { shelf: target.name, bins: target.binCount },
          });
          setSheet(null);
          bump();
          // Its bins are now loose, so open the drawer they fell into.
          if (target.binCount > 0) setTrayOpen(true);
          // Said, not offered: recreating a shelf would mint a new id, and
          // every bin that pointed at the old one would lie. An UNDO button
          // that only dismisses itself reads as a silent failure, so this
          // announces the deletion without one.
          moves.notify(
            target.binCount > 0
              ? `${target.name} removed for good — its bins are in the tray`
              : `${target.name} removed for good`,
          );
        }}
        onClose={() => setSheet(null)}
      />

      <MoveConfirmSheet
        request={moves.confirm}
        onConfirm={() => moves.confirm?.commit()}
        onCancel={moves.cancelConfirm}
      />
    </View>
  );
}

/** What a first rack is as wide as, before there is one to copy. */
const DEFAULT_COLUMNS_FALLBACK = 4;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  mapArea: { flex: 1 },
  container: { flexGrow: 1 },
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: sp(6),
    gap: sp(3),
    backgroundColor: colors.bg,
  },
  dim: { ...type.dim, textAlign: 'center', lineHeight: 20 },
  area: { flex: 1, paddingHorizontal: sp(3), paddingBottom: sp(2) },
  well: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: shelfTheme.well,
    borderWidth: 1,
    borderColor: shelfTheme.wellBorder,
    overflow: 'hidden',
  },
  wellBody: {
    flexGrow: 1,
    paddingVertical: sp(3),
    paddingHorizontal: 15,
    // Shelves spread down the panel rather than stacking at the top: a rack
    // is the height of the wall, and a half-used one should look like a rack
    // with room on it, not a list that ran out. Evenly rather than the
    // design's `space-between`, which is the same thing on the four-shelf
    // racks it was drawn with but pins the only two shelves of a shorter one
    // to opposite ends of a hole. Once a rack is taller than the panel this
    // has no effect and the panel simply scrolls.
    justifyContent: 'space-evenly',
    gap: sp(2.5),
  },
  pegboard: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: undefined,
    height: undefined,
    opacity: 0.9,
  },
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
    bottom: sp(2),
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: sp(4),
    paddingVertical: sp(3),
  },
  snackbarText: { ...type.dim, flex: 1 },
  snackbarUndo: { color: colors.amber, fontWeight: '800', letterSpacing: 1 },
});
