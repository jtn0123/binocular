import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { useDb } from '@/db/DbProvider';
import {
  buildMap,
  describePlace,
  heatTier,
  locateMany,
  mapSize,
  planDrop,
  rowGaps,
  type DropTarget,
  type HeatMode,
  type MapCell,
  type MapRow,
} from '@/db/mapView';
import {
  createBin,
  createShelf,
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
import { colors, mono, radius, sp, type } from '@/theme';

/**
 * The workshop map (blueprint D21, amended): a schematic of the wall that is
 * also the place you arrange it. Shelves are rows, bins are cells, and the
 * layout is the data — there is no map-only position that can drift from
 * where a bin is really filed.
 *
 * Organizing is lift-and-place rather than a held drag: long-press a bin to
 * lift it, then tap the spot it belongs — another bin to slide in front of,
 * a gap, or the end of a row. A drop inside the same shelf just writes the
 * stored order; a drop on another shelf is the §8.5 move and asks first.
 *
 * A finger-following drag was built on top of this and withdrawn: wrapping
 * every cell in a gesture-handler detector with reanimated worklets killed
 * the *process* on the field-test phone — the event log showed an app_start
 * seconds after every screen//map, with no app_background between them and
 * nothing in the JS crash handler, which is what a native crash looks like.
 * Plain Pressables cost no capability: every move the drag could make, a tap
 * makes too, and tapping is what a screen reader drives anyway. Do not
 * reintroduce the gesture layer here without testing it on a device.
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
export default function MapScreen() {
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

  const highlightIds = useMemo(
    () => (highlight ? highlight.split(',').filter(Boolean) : []),
    [highlight],
  );
  const finds = useMemo(() => locateMany(areas, highlightIds), [areas, highlightIds]);
  const [focusIndex, setFocusIndex] = useState(0);
  const focused = finds.length > 0 ? finds[Math.min(focusIndex, finds.length - 1)] : null;

  const [held, setHeld] = useState<string | null>(null);
  const heldFind = useMemo(
    () => (held ? locateMany(areas, [held])[0] ?? null : null),
    [areas, held],
  );

  const [heat, setHeat] = useState<HeatMode>('none');
  // Recomputed per render on purpose: staleness tints must not fossilize.
  const nowIso = new Date().toISOString();

  const [prompt, setPrompt] = useState<PromptRequest | null>(null);

  // The same one-slot undo bin detail offers, for the same reason: a move is
  // one press away and was otherwise only reversible by doing it again
  // backwards — which means remembering where the bin actually came from.
  const [undo, setUndo] = useState<{ label: string; revert: () => void } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );
  const offerUndo = useCallback((label: string, revert: () => void) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ label, revert });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, [setUndo]);

  // ------------------------------------------------------------- scrolling
  // Row positions are collected as they lay out (row y is relative to its
  // area card, so both are kept) and scrolling happens on demand: once when
  // the map opens on a highlight, and again on each "next" tap — never on
  // re-layout, which would fight the user the moment they look elsewhere.
  const scrollRef = useRef<ScrollView>(null);
  const areaYs = useRef<Record<string, number>>({});
  const rowYs = useRef<Record<string, number>>({});
  const scrolledOnce = useRef(false);

  const rowKey = (row: MapRow) => row.shelfId ?? 'unshelved';

  const scrollToRow = useCallback((areaKey: string, key: string) => {
    const y = (areaYs.current[areaKey] ?? 0) + (rowYs.current[key] ?? 0);
    scrollRef.current?.scrollTo({ y: Math.max(0, y - sp(6)), animated: true });
  }, []);

  useEffect(() => {
    if (!focused || scrolledOnce.current) return;
    const areaKey = focused.area.locationId ?? 'unplaced';
    const key = rowKey(focused.row);
    // Give the rows one frame to report their layout before the first jump.
    const t = setTimeout(() => {
      scrolledOnce.current = true;
      scrollToRow(areaKey, key);
    }, 120);
    return () => clearTimeout(t);
  }, [focused, scrollToRow]);

  const stepFocus = useCallback(() => {
    if (finds.length < 2) return;
    const next = (focusIndex + 1) % finds.length;
    setFocusIndex(next);
    const find = finds[next];
    scrollToRow(find.area.locationId ?? 'unplaced', rowKey(find.row));
  }, [finds, focusIndex, scrollToRow]);

  // --------------------------------------------------------------- moving
  // A mirror of `held` that is readable synchronously, so a long press that
  // arrives twice cannot undo itself. Kept after the drag was withdrawn: any
  // future second source of lifts must not be able to cancel the first.
  const heldRef = useRef<string | null>(null);
  const hold = useCallback((binId: string | null) => {
    heldRef.current = binId;
    setHeld(binId);
  }, []);

  /**
   * Lifts a bin. Idempotent on purpose: lifting twice must not toggle.
   * Putting a bin down is always explicit — tap the bin, or the banner's
   * cancel.
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
    (target: DropTarget) => {
      if (!held) return;
      const plan = planDrop(areas, held, target);
      if (!plan) {
        hold(null);
        return;
      }
      // Where it sat before, captured now: after the write the map is redrawn
      // from the database and the old arrangement is gone.
      const cameFrom = heldFind?.row;
      const previous = {
        shelfId: cameFrom?.shelfId ?? null,
        orderedIds: cameFrom ? cameFrom.bins.map((c) => c.binId) : [],
      };
      const commit = () => {
        placeBin(db, { binId: plan.binId, shelfId: plan.shelfId, orderedIds: plan.orderedIds });
        // "That bin is not where I left it" needs an answer, and the move
        // writes the same shelf_id everything else reads — so without this
        // there is no trace of it having happened here.
        logEvent(db, {
          kind: 'organize',
          name: plan.crossShelf ? 'bin_moved' : 'bin_reordered',
          detail: {
            bin: heldFind?.cell.code ?? plan.binId,
            to: plan.place,
            position: plan.orderedIds.indexOf(plan.binId),
          },
        });
        hapticSuccess();
        hold(null);
        bump();
        offerUndo(`${heldFind?.cell.code ?? 'Bin'} moved`, () => {
          placeBin(db, { binId: plan.binId, ...previous });
          logEvent(db, {
            kind: 'organize',
            name: 'move_undone',
            detail: { bin: heldFind?.cell.code ?? plan.binId },
          });
          bump();
        });
      };
      if (plan.crossShelf) {
        // The §8.5 move — a real filing change, so it asks first.
        const code = heldFind?.cell.code ?? 'this bin';
        Alert.alert('Move bin?', `Move ${code} to ${plan.place}.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Move', onPress: commit },
        ]);
      } else {
        commit();
      }
    },
    [areas, bump, db, held, heldFind, hold, offerUndo],
  );

  const onCellPress = useCallback(
    (cell: MapCell, row: MapRow) => {
      if (!held) {
        router.push({ pathname: '/bin/[id]', params: { id: cell.binId } });
        return;
      }
      if (cell.binId === held) {
        hold(null);
        return;
      }
      executeDrop({ shelfId: row.shelfId, beforeBinId: cell.binId });
    },
    [executeDrop, held, hold, router],
  );

  // -------------------------------------------------------------- editing
  const promptAddShelf = (locationId: string, locationName: string) =>
    setPrompt({
      title: `New shelf in ${locationName}`,
      placeholder: 'e.g. Shelf C',
      onSubmit: (name) => {
        createShelf(db, { locationId, name });
        bump();
      },
    });

  const promptRenameShelf = (shelfId: string, current: string) =>
    setPrompt({
      title: 'Rename shelf',
      initialValue: current,
      onSubmit: (name) => {
        renameShelf(db, shelfId, name);
        bump();
      },
    });

  const promptCapacity = (shelfId: string, name: string, current: number | null) =>
    setPrompt({
      title: `Slots on ${name}`,
      placeholder: 'e.g. 8 — 0 removes the sizing',
      keyboardType: 'number-pad',
      initialValue: current === null ? undefined : String(current),
      submitLabel: 'Set',
      onSubmit: (value) => {
        const n = parseInt(value, 10);
        setShelfCapacity(db, shelfId, Number.isFinite(n) && n > 0 ? Math.min(n, 200) : null);
        bump();
      },
    });

  const addBinToShelf = (shelfId: string) => {
    const code = nextShortCode(db);
    createBin(db, { name: `Bin ${code}`, shortCode: code, shelfId });
    bump();
  };

  const total = mapSize(areas);

  if (total === 0) {
    return (
      <ScrollView contentContainerStyle={styles.center}>
        <Stack.Screen options={{ title: 'Map' }} />
        <Text style={styles.dim}>
          Nothing to draw yet. Once you have a bin or two, this shows them laid out by shelf.
        </Text>
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.container}>
        <Stack.Screen options={{ title: 'Map' }} />

        {held ? (
          <View style={[styles.banner, styles.bannerHold]}>
            <Ionicons name="move" size={18} color={colors.amber} />
            <View style={styles.bannerText}>
              <Text style={styles.bannerName} numberOfLines={1}>
                Moving {heldFind?.cell.code ?? '…'} · {heldFind?.cell.name ?? ''}
              </Text>
              <Text style={styles.bannerWhere} numberOfLines={2}>
                Tap a bin to slide in front of it, or a slot to drop there.
              </Text>
            </View>
            <Pressable
              onPress={() => hold(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel the move"
              hitSlop={8}
              testID="map-cancel-move"
            >
              <Ionicons name="close-circle" size={22} color={colors.textDim} />
            </Pressable>
          </View>
        ) : highlightIds.length > 0 ? (
          focused ? (
            <View style={styles.banner}>
              <Ionicons name="locate" size={18} color={colors.amber} />
              <View style={styles.bannerText}>
                <Text style={styles.bannerName} numberOfLines={1}>
                  {focused.cell.code} · {focused.cell.name}
                </Text>
                <Text style={styles.bannerWhere} numberOfLines={1}>
                  {describePlace(focused)}
                </Text>
              </View>
              {finds.length > 1 ? (
                <Pressable
                  style={styles.nextButton}
                  onPress={stepFocus}
                  accessibilityRole="button"
                  accessibilityLabel={`Match ${focusIndex + 1} of ${finds.length}. Show the next one`}
                  testID="map-next-match"
                >
                  <Text style={styles.nextCount}>
                    {focusIndex + 1}/{finds.length}
                  </Text>
                  <Ionicons name="chevron-forward-circle" size={20} color={colors.amber} />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.banner}>
              <Ionicons name="help-circle-outline" size={18} color={colors.textDim} />
              <Text style={styles.bannerWhere}>
                {highlightIds.length === 1 ? 'That bin is not on the map.' : 'Those bins are not on the map.'}
              </Text>
            </View>
          )
        ) : null}

        <View style={styles.heatBar}>
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
        </View>
        {heat !== 'none' ? (
          <Text style={styles.legend}>
            {heat === 'items'
              ? 'Brighter amber = more items in the bin.'
              : 'Darker = longer since the bin was scanned; red = never scanned.'}
          </Text>
        ) : null}

        {areas.map((area) => {
          const areaKey = area.locationId ?? 'unplaced';
          return (
            <View
              key={areaKey}
              style={styles.area}
              onLayout={(e) => {
                areaYs.current[areaKey] = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.areaHead}>
                <Text style={styles.areaName}>{area.name}</Text>
                {area.locationId ? (
                  <Pressable
                    onPress={() => promptAddShelf(area.locationId!, area.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a shelf to ${area.name}`}
                    hitSlop={8}
                    testID={`map-add-shelf-${areaKey}`}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={colors.textDim} />
                  </Pressable>
                ) : null}
              </View>
              {area.rows.map((row) => {
                const key = rowKey(row);
                const marked = focused?.row === row;
                const gaps = rowGaps(row);
                const over = row.capacity !== null && row.bins.length > row.capacity;
                return (
                  <View
                    key={key}
                    style={[styles.row, marked && styles.rowFound]}
                    onLayout={(e) => {
                      rowYs.current[key] = e.nativeEvent.layout.y;
                    }}
                  >
                    <View style={styles.rowHead}>
                      <Text
                        style={[styles.rowName, marked && styles.rowNameFound]}
                        numberOfLines={1}
                      >
                        {row.name}
                        {row.capacity !== null ? (
                          <Text style={styles.rowCapacity}>
                            {'  '}
                            {row.bins.length}/{row.capacity}
                            {over ? ' — over' : ''}
                          </Text>
                        ) : null}
                      </Text>
                      {row.shelfId ? (
                        <View style={styles.rowActions}>
                          <RowAction
                            icon="pencil"
                            label={`Rename ${row.name}`}
                            onPress={() => promptRenameShelf(row.shelfId!, row.name)}
                          />
                          <RowAction
                            icon="apps-outline"
                            label={`Set how many slots ${row.name} has`}
                            onPress={() => promptCapacity(row.shelfId!, row.name, row.capacity)}
                          />
                          <RowAction
                            icon="add"
                            label={`New bin on ${row.name}`}
                            onPress={() => addBinToShelf(row.shelfId!)}
                          />
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.cells}>
                      {row.bins.map((cell) => (
                        <Cell
                          key={cell.binId}
                          cell={cell}
                          found={highlightIds.includes(cell.binId)}
                          focusedCell={focused?.cell.binId === cell.binId}
                          heldCell={held === cell.binId}
                          holding={held !== null}
                          heatStyle={tint(heatTier(cell, heat, nowIso), heat)}
                          onPress={() => onCellPress(cell, row)}
                          onLongPress={() => lift(cell.binId)}
                        />
                      ))}
                      {Array.from({ length: gaps }, (_, i) => (
                        <Pressable
                          key={`gap-${i}`}
                          style={styles.gap}
                          disabled={!held}
                          onPress={() => executeDrop({ shelfId: row.shelfId })}
                          accessibilityRole={held ? 'button' : undefined}
                          accessibilityLabel={
                            held ? `Empty slot on ${row.name} — place the bin here` : `Empty slot on ${row.name}`
                          }
                          testID={`map-gap-${key}-${i}`}
                        >
                          <Ionicons
                            name={held ? 'download-outline' : 'ellipse-outline'}
                            size={14}
                            color={held ? colors.amber : colors.textFaint}
                          />
                          <Text style={[styles.gapText, held && styles.gapTextActive]}>
                            {held ? 'here' : 'free'}
                          </Text>
                        </Pressable>
                      ))}
                      {held && gaps === 0 ? (
                        <Pressable
                          style={[styles.gap, styles.gapActive]}
                          onPress={() => executeDrop({ shelfId: row.shelfId })}
                          accessibilityRole="button"
                          accessibilityLabel={`Move the bin to the end of ${row.name}`}
                          testID={`map-drop-end-${key}`}
                        >
                          <Ionicons name="download-outline" size={14} color={colors.amber} />
                          <Text style={[styles.gapText, styles.gapTextActive]}>here</Text>
                        </Pressable>
                      ) : null}
                      {row.bins.length === 0 && gaps === 0 && !held ? (
                        <Text style={styles.rowEmpty}>no bins yet</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}

        <Text style={styles.foot}>
          {total} bin{total === 1 ? '' : 's'} drawn, laid out the way they are filed.
          {held ? '' : ' Hold a bin to move it.'}
        </Text>
      </ScrollView>
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
      <PromptModal request={prompt} onClose={() => setPrompt(null)} />
    </>
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

function RowAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    // 15px of icon with 6px of slop is a 27px target on a screen held in a
    // gloved hand. Android's own guidance is 48; this gets close without
    // making the row header louder than the bins it labels.
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={styles.rowAction}
    >
      <Ionicons name={icon} size={17} color={colors.textDim} />
    </Pressable>
  );
}

function Cell({
  cell,
  found,
  focusedCell,
  heldCell,
  holding,
  heatStyle,
  onPress,
  onLongPress,
}: {
  cell: MapCell;
  found: boolean;
  focusedCell: boolean;
  heldCell: boolean;
  holding: boolean;
  heatStyle: ViewStyle | null;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const loud = focusedCell || heldCell;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.cell,
        cell.empty && styles.cellEmpty,
        heatStyle,
        found && styles.cellMatch,
        focusedCell && styles.cellFound,
        heldCell && styles.cellHeld,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${cell.code} ${cell.name}, ${cell.items} item${
        cell.items === 1 ? '' : 's'
      }${found ? ' — a bin you are looking for' : ''}${
        heldCell
          ? ' — being moved, tap to cancel'
          : holding
            ? ' — tap to place the moved bin in front of it'
            : '. Long press to move it'
      }`}
      testID={`map-cell-${cell.code}`}
    >
      <View style={styles.cellHead}>
        {cell.photoUri ? (
          <Image source={{ uri: cell.photoUri }} style={styles.cellPhoto} contentFit="cover" />
        ) : (
          <View style={[styles.cellPhoto, styles.cellPhotoEmpty]}>
            <Ionicons
              name="cube-outline"
              size={14}
              color={loud ? colors.amberInkOn : colors.textFaint}
            />
          </View>
        )}
        <Text style={[styles.cellCode, loud && styles.cellCodeFound]} numberOfLines={1}>
          {cell.code}
        </Text>
        {focusedCell ? <Ionicons name="locate" size={13} color={colors.amberInkOn} /> : null}
        {heldCell ? <Ionicons name="move" size={13} color={colors.amberInkOn} /> : null}
      </View>
      <Text style={[styles.cellName, loud && styles.cellNameFound]} numberOfLines={2}>
        {cell.name}
      </Text>
      <Text style={[styles.cellCount, loud && styles.cellNameFound]}>
        {cell.empty ? 'empty' : `${cell.items} item${cell.items === 1 ? '' : 's'}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: sp(4),
    paddingBottom: sp(12),
    gap: sp(4),
    backgroundColor: colors.bg,
    flexGrow: 1,
  },
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    backgroundColor: colors.chipSelectedBg,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    borderRadius: radius.md,
    padding: sp(3),
  },
  bannerHold: { borderStyle: 'dashed' },
  bannerText: { flex: 1, gap: 2 },
  bannerName: { color: colors.amber, fontFamily: mono, fontSize: 14 },
  bannerWhere: { color: colors.textDim, fontSize: 12 },
  nextButton: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  nextCount: { color: colors.amber, fontFamily: mono, fontSize: 12 },
  heatBar: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  heatLabel: { ...type.stamp },
  heatChip: {
    paddingHorizontal: sp(2.5),
    paddingVertical: sp(1),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.chipBg,
  },
  heatChipOn: { backgroundColor: colors.chipSelectedBg, borderColor: colors.chipSelectedBorder },
  heatChipText: { color: colors.textDim, fontSize: 12 },
  heatChipTextOn: { color: colors.amber },
  legend: { color: colors.textFaint, fontSize: 11, marginTop: -sp(2) },
  area: { gap: sp(2) },
  areaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  areaName: { ...type.stamp },
  row: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: sp(2.5),
    gap: sp(1.5),
    marginBottom: sp(1),
  },
  rowFound: { borderLeftColor: colors.amber },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowName: { color: colors.textDim, fontSize: 12, fontFamily: mono, flex: 1 },
  rowNameFound: { color: colors.amber },
  rowCapacity: { color: colors.textFaint },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: sp(1) },
  rowAction: { paddingHorizontal: sp(1.5), paddingVertical: sp(1) },
  rowEmpty: { color: colors.textFaint, fontSize: 11, fontStyle: 'italic' },
  cells: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2), alignItems: 'flex-start' },
  cell: {
    width: 104,
    minHeight: 92,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: sp(2),
    gap: 3,
  },
  cellEmpty: { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
  /** Any bin the search matched: outlined so several can glow at once. */
  cellMatch: { borderColor: colors.amber, borderWidth: 2 },
  /** The match currently focused by the banner: filled, unmissable. */
  cellFound: { backgroundColor: colors.amber, borderColor: colors.amber },
  cellHeld: { backgroundColor: colors.amber, borderColor: colors.amber, opacity: 0.85 },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  cellPhoto: { width: 22, height: 22, borderRadius: radius.sm },
  cellPhotoEmpty: {
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellCode: { color: colors.steel, fontFamily: mono, fontSize: 11, flex: 1 },
  cellCodeFound: { color: colors.amberInkOn },
  cellName: { color: colors.text, fontSize: 12, flex: 1 },
  cellNameFound: { color: colors.amberInkOn },
  cellCount: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  gap: {
    width: 104,
    minHeight: 92,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(1),
  },
  gapActive: { borderColor: colors.amber },
  gapText: { color: colors.textFaint, fontSize: 10, fontFamily: mono },
  gapTextActive: { color: colors.amber },
  foot: { ...type.dim, fontSize: 11, lineHeight: 16 },
  snackbar: {
    position: 'absolute',
    left: sp(4),
    right: sp(4),
    bottom: sp(5),
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
