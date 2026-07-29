import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { MapCell, MapRow } from '@/db/mapView';
import type { WindowFrame } from '@/map/useMapDrag';
import { colors, mono, sp } from '@/theme';

import { BinCard, type BinCardState } from './BinCard';
import { plural } from '@/lib/text';

/**
 * Bins that are not on a shelf, as a drawer under the wall (v3).
 *
 * Previously the tray was the last row of a scrolling map, which put it below
 * whatever rack you happened to be looking at — nowhere, in a paged view. As
 * a drawer it is always to hand: it is the staging area a re-shelving session
 * runs through, and it is where a deleted shelf's bins land, so it must never
 * be somewhere you have to go and find.
 *
 * Collapsed by default and remembered (see `mapViewState.ts`) — most days
 * there is nothing in it and the shelves want the room.
 */
export function UnshelvedTray({
  row,
  open,
  onToggle,
  holding,
  draggingBinId,
  heldBinId,
  selectedBinIds,
  matchedBinIds,
  focusedBinId,
  settlingBinId,
  lit,
  onCellPress,
  onCellLongPress,
  onDropAtEnd,
  onFrame,
  heatFor,
}: Readonly<{
  row: MapRow;
  open: boolean;
  onToggle: () => void;
  holding: boolean;
  draggingBinId: string | null;
  heldBinId: string | null;
  selectedBinIds: readonly string[];
  matchedBinIds: readonly string[];
  focusedBinId: string | null;
  settlingBinId: string | null;
  /** A drag is hovering the tray. */
  lit: boolean;
  onCellPress: (cell: MapCell) => void;
  onCellLongPress: (cell: MapCell) => void;
  onDropAtEnd: () => void;
  /**
   * Reports the drawer's own position on the glass, so a bin can be dragged
   * onto it as well as tapped down into it. Window coordinates because the
   * tray sits outside the map's scroll area and the gesture speaks that
   * space; `onLayout` would only give a position relative to its parent.
   */
  onFrame: (frame: WindowFrame) => void;
  heatFor: (cell: MapCell) => ViewStyle | null;
}>) {
  const count = row.bins.length;
  const head = useRef<View | null>(null);

  /**
   * Re-measure whenever the drawer changes shape, not only when React tells
   * the head its own box moved.
   *
   * `onLayout` reports a position relative to the parent, so anything that
   * moves the drawer *as a whole* leaves the registered window frame stale
   * and a bin released over the tray gets hit-tested against where the tray
   * used to be. Opening it happens to fire `onLayout` today, because the
   * drawer pushes the head down inside its own wrapper — which is a fact
   * about the current arrangement rather than a guarantee, and cheap to stop
   * depending on.
   */
  const measure = useCallback(() => {
    head.current?.measureInWindow((x, y, width, height) => onFrame({ x, y, width, height }));
  }, [onFrame]);

  useEffect(measure, [open, count, measure]);

  return (
    <View style={styles.wrap}>
      {open ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
          testID="map-tray-strip"
        >
          {row.bins.map((cell) => (
            <BinCard
              key={cell.binId}
              cell={cell}
              state={cardState({
                cell,
                draggingBinId,
                heldBinId,
                selectedBinIds,
                matchedBinIds,
                focusedBinId,
                settlingBinId,
                holding,
              })}
              heatStyle={heatFor(cell)}
              onPress={() => onCellPress(cell)}
              onLongPress={() => onCellLongPress(cell)}
            />
          ))}
          {holding ? (
            <Pressable
              style={styles.drop}
              onPress={onDropAtEnd}
              accessibilityRole="button"
              accessibilityLabel="Put the bin down here, off the shelves"
              testID="map-tray-drop"
            >
              <Ionicons name="download-outline" size={13} color={colors.amber} />
              <Text style={styles.dropText}>here</Text>
            </Pressable>
          ) : null}
          {count === 0 && !holding ? (
            <Text style={styles.empty}>nothing waiting to be placed</Text>
          ) : null}
        </ScrollView>
      ) : null}

      <Pressable
        ref={head}
        style={styles.head}
        onLayout={measure}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${plural(count, 'bin')} not on a shelf. ${open ? 'Collapse' : 'Expand'}`}
        testID="map-tray-toggle"
      >
        {lit ? <View pointerEvents="none" style={styles.glow} /> : null}
        <Ionicons name="file-tray-stacked" size={14} color="#767D86" />
        <Text style={styles.headLabel}>
          Not on a shelf · {count} bin{count === 1 ? '' : 's'}
        </Text>
        {count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color="#565C64" />
      </Pressable>
    </View>
  );
}

function cardState(input: {
  cell: MapCell;
  draggingBinId: string | null;
  heldBinId: string | null;
  selectedBinIds: readonly string[];
  matchedBinIds: readonly string[];
  focusedBinId: string | null;
  settlingBinId: string | null;
  holding: boolean;
}): BinCardState {
  const id = input.cell.binId;
  return {
    match: input.matchedBinIds.includes(id) && input.focusedBinId !== id,
    focused: input.focusedBinId === id,
    held: input.heldBinId === id && input.draggingBinId !== id,
    ghosted: input.draggingBinId === id,
    settling: input.settlingBinId === id,
    holding: input.holding,
    selected: input.selectedBinIds.includes(id),
  };
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: sp(4), gap: sp(2) },
  strip: { flexDirection: 'row', alignItems: 'flex-end', gap: sp(2), paddingVertical: 2 },
  drop: {
    width: 68,
    height: 92,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.amber,
    borderRadius: 5,
    backgroundColor: 'rgba(255,196,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(1),
  },
  dropText: { color: colors.amber, fontFamily: mono, fontSize: 8.5, letterSpacing: 0.5 },
  empty: { color: '#565C64', fontSize: 11, fontStyle: 'italic', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp(2.25), paddingVertical: sp(0.5) },
  glow: {
    position: 'absolute',
    left: -4,
    right: -4,
    top: -4,
    bottom: -4,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.amber,
    backgroundColor: 'rgba(255,196,0,0.06)',
  },
  headLabel: { color: '#767D86', fontFamily: mono, fontSize: 10 },
  badge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.amberInkOn, fontFamily: mono, fontWeight: '800', fontSize: 9 },
  spacer: { flex: 1 },
});
