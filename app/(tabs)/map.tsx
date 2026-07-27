import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { DragGhost } from '@/components/map/DragGhost';
import { MapBanner } from '@/components/map/MapBanner';
import { MapToolbar } from '@/components/map/MapToolbar';
import { MoveConfirmSheet } from '@/components/map/MoveConfirmSheet';
import { ShelfBoard } from '@/components/map/ShelfBoard';
import { ShelfSheet, shelfDraft, type ShelfDraft } from '@/components/map/ShelfSheet';
import { WallStrip } from '@/components/map/WallStrip';
import { useDb } from '@/db/DbProvider';
import {
  buildMap,
  describePlace,
  heatTier,
  locateMany,
  mapSize,
  type HeatMode,
  type MapRow,
} from '@/db/mapView';
import {
  createBin,
  deleteShelf,
  itemCountsByBin,
  listBins,
  listLocations,
  listShelves,
  nextShortCode,
  renameShelf,
  setShelfCapacity,
} from '@/db/queries';
import { logEvent } from '@/diagnostics/events';
import { useFocusTick } from '@/lib/useFocusTick';
import { describeRow, findRow, footHint, heldLabel, summarize, tint } from '@/map/mapPresentation';
import { useMapDrag } from '@/map/useMapDrag';
import { useMapFrames } from '@/map/useMapFrames';
import { useShelfMoves } from '@/map/useShelfMoves';
import { DEFAULT_MAP_PREFS, loadMapPrefs, type MapPrefs } from '@/settings/mapPrefs';
import { colors, shelf as shelfTheme, sp, type } from '@/theme';

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
 * `useMapDrag` is the opposite shape — one detector and one animated node for
 * the whole map — and it rides on top of lift-and-place rather than replacing
 * it, so a hold that never moves is exactly today's lift and every tap path
 * is untouched. It is still not proven on the field phone, so it has an off
 * switch (Settings › Map › Drag bins to rearrange). If the map ever closes
 * itself again, that switch is the first thing to try.
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
  const [heat, setHeat] = useState<HeatMode>('none');
  // Recomputed per render on purpose: staleness tints must not fossilize.
  const nowIso = new Date().toISOString();

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
  // Clamped once and used everywhere: a new `highlight` can shrink the match
  // set without resetting the step counter, and the banner read "3/2".
  const focusAt = finds.length > 0 ? Math.min(focusIndex, finds.length - 1) : 0;
  const focused = finds.length > 0 ? finds[focusAt] : null;

  // ------------------------------------------------------- layout and moves
  const frames = useMapFrames();
  const scrolledOnce = useRef(false);
  const moves = useShelfMoves({ db, areas, onChange: bump });
  const [sheet, setSheet] = useState<ShelfDraft | null>(null);

  const drag = useMapDrag({
    areas,
    enabled: prefs.dragEnabled,
    frames,
    onLift: moves.lift,
    onDrop: moves.executeDrop,
    // Stable identities only: `useMapDrag` memoizes the pan on these, and an
    // inline arrow would rebuild the gesture on every render — including the
    // many renders a drag itself produces.
    onCancel: moves.cancelHold,
    onDragStart: moves.clearUndo,
  });

  // The strip's frames are window rectangles measured while it is on screen.
  // Closing it unmounts the strip but would leave them registered, and a drag
  // released over that band of screen would be filed against a shelf that is
  // no longer drawn there.
  const clearWallFrames = drag.clearWallFrames;
  useEffect(() => {
    if (!wallOpen) clearWallFrames();
  }, [clearWallFrames, wallOpen]);

  useEffect(() => {
    if (!focused || scrolledOnce.current) return;
    const areaKey = frames.areaKeyOf(areas.indexOf(focused.area), focused.area.locationId);
    // Give the rows one frame to report their layout before the first jump.
    const t = setTimeout(() => {
      scrolledOnce.current = true;
      frames.scrollToRow(areaKey, frames.rowKey(focused.row));
    }, 120);
    return () => clearTimeout(t);
  }, [areas, focused, frames]);

  const stepFocus = useCallback(() => {
    if (finds.length < 2) return;
    const next = (focusIndex + 1) % finds.length;
    setFocusIndex(next);
    const find = finds[next];
    const areaKey = frames.areaKeyOf(areas.indexOf(find.area), find.area.locationId);
    frames.scrollToRow(areaKey, frames.rowKey(find.row));
  }, [areas, finds, focusIndex, frames]);

  const onCellPress = useCallback(
    (cell: { binId: string }, row: MapRow) => {
      const inHand = moves.heldNow();
      if (!inHand) {
        router.push({ pathname: '/bin/[id]', params: { id: cell.binId } });
        return;
      }
      if (cell.binId === inHand) {
        moves.hold(null);
        return;
      }
      moves.executeDrop(inHand, { shelfId: row.shelfId, beforeBinId: cell.binId });
    },
    [moves, router],
  );

  // -------------------------------------------------------------- editing
  const addBinToShelf = (shelfId: string) => {
    const code = nextShortCode(db);
    createBin(db, { name: `Bin ${code}`, shortCode: code, shelfId });
    bump();
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

  const { dragging, slot } = drag;
  const dragged = dragging ? (locateMany(areas, [dragging])[0]?.cell ?? null) : null;
  const targetRow = slot ? findRow(areas, slot.shelfId) : null;
  const busy = moves.held !== null || dragging !== null;

  return (
    <View style={styles.screen}>
      <MapToolbar
        heat={heat}
        onHeat={setHeat}
        searchOpen={searchOpen}
        wallOpen={wallOpen}
        query={query}
        onToggleSearch={() => {
          setSearchOpen((open) => !open);
          setQuery('');
          setFocusIndex(0);
          moves.hold(null);
        }}
        onToggleWall={() => setWallOpen((open) => !open)}
        onQuery={(text) => {
          setQuery(text);
          setFocusIndex(0);
          scrolledOnce.current = false;
        }}
        onCloseSearch={() => {
          setSearchOpen(false);
          setQuery('');
        }}
      />

      <MapBanner
        dragged={dragged}
        targetName={targetRow ? describeRow(areas, targetRow) : null}
        targetSlot={slot && !slot.viaWall ? slot.index + 1 : null}
        viaWall={slot?.viaWall ?? false}
        held={moves.held !== null && dragging === null}
        heldLabel={heldLabel(areas, moves.held)}
        onCancelHold={moves.cancelHold}
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
        summary={summarize(areas, total, busy)}
      />

      {wallOpen ? (
        <WallStrip
          areas={areas}
          matchedBinIds={wantedIds}
          draggingBinId={dragging}
          targetShelfId={slot?.viaWall ? slot.shelfId : undefined}
          onJump={(shelfId) => frames.jumpToShelf(areas, shelfId)}
          onShelfFrame={(shelfId, frame) => drag.setWallFrame(shelfId ?? 'unshelved', frame)}
        />
      ) : null}

      <GestureDetector gesture={drag.pan}>
        <View style={styles.mapArea} onLayout={(e) => frames.setViewport(e.nativeEvent.layout)}>
          <ScrollView
            ref={frames.scrollRef}
            contentContainerStyle={styles.container}
            scrollEnabled={dragging === null}
            scrollEventThrottle={16}
            onScroll={(e) => frames.setScrollY(e.nativeEvent.contentOffset.y)}
          >
            {areas.map((area, index) => {
              const areaKey = frames.areaKeyOf(index, area.locationId);
              return (
                <View
                  key={areaKey}
                  style={styles.area}
                  onLayout={(e) => frames.setAreaFrame(areaKey, e.nativeEvent.layout)}
                >
                  <View style={styles.areaHead}>
                    <Text style={styles.areaName}>{area.name}</Text>
                  </View>

                  {/* The well the boards are recessed into, with an upright at
                      each end. Measured because a board's layout is reported
                      relative to it, not to the area — the drag sums the
                      whole chain. */}
                  <View
                    style={styles.well}
                    onLayout={(e) => frames.setWellFrame(areaKey, e.nativeEvent.layout)}
                  >
                    <View pointerEvents="none" style={[styles.upright, styles.uprightLeft]} />
                    <View pointerEvents="none" style={[styles.upright, styles.uprightRight]} />
                    {area.rows.map((row) => {
                      const key = frames.rowKey(row);
                      const isTarget =
                        slot !== null && !slot.viaWall && slot.shelfId === row.shelfId;
                      return (
                        <ShelfBoard
                          key={key}
                          row={row}
                          lit={isTarget}
                          landingIndex={isTarget ? slot.index : null}
                          draggingBinId={dragging}
                          heldBinId={moves.held}
                          matchedBinIds={wantedIds}
                          focusedBinId={focused?.cell.binId ?? null}
                          settlingBinId={moves.settling}
                          showTicks={prefs.showTicks}
                          heatFor={(cell) => tint(heatTier(cell, heat, nowIso), heat)}
                          onCellPress={(cell) => onCellPress(cell, row)}
                          onCellLongPress={(cell) => moves.lift(cell.binId)}
                          onDropAtEnd={() => {
                            const inHand = moves.heldNow();
                            if (inHand) moves.executeDrop(inHand, { shelfId: row.shelfId });
                          }}
                          onEditShelf={
                            row.shelfId ? () => setSheet(shelfDraft(row, area.name)) : null
                          }
                          onAddBin={row.shelfId ? () => addBinToShelf(row.shelfId!) : null}
                          onLayout={(e) => frames.setBoardFrame(key, e.nativeEvent.layout)}
                          onRowLayout={(e) => frames.setStripFrame(key, e.nativeEvent.layout)}
                          onRowScroll={(e) =>
                            frames.setStripScroll(key, e.nativeEvent.contentOffset.x)
                          }
                        />
                      );
                    })}
                  </View>
                </View>
              );
            })}

            <Text style={styles.foot}>
              {total} bin{total === 1 ? '' : 's'} drawn, laid out the way they are filed.
              {footHint(busy, prefs.dragEnabled)}
            </Text>
          </ScrollView>

          {dragged ? (
            <DragGhost
              cell={dragged}
              x={drag.ghost.x}
              y={drag.ghost.y}
              scale={drag.ghost.scale}
              opacity={drag.ghost.opacity}
            />
          ) : null}
        </View>
      </GestureDetector>

      {moves.undo && (
        <View style={styles.snackbar} testID="map-undo-snackbar">
          <Text style={styles.snackbarText} numberOfLines={1}>
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
          deleteShelf(db, target.shelfId);
          logEvent(db, {
            kind: 'organize',
            name: 'shelf_deleted',
            detail: { shelf: target.name, bins: target.binCount },
          });
          setSheet(null);
          bump();
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
    borderRadius: 10,
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
    borderRadius: 14,
    paddingHorizontal: sp(4),
    paddingVertical: sp(3),
  },
  snackbarText: { ...type.dim, flex: 1 },
  snackbarUndo: { color: colors.amber, fontWeight: '800', letterSpacing: 1 },
});
