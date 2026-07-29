import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import type { MapCell, MapRow } from '@/db/mapView';
import { rowGaps } from '@/db/mapView';
import { colors, mono, radius, sp } from '@/theme';

import { BinCard, slotBox, type BinCardState } from './BinCard';
import { CARD_GAP, CARD_H } from './metrics';

/**
 * One shelf, drawn as a board (D21, v3).
 *
 * The bins stand in a centred row that shares the width — a rack is a grid you
 * read at a glance, so a shelf never scrolls sideways and every slot on it is
 * visible at once. Free slots are drawn, not implied: a shelf that declares
 * four slots and holds two shows you the two gaps.
 *
 * The plank is a 4pt bar with slot divisions scored into it, not a chunky
 * ledge. It reads as the edge of a shelf seen straight on, which is what the
 * whole panel is a picture of.
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
  /** Picked for a group move. */
  selectedBinIds: readonly string[];
  matchedBinIds: readonly string[];
  focusedBinId: string | null;
  settlingBinId: string | null;
  showTicks: boolean;
  /** Edit mode: the shelf's own name and slot count become editable. */
  editing: boolean;
  heatFor: (cell: MapCell) => ViewStyle | null;
  onCellPress: (cell: MapCell) => void;
  onCellLongPress: (cell: MapCell) => void;
  /** A free slot or the end of the row — where a held bin can be tapped down. */
  onDropAtEnd: () => void;
  onEditShelf: (() => void) | null;
  onAddBin: (() => void) | null;
  onRename: ((name: string) => void) | null;
  /** Edit-mode width stepper; null on the tray, which has no declared size. */
  onWidth: ((capacity: number) => void) | null;
  /** Removes an empty shelf; null when it holds bins or is the rack's last. */
  onRemove: (() => void) | null;
  /**
   * The one-tap way out of an over-full shelf: where its last bin would go,
   * and the move itself. Null when the shelf is not over or nowhere is better.
   */
  overflow: { label: string; run: () => void } | null;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Reports the row's own box, which is what the drag measures slots against. */
  onRowLayout?: (event: LayoutChangeEvent) => void;
}

