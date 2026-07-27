import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { rowGaps, type MapArea } from '@/db/mapView';
import { colors, mono, radius, shelf, sp } from '@/theme';

/**
 * The whole wall at a glance (D21).
 *
 * The map scrolls, which means the shelf you want to move a bin *to* is
 * regularly off-screen while the bin is in your hand. This is every shelf
 * shrunk to a strip of cells: tap one to jump the map to it, or drag a bin
 * onto it to send the bin to the end of that shelf without scrolling at all.
 *
 * It draws the same derived data as the map — no second truth, per D21.
 */
/** A strip's position on the glass, so a drag can be tested against it. */
export interface WallShelfFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function WallStrip({
  areas,
  matchedBinIds,
  draggingBinId,
  targetShelfId,
  onJump,
  onShelfFrame,
}: {
  areas: readonly MapArea[];
  matchedBinIds: readonly string[];
  draggingBinId: string | null;
  /** Lit because the finger is over it. */
  targetShelfId: string | null | undefined;
  onJump: (shelfId: string | null) => void;
  /**
   * Reports each strip in *window* coordinates. Layout events would only give
   * a position relative to whichever nested view happens to be the parent —
   * three levels of padding away from anything a gesture can compare against.
   */
  onShelfFrame: (shelfId: string | null, frame: WallShelfFrame) => void;
}) {
  const strips = useRef<Record<string, View | null>>({});

  const report = (shelfId: string | null) => {
    const key = shelfId ?? 'unshelved';
    strips.current[key]?.measureInWindow((x, y, width, height) => {
      onShelfFrame(shelfId, { x, y, width, height });
    });
  };

  return (
    <View style={styles.wall} testID="map-wall-strip">
      <View style={styles.head}>
        <Text style={styles.headLabel}>WHOLE WALL</Text>
        <Text style={styles.headHint} numberOfLines={1}>
          tap to jump · drag a bin here
        </Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        nestedScrollEnabled
      >
        {areas.map((area) => (
          <View key={area.locationId ?? 'unplaced'} style={styles.area}>
            <Text style={styles.areaName}>{area.name}</Text>
            <View style={styles.boards}>
              {area.rows.map((row) => {
                const lit = targetShelfId !== undefined && targetShelfId === row.shelfId;
                return (
                  <Pressable
                    key={row.shelfId ?? 'unshelved'}
                    ref={(node) => {
                      strips.current[row.shelfId ?? 'unshelved'] = node;
                    }}
                    style={styles.mini}
                    onLayout={() => report(row.shelfId)}
                    onPress={() => onJump(row.shelfId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Jump to ${row.name} in ${area.name}`}
                    testID={`map-wall-${row.shelfId ?? 'unshelved'}`}
                  >
                    <View style={styles.cells}>
                      {row.bins.map((cell) => (
                        <View
                          key={cell.binId}
                          style={[
                            styles.cell,
                            matchedBinIds.includes(cell.binId) && styles.cellMatch,
                            cell.binId === draggingBinId && styles.cellMoving,
                          ]}
                        />
                      ))}
                      {Array.from({ length: rowGaps(row) }, (_, i) => (
                        <View key={`free-${i}`} style={[styles.cell, styles.cellFree]} />
                      ))}
                    </View>
                    <View style={styles.miniPlank} />
                    <Text style={styles.miniLabel} numberOfLines={1}>
                      {row.name}
                      {row.capacity !== null ? `  ${row.bins.length}/${row.capacity}` : ''}
                    </Text>
                    {lit ? <View pointerEvents="none" style={styles.ring} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wall: {
    marginHorizontal: sp(4),
    marginBottom: sp(2.5),
    borderRadius: radius.md,
    backgroundColor: shelf.well,
    borderWidth: 1,
    borderColor: '#262A2F',
    paddingHorizontal: sp(2.75),
    paddingTop: sp(2.25),
    paddingBottom: sp(2.75),
    gap: sp(2.25),
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: sp(2) },
  headLabel: { color: colors.textFaint, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.5 },
  headHint: { flex: 1, color: shelf.slotLabel, fontFamily: mono, fontSize: 9.5 },
  // Capped so the wall never takes the map's own space; it scrolls instead.
  scroll: { maxHeight: 210 },
  scrollBody: { gap: sp(2.25) },
  area: { gap: sp(1.75) },
  areaName: {
    color: shelf.slotLabel,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  boards: { flexDirection: 'row', flexWrap: 'wrap', rowGap: sp(2.25), columnGap: sp(3.5) },
  mini: { alignItems: 'flex-start', gap: 2, paddingHorizontal: 3, paddingTop: 2, borderRadius: 4 },
  cells: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, minHeight: 12 },
  cell: {
    width: 19,
    height: 12,
    borderRadius: 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  cellMatch: { backgroundColor: colors.amber, borderColor: colors.amber },
  cellMoving: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: colors.chipSelectedBorder,
  },
  cellFree: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: colors.border },
  miniPlank: { alignSelf: 'stretch', height: 3, borderRadius: 1, backgroundColor: shelf.upright },
  miniLabel: { color: shelf.slotLabel, fontFamily: mono, fontSize: 8, letterSpacing: 0.4 },
  ring: {
    position: 'absolute',
    left: -1,
    right: -1,
    top: -1,
    bottom: -1,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.amber,
    backgroundColor: 'rgba(255,196,0,0.08)',
  },
});
