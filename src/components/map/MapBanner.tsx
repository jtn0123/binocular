import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MapCell } from '@/db/mapView';
import { plural } from '@/lib/text';
import { colors, mono, radius, sp } from '@/theme';

/**
 * What the map is doing, when it is doing something.
 *
 * Two bars, in two places, because they answer two different questions.
 *
 * **At rest there is neither.** The map says nothing when nothing is
 * happening — the wall is the content, and a permanent line of chrome above
 * it explaining that the wall is a wall costs a shelf and earns nothing.
 *
 * `MapCarryBar` floats *over* the panel while a bin is in hand, so the
 * shelves do not jump the moment you pick one up — the row you were aiming
 * at has to stay where it was. `MapFindBar` sits in the flow, because a
 * search result is a thing you read rather than something you are holding,
 * and the panel can afford to shift once.
 *
 * Both are live regions: they are the only thing that says what the map is
 * doing, so a screen reader that has to be navigated to them hears about a
 * lift or a landing slot only by accident.
 */
export interface MapCarryBarProps {
  /** Under the finger right now. */
  dragged: MapCell | null;
  /** "Garage › Shelf B", or null when the finger is over no shelf. */
  targetName: string | null;
  /** 1-based; null when the target came from an out-of-panel drop zone. */
  targetSlot: number | null;
  viaWall: boolean;
  /** Over a side rail: what releasing there would do. */
  edgeHint: string | null;
  /** Lifted but not being dragged. */
  held: boolean;
  heldLabel: string;
  /** How the held bin can be put down — changes once a stack is in hand. */
  heldHint: string;
  onCancelHold: () => void;
  /** Offers to pick more bins up before placing; null when it cannot. */
  onSelectMore: (() => void) | null;
  /** Picking bins for a group move. */
  picking: boolean;
  pickedCount: number;
  onMovePicked: () => void;
  onClearPicked: () => void;
}

export function MapCarryBar(props: Readonly<MapCarryBarProps>) {
  if (props.dragged) return <DragBar {...props} dragged={props.dragged} />;
  if (props.held) return <HeldBar {...props} />;
  if (props.picking) return <PickBar {...props} />;
  return null;
}

function DragBar({
  dragged,
  targetName,
  targetSlot,
  viaWall,
  edgeHint,
}: Readonly<
  Pick<MapCarryBarProps, 'targetName' | 'targetSlot' | 'viaWall' | 'edgeHint'> & {
    dragged: MapCell;
  }
>) {
  return (
    // Untouchable on purpose: it hangs over the shelves mid-drag, and a bar
    // that swallowed the finger would cancel the move it is describing.
    <View
      pointerEvents="none"
      style={[styles.floating, styles.carry]}
      accessibilityLiveRegion="polite"
      testID="map-banner-drag"
    >
      <Ionicons name="move" size={18} color={colors.amber} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          Moving {dragged.code} · {dragged.name}
        </Text>
        <Text style={styles.where} numberOfLines={2}>
          {edgeHint ??
            (targetName === null
              ? 'Drop on a shelf, or on a side rail to send it to another rack'
              : viaWall
                ? `Drops at the end of ${targetName}`
                : `Lands in ${targetName}, slot ${targetSlot}`)}
        </Text>
      </View>
    </View>
  );
}