export function ShelfBoard(props: ShelfBoardProps) {
  const { row, lit, showTicks, editing } = props;
  const over = row.capacity !== null && row.bins.length > row.capacity;
  const key = row.shelfId ?? 'unshelved';
  const cells = buildCells(props, key);

  return (
    <View style={styles.board} onLayout={props.onLayout} testID={`map-board-${key}`}>
      {lit ? <View pointerEvents="none" style={styles.glow} /> : null}

      <View style={styles.strip} onLayout={props.onRowLayout}>
        {cells.length > 0 ? cells : <Text style={styles.emptyRow}>no bins yet</Text>}
      </View>

      {row.shelfId === null ? (
        <View style={styles.trayEdge} />
      ) : (
        <Plank lit={lit} over={over} showTicks={showTicks} />
      )}

      <View style={styles.label}>
        {editing && props.onRename ? (
          <ShelfName name={row.name} onRename={props.onRename} testID={`map-shelf-name-${key}`} />
        ) : (
          <Text style={styles.name} numberOfLines={1}>
            {row.name}
          </Text>
        )}
        <Text style={[styles.fill, over && styles.fillOver]} numberOfLines={1}>
          {row.capacity !== null ? `${row.bins.length}/${row.capacity}` : String(row.bins.length)}
          {over ? ' — over' : ''}
        </Text>
        {/* An over-full shelf offers the way out instead of only complaining. */}
        {over && props.overflow ? (
          <Pressable
            style={styles.overFix}
            onPress={props.overflow.run}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${row.name} is over its slots — ${props.overflow.label}`}
            testID={`map-over-fix-${key}`}
          >
            <Text style={styles.overFixLabel}>{props.overflow.label}</Text>
          </Pressable>
        ) : null}

        <View style={styles.actions}>
          {props.onAddBin ? (
            <Pressable
              onPress={props.onAddBin}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`New bin on ${row.name}`}
              testID={`map-add-bin-${key}`}
            >
              <Ionicons name="add" size={14} color={colors.textDim} />
            </Pressable>
          ) : null}

          {editing && props.onRemove ? (
            <Pressable
              onPress={props.onRemove}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${row.name}`}
              testID={`map-remove-shelf-${key}`}
            >
              <Text style={styles.remove}>remove</Text>
            </Pressable>
          ) : null}

          {editing && props.onWidth ? (
            <WidthStepper row={row} onWidth={props.onWidth} keyId={key} />
          ) : props.onEditShelf ? (
            <Pressable
              onPress={props.onEditShelf}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${row.name}`}
              testID={`map-edit-shelf-${key}`}
            >
              <Ionicons name="pencil" size={13} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * Everything standing on the plank, in draw order: the bins, the landing
 * placeholder spliced into the slot the drag reports, and the free slots after
 * them. Out of the render body because the splicing is the fiddly part.
 *
 * The lifted bin keeps its place as a hole, so the row never reflows out from
 * under the finger. `seen` counts only the cells the drag can see — the same
 * footing the reported index was measured on.
 */
function buildCells(props: ShelfBoardProps, key: string): React.ReactNode[] {
  const { row, landingIndex, draggingBinId, heldBinId } = props;
  const holding = heldBinId !== null || draggingBinId !== null;
  const cells: React.ReactNode[] = [];
  let seen = 0;

  for (const cell of row.bins) {
    const dragged = cell.binId === draggingBinId;
    if (!dragged && landingIndex === seen) {
      cells.push(<LandingSlot key="landing" />);
    }
    if (!dragged) seen++;
    cells.push(
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
    cells.push(<LandingSlot key="landing" />);
  }

  // Declared space that is still free. One is consumed while a landing slot
  // is showing, so the row does not appear to grow as a bin arrives.
  const free = Math.max(0, rowGaps(row) - (landingIndex !== null ? 1 : 0));
  for (let i = 0; i < free; i++) {
    cells.push(
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
    cells.push(
      <SlotPlaceholder
        key="end"
        holding
        rowName={row.name}
        onPress={props.onDropAtEnd}
        testID={`map-drop-end-${key}`}
      />,
    );
  }

  return cells;
}

function cardState(props: ShelfBoardProps, cell: MapCell): BinCardState {
  return {
    match: props.matchedBinIds.includes(cell.binId) && props.focusedBinId !== cell.binId,
    focused: props.focusedBinId === cell.binId,
    held: props.heldBinId === cell.binId && props.draggingBinId !== cell.binId,
    ghosted: props.draggingBinId === cell.binId,
    settling: props.settlingBinId === cell.binId,
    holding: props.heldBinId !== null,
    selected: props.selectedBinIds.includes(cell.binId),
  };
}

/** Where the bin will land: a bin-sized hole, the same shape as the thing. */
function LandingSlot() {
  return (
    <View style={styles.landing} pointerEvents="none" testID="map-landing-slot">
      <Ionicons name="arrow-down" size={14} color={colors.amber} />
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
      {holding ? <Ionicons name="download-outline" size={13} color={colors.amber} /> : null}
      <Text style={[styles.slotText, holding && styles.slotTextActive]}>
        {holding ? 'here' : 'free'}
      </Text>
    </Pressable>
  );
}

/**
 * The shelf edge, seen straight on: a 4pt bar with the slot divisions scored
 * into it. Lit while a bin would land here, red while the shelf reads over.
 */
function Plank({ lit, over, showTicks }: { lit: boolean; over: boolean; showTicks: boolean }) {
  const [width, setWidth] = useState(0);
  const spacing = 24;
  const ticks = showTicks && width > 0 ? Math.floor(width / spacing) : 0;
  return (
    <View
      style={[styles.plank, lit && styles.plankLit, !lit && over && styles.plankOver]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {Array.from({ length: ticks }, (_, i) => (
        <View key={i} style={[styles.tick, { left: (i + 1) * spacing }]} />
      ))}
    </View>
  );
}

/** Renaming a shelf where it stands, rather than in a sheet about it. */
function ShelfName({
  name,
  onRename,
  testID,
}: {
  name: string;
  onRename: (next: string) => void;
  testID: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <Pressable
        onPress={() => setDraft(name)}
        accessibilityRole="button"
        accessibilityLabel={`Rename ${name}`}
        testID={testID}
      >
        <Text style={[styles.name, styles.nameEditable]} numberOfLines={1}>
          {name}
        </Text>
      </Pressable>
    );
  }
  return (
    <TextInput
      style={styles.nameInput}
      value={draft}
      onChangeText={setDraft}
      onBlur={() => {
        onRename(draft);
        setDraft(null);
      }}
      onSubmitEditing={() => {
        onRename(draft);
        setDraft(null);
      }}
      autoFocus
      accessibilityLabel="Shelf name"
      testID={`${testID}-input`}
    />
  );
}

/**
 * How wide this one shelf is, when the rack's uniform width does not fit it.
 * Never below the bins already on it: the number describes the shelf, and
 * shrinking it past its contents would only manufacture an "over" warning.
 */
function WidthStepper({
  row,
  onWidth,
  keyId,
}: {
  row: MapRow;
  onWidth: (capacity: number) => void;
  keyId: string;
}) {
  const current = row.capacity ?? row.bins.length;
  return (
    <View style={styles.width}>
      <Pressable
        style={styles.widthButton}
        onPress={() => onWidth(Math.max(1, row.bins.length, current - 1))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`One slot fewer on ${row.name}`}
        testID={`map-shelf-shrink-${keyId}`}
      >
        <Ionicons name="remove" size={10} color={colors.amber} />
      </Pressable>
      <Text style={styles.widthValue}>{row.capacity === null ? '∞' : String(row.capacity)}</Text>
      <Pressable
        style={styles.widthButton}
        onPress={() => onWidth(Math.min(8, current + 1))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`One slot more on ${row.name}`}
        testID={`map-shelf-grow-${keyId}`}
      >
        <Ionicons name="add" size={10} color={colors.amber} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { position: 'relative', gap: 4 },
  glow: {
    position: 'absolute',
    left: -7,
    right: -7,
    top: -6,
    bottom: -3,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.amber,
    backgroundColor: 'rgba(255,196,0,0.05)',
    zIndex: 2,
  },
  // Centred, sharing the width: the design's `justify-content: center`.
  strip: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: CARD_GAP,
    minHeight: CARD_H,
  },
  landing: {
    ...slotBox,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.amber,
    borderRadius: 5,
    backgroundColor: 'rgba(255,196,0,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot: {
    ...slotBox,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(1),
  },
  slotActive: { borderColor: colors.amber, backgroundColor: 'rgba(255,196,0,0.06)' },
  slotText: { color: '#565C64', fontFamily: mono, fontSize: 8.5, letterSpacing: 0.5 },
  slotTextActive: { color: colors.amber },
  emptyRow: { alignSelf: 'center', color: '#565C64', fontSize: 11, fontStyle: 'italic' },
  plank: {
    height: 4,
    borderRadius: 1,
    backgroundColor: '#525963',
    overflow: 'hidden',
  },
  plankLit: { backgroundColor: '#E8B71F' },
  plankOver: { backgroundColor: '#D2564A' },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  trayEdge: {
    height: 4,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: colors.chipBorder,
  },
  label: { flexDirection: 'row', alignItems: 'center', gap: sp(2), minHeight: 18 },
  name: {
    color: '#565C64',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  nameEditable: {
    color: colors.textDim,
    borderBottomWidth: 1,
    borderBottomColor: colors.chipSelectedBorder,
    paddingBottom: 1,
  },
  nameInput: {
    width: 104,
    color: colors.amber,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.3,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    borderRadius: 4,
    paddingHorizontal: sp(1.5),
    paddingVertical: sp(0.75),
  },
  fill: { color: '#3D434B', fontFamily: mono, fontSize: 8.5 },
  fillOver: { color: colors.danger },
  overFix: {
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    borderRadius: radius.pill,
    paddingHorizontal: sp(2),
    paddingVertical: sp(0.75),
  },
  overFixLabel: { color: colors.amber, fontFamily: mono, fontWeight: '700', fontSize: 8.5 },
  actions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: sp(2.5) },
  remove: { color: colors.danger, fontFamily: mono, fontSize: 9 },
  width: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  widthButton: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  widthValue: { color: colors.amber, fontFamily: mono, fontWeight: '700', fontSize: 10 },
});
