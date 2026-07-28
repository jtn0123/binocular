import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';

import type { MapCell, MapRow } from '@/db/mapView';
import { rowGaps } from '@/db/mapView';
import { colors, mono, shelf, sp } from '@/theme';

import { BinCard, type BinCardState } from './BinCard';
import { CARD_GAP, CARD_H, CARD_W } from './metrics';

/**
 * One shelf, drawn as a board (D21).
 *
 * The bins stand in a row on a plank rather than wrapping in a grid, because
 * that is what they do on the wall — and because a single straight strip is
 * what makes "which slot is my finger over" answerable by arithmetic rather
 * than by measuring every card (see `metrics.ts`). Rows scroll sideways when
 * a shelf is wider than the phone; the wall strip is how you reach a shelf
 * that is off the bottom instead.
 *
 * The unshelved tray gets no plank — nothing is holding those bins up, which
 * is the point of the row.
 */
export interface ShelfBoardProps {
  row: MapRow;
  /** Lit because a dragged bin would land here. */
  lit: boolean;
  /** Slot the landing placeholder occupies, counted without the lifted bin. */
  landingIndex: number | null;
  /** Bin currently under the finger; drawn as the hole it left. */
  draggingBinId: string | null;
  heldBinId: string | null;
  matchedBinIds: readonly string[];
  focusedBinId: string | null;
  settlingBinId: string | null;
  showTicks: boolean;
  heatFor: (cell: MapCell) => ViewStyle | null;
  onCellPress: (cell: MapCell) => void;
  onCellLongPress: (cell: MapCell) => void;
  /** A free slot or the end of the row — where a held bin can be tapped down. */
  onDropAtEnd: () => void;
  onEditShelf: (() => void) | null;
  onAddBin: (() => void) | null;
  onLayout?: (event: LayoutChangeEvent) => void;
  onRowLayout?: (event: LayoutChangeEvent) => void;
  onRowScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

export function ShelfBoard(props: ShelfBoardProps) {
  const { row, lit, showTicks } = props;
  const over = row.capacity !== null && row.bins.length > row.capacity;
  const key = row.shelfId ?? 'unshelved';
  const cards = buildCards(props, key);

  return (
    <View style={styles.board} onLayout={props.onLayout} testID={`map-board-${key}`}>
      {lit ? <View pointerEvents="none" style={styles.glow} /> : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        testID={`map-strip-${key}`}
        onLayout={props.onRowLayout}
        onScroll={props.onRowScroll}
        scrollEventThrottle={16}
      >
        {cards.length > 0 ? cards : <Text style={styles.emptyRow}>no bins yet</Text>}
      </ScrollView>

      {row.shelfId === null ? (
        <View style={styles.trayEdge} />
      ) : (
        <>
          <Plank lit={lit} over={over} />
          {showTicks ? <Ticks /> : null}
        </>
      )}

      <View style={styles.label}>
        <Text style={styles.name} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={[styles.fill, over && styles.fillOver]} numberOfLines={1}>
          {row.capacity !== null ? `${row.bins.length}/${row.capacity}` : String(row.bins.length)}
          {over ? ' — over' : ''}
        </Text>
        <View style={styles.actions}>
          {props.onEditShelf ? (
            <Pressable
              onPress={props.onEditShelf}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${row.name}`}
              testID={`map-edit-shelf-${key}`}
            >
              <Ionicons name="pencil" size={15} color={colors.textFaint} />
            </Pressable>
          ) : null}
          {props.onAddBin ? (
            <Pressable
              onPress={props.onAddBin}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`New bin on ${row.name}`}
              testID={`map-add-bin-${key}`}
            >
              <Ionicons name="add" size={17} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * Everything standing in the strip, in draw order: the bins, the landing
 * placeholder spliced into the slot the drag reports, and the free slots after
 * them. Out of the render body because the splicing is the fiddly part of this
 * component and reads better on its own.
 *
 * The lifted bin keeps its place as a hole, so the row never reflows out from
 * under the finger. `seen` counts only the cards the drag can see — the same
 * footing the reported index was measured on.
 */
function buildCards(props: ShelfBoardProps, key: string): React.ReactNode[] {
  const { row, landingIndex, draggingBinId, heldBinId } = props;
  const holding = heldBinId !== null || draggingBinId !== null;
  const cards: React.ReactNode[] = [];
  let seen = 0;

  for (const cell of row.bins) {
    const dragged = cell.binId === draggingBinId;
    if (!dragged && landingIndex === seen) {
      cards.push(<LandingSlot key="landing" index={landingIndex} />);
    }
    if (!dragged) seen++;
    cards.push(
      <BinCard
        key={cell.binId}
        cell={cell}
        state={cardState(props, cell)}
        heatStyle={props.heatFor(cell)}
        onPress={() => props.onCellPress(cell)}
        onLongPress={() => props.onCellLongPress(cell)}
      />,
    );
  }
  if (landingIndex !== null && landingIndex >= seen) {
    cards.push(<LandingSlot key="landing" index={landingIndex} />);
  }

  // Declared space that is still free. One is consumed while a landing slot
  // is showing, so the row does not appear to grow as a bin arrives.
  const free = Math.max(0, rowGaps(row) - (landingIndex !== null ? 1 : 0));
  for (let i = 0; i < free; i++) {
    cards.push(
      <SlotPlaceholder
        key={`gap-${i}`}
        holding={holding}
        rowName={row.name}
        onPress={props.onDropAtEnd}
        testID={`map-gap-${key}-${i}`}
      />,
    );
  }
  if (holding && free === 0 && landingIndex === null) {
    cards.push(
      <SlotPlaceholder
        key="end"
        holding
        rowName={row.name}
        onPress={props.onDropAtEnd}
        testID={`map-drop-end-${key}`}
      />,
    );
  }

  return cards;
}

function cardState(props: ShelfBoardProps, cell: MapCell): BinCardState {
  return {
    match: props.matchedBinIds.includes(cell.binId) && props.focusedBinId !== cell.binId,
    focused: props.focusedBinId === cell.binId,
    held: props.heldBinId === cell.binId && props.draggingBinId !== cell.binId,
    ghosted: props.draggingBinId === cell.binId,
    settling: props.settlingBinId === cell.binId,
    holding: props.heldBinId !== null,
  };
}

/**
 * Where the bin will land: a bin-sized hole rather than a thin caret, so the
 * answer to "does it fit there" is the same shape as the thing being placed.
 */
function LandingSlot({ index }: { index: number }) {
  return (
    <View style={styles.landing} pointerEvents="none" testID="map-landing-slot">
      <Ionicons name="arrow-down" size={16} color={colors.amber} />
      <Text style={styles.landingText}>slot {index + 1}</Text>
    </View>
  );
}

/** Declared-but-empty space: "free" at rest, "here" when something is in hand. */
function SlotPlaceholder({
  holding,
  rowName,
  onPress,
  testID,
}: {
  holding: boolean;
  rowName: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      style={[styles.slot, holding && styles.slotActive]}
      disabled={!holding}
      onPress={onPress}
      accessibilityRole={holding ? 'button' : undefined}
      accessibilityLabel={
        holding ? `Empty slot on ${rowName} — place the bin here` : `Empty slot on ${rowName}`
      }
      testID={testID}
    >
      <Ionicons
        name={holding ? 'download-outline' : 'ellipse-outline'}
        size={14}
        color={holding ? colors.amber : shelf.slotLabel}
      />
      <Text style={[styles.slotText, holding && styles.slotTextActive]}>
        {holding ? 'here' : 'free'}
      </Text>
    </Pressable>
  );
}

/**
 * The board the bins stand on. Two stacked strips rather than a gradient:
 * a lit top edge and a shadowed face is what makes it read as a plank seen
 * from slightly above, and React Native has no gradient without a library.
 */
function Plank({ lit, over }: { lit: boolean; over: boolean }) {
  return (
    <View style={[styles.plank, lit && styles.plankLit, !lit && over && styles.plankOver]}>
      <View
        style={[styles.plankEdge, lit && styles.plankEdgeLit, !lit && over && styles.plankEdgeOver]}
      />
    </View>
  );
}

/** Slot divisions scored into the shelf edge. */
function Ticks() {
  const [width, setWidth] = useState(0);
  const spacing = 32;
  const count = width > 0 ? Math.floor(width / spacing) : 0;
  return (
    <View style={styles.ticks} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.tick, { left: i * spacing }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: { paddingBottom: sp(4.5) },
  glow: {
    position: 'absolute',
    left: -4,
    right: -4,
    top: -6,
    bottom: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,196,0,0.5)',
    backgroundColor: 'rgba(255,196,0,0.05)',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: CARD_GAP,
    minHeight: CARD_H + 4,
    paddingBottom: 7,
  },
  emptyRow: {
    color: shelf.slotLabel,
    fontSize: 11,
    fontStyle: 'italic',
    alignSelf: 'flex-end',
    paddingBottom: sp(3),
  },
  landing: {
    width: CARD_W,
    height: CARD_H,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.amber,
    borderRadius: 7,
    backgroundColor: 'rgba(255,196,0,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(1.5),
  },
  landingText: { color: colors.amber, fontFamily: mono, fontSize: 9.5, letterSpacing: 0.6 },
  slot: {
    width: CARD_W,
    height: CARD_H,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.chipBorder,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(1.25),
  },
  slotActive: { borderColor: colors.amber, backgroundColor: 'rgba(255,196,0,0.06)' },
  slotText: { color: shelf.slotLabel, fontFamily: mono, fontSize: 9.5, letterSpacing: 0.6 },
  slotTextActive: { color: colors.amber },
  plank: {
    height: 10,
    borderRadius: 2,
    backgroundColor: shelf.plankFace,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 5 },
  },
  plankLit: { backgroundColor: colors.chipSelectedBorder },
  plankOver: { backgroundColor: colors.dangerDim },
  plankEdge: {
    height: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: shelf.plankLit,
  },
  plankEdgeLit: { backgroundColor: colors.amber },
  plankEdgeOver: { backgroundColor: colors.danger },
  ticks: { height: 5, marginHorizontal: 3 },
  tick: { position: 'absolute', top: 0, width: 1, height: 5, backgroundColor: shelf.tick },
  trayEdge: {
    height: 6,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: colors.chipBorder,
  },
  label: { flexDirection: 'row', alignItems: 'center', gap: sp(2), paddingTop: sp(1.25) },
  name: {
    color: shelf.stamp,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  fill: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  fillOver: { color: colors.danger },
  actions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: sp(4) },
});