function HeldBar({
  heldLabel,
  heldHint,
  onCancelHold,
  onSelectMore,
}: Readonly<Pick<MapCarryBarProps, 'heldLabel' | 'heldHint' | 'onCancelHold' | 'onSelectMore'>>) {
  return (
    <View style={[styles.floating, styles.carry]} accessibilityLiveRegion="polite">
      <Ionicons name="move" size={18} color={colors.amber} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {heldLabel}
        </Text>
        <Text style={styles.where} numberOfLines={2}>
          {heldHint}
        </Text>
      </View>
      {onSelectMore ? (
        <Pressable
          style={styles.more}
          onPress={onSelectMore}
          accessibilityRole="button"
          accessibilityLabel="Pick more bins to move with this one"
          testID="map-select-more"
        >
          <Ionicons name="layers-outline" size={13} color={colors.amber} />
          <Text style={styles.moreLabel}>Select more</Text>
        </Pressable>
      ) : null}
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

/**
 * Picking a stack. Deliberately not the carrying bar: nothing is in hand yet,
 * and saying so is what makes the second tap on a bin read as "also this one"
 * rather than "put it here".
 */
function PickBar({
  pickedCount,
  onMovePicked,
  onClearPicked,
}: Readonly<Pick<MapCarryBarProps, 'pickedCount' | 'onMovePicked' | 'onClearPicked'>>) {
  return (
    <View
      style={[styles.floating, styles.picking]}
      accessibilityLiveRegion="polite"
      testID="map-banner-pick"
    >
      <Ionicons name="layers" size={18} color={colors.amber} />
      <Text style={styles.summary} numberOfLines={2}>
        {pickedCount > 0 ? `${plural(pickedCount, 'bin')} picked` : 'Tap the bins you want to move'}
      </Text>
      {pickedCount > 0 ? (
        <Pressable
          style={styles.moveThem}
          onPress={onMovePicked}
          accessibilityRole="button"
          accessibilityLabel={`Move the ${plural(pickedCount, 'picked bin')}`}
          testID="map-move-picked"
        >
          <Text style={styles.moveThemLabel}>Move them</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onClearPicked}
        accessibilityRole="button"
        accessibilityLabel="Stop picking bins"
        hitSlop={8}
        testID="map-clear-picked"
      >
        <Ionicons name="close-circle" size={22} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

export interface MapFindBarProps {
  focused: { code: string; name: string; where: string } | null;
  findCount: number;
  findIndex: number;
  onStepFocus: () => void;
  /** Searching with a query that matched nothing. */
  searching: boolean;
  query: string;
  /** Sent here to find a bin that is not drawn. */
  wantedButMissing: boolean;
}

/** The answer to a search, in the flow above the panel. */
export function MapFindBar(props: Readonly<MapFindBarProps>) {
  if (props.focused) {
    return (
      <View style={[styles.inFlow, styles.found]} accessibilityLiveRegion="polite">
        <Ionicons name="locate" size={18} color={colors.amber} />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {props.focused.code} · {props.focused.name}
          </Text>
          <Text style={styles.where} numberOfLines={1}>
            {props.focused.where}
          </Text>
        </View>
        {props.findCount > 1 ? (
          <Pressable
            style={styles.next}
            onPress={props.onStepFocus}
            accessibilityRole="button"
            accessibilityLabel={`Match ${props.findIndex + 1} of ${props.findCount}. Show the next one`}
            testID="map-next-match"
          >
            <Text style={styles.nextCount}>
              {props.findIndex + 1}/{props.findCount}
            </Text>
            <Ionicons name="chevron-forward-circle" size={20} color={colors.amber} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (props.searching) {
    return (
      <View
        style={[styles.inFlow, styles.quiet]}
        accessibilityLiveRegion="polite"
        testID="map-banner-nohits"
      >
        <Ionicons name="search-outline" size={18} color={colors.textFaint} />
        <Text style={styles.plain}>Nothing on the shelves matches “{props.query}”.</Text>
      </View>
    );
  }

  if (props.wantedButMissing) {
    return (
      <View style={[styles.inFlow, styles.found]} accessibilityLiveRegion="polite">
        <Ionicons name="help-circle-outline" size={18} color={colors.textDim} />
        <Text style={styles.plain}>That bin is not on the map.</Text>
      </View>
    );
  }

  // At rest the map says nothing at all.
  return null;
}

const bar = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: sp(2.5),
  minHeight: 54,
  borderWidth: 1,
  borderStyle: 'solid',
  paddingHorizontal: sp(3),
  paddingVertical: sp(2.5),
} as const;

const styles = StyleSheet.create({
  /** Hangs over the shelves, so the panel never reflows mid-move. */
  floating: {
    ...bar,
    position: 'absolute',
    left: sp(4),
    right: sp(4),
    top: sp(2),
    zIndex: 26,
    borderRadius: radius.md,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  carry: {
    backgroundColor: 'rgba(58,53,36,0.97)',
    borderColor: colors.chipSelectedBorder,
    borderStyle: 'dashed',
  },
  picking: { backgroundColor: 'rgba(38,42,47,0.97)', borderColor: colors.borderStrong },
  inFlow: { ...bar, marginHorizontal: sp(4), marginBottom: sp(2.5), borderRadius: radius.md },
  found: { backgroundColor: colors.chipSelectedBg, borderColor: colors.chipSelectedBorder },
  quiet: { backgroundColor: '#1A1D20', borderColor: colors.border },
  text: { flex: 1, gap: 2 },
  name: { color: colors.amber, fontFamily: mono, fontSize: 13 },
  summary: { flex: 1, color: colors.text, fontSize: 12.5, lineHeight: 17 },
  plain: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 16 },
  where: { color: colors.textDim, fontSize: 11.5, lineHeight: 15 },
  next: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  nextCount: { color: colors.amber, fontFamily: mono, fontSize: 12 },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.25),
    minHeight: 36,
    paddingHorizontal: sp(3),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
  },
  moreLabel: { color: colors.amber, fontSize: 11.5, fontWeight: '600' },
  moveThem: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: sp(3.25),
    borderRadius: 8,
    backgroundColor: colors.amber,
  },
  moveThemLabel: { color: colors.amberInkOn, fontSize: 11, fontWeight: '800' },
});
