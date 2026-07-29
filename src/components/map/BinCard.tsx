import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { MapCell } from '@/db/mapView';
import { colors, mono } from '@/theme';

import { CARD_H, SLOT_MAX_W } from './metrics';

/**
 * A bin standing on a shelf (D21, v3).
 *
 * Drawn as the object it is: a lit top edge catching the light like the plank
 * under it, and the short code in a recessed label holder at the *top* — the
 * printed tag sits in a slot on the front face of a real bin, which is what
 * you read first when you scan a shelf. Name below it, item count at the foot.
 *
 * No cover photo here, deliberately. A cell is 76pt wide at most; a thumbnail
 * of a closed grey tub costs a third of that and identifies nothing. The photo
 * belongs on bin detail, where it is big enough to recognise.
 *
 * Every loud state — found, held, dragged, just-landed — is an *overlay* over
 * the resting card rather than a restyle of it. That keeps one card body with
 * one border, and sidesteps the Android quirk where a border that has been
 * dashed once stays dashed (see `styles.card`).
 */
export interface BinCardState {
  /** One of several search matches: outlined, so they can all glow at once. */
  match: boolean;
  /** The match the banner is currently on: filled, unmissable. */
  focused: boolean;
  /** In hand — lifted by a hold, whether or not a drag followed. */
  held: boolean;
  /** Being dragged: this is the hole it left, the ghost is under the finger. */
  ghosted: boolean;
  /** Just landed here — a ring that fades, so the eye can follow the move. */
  settling: boolean;
  /** True while any bin is held, which changes what a tap means. */
  holding: boolean;
  /** Picked for a group move: ticked, and moving with the others. */
  selected?: boolean;
}

export function BinCard({
  cell,
  state,
  heatStyle,
  onPress,
  onLongPress,
  onLayout,
}: {
  cell: MapCell;
  state: BinCardState;
  heatStyle: ViewStyle | null;
  onPress: () => void;
  onLongPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  // The loud face pulses, so anything underneath shows through it — and the
  // resting card puts its code at the top where the loud one puts its name.
  // Drawing both at once reads as doubled text rather than as breathing.
  const loud = state.focused || state.held;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onLayout={onLayout}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={describe(cell, state)}
      testID={`map-cell-${cell.code}`}
    >
      {loud ? null : (
        <>
          {/* The recessed label holder: a dark well with the amber tag in it. */}
          <View style={styles.holder}>
            <View style={styles.tag}>
              <Text style={styles.tagText} numberOfLines={1}>
                {cell.code}
              </Text>
            </View>
          </View>

          <Text style={styles.name} numberOfLines={3}>
            {cell.name}
          </Text>

          <Text style={styles.count} numberOfLines={1}>
            {countLabel(cell.items)}
          </Text>
        </>
      )}

      {heatStyle ? <View pointerEvents="none" style={[styles.tint, heatStyle]} /> : null}

      {state.match && !state.focused ? (
        <View pointerEvents="none" style={styles.matchRing} />
      ) : null}

      {state.selected && !state.focused && !state.held ? (
        <View pointerEvents="none" style={styles.picked} testID={`map-picked-${cell.code}`}>
          <Ionicons name="checkmark-circle" size={14} color={colors.amber} />
        </View>
      ) : null}

      {state.focused && !state.held ? <LoudFace cell={cell} icon="locate" /> : null}
      {state.held ? <HeldFace cell={cell} /> : null}
      {state.ghosted ? <View pointerEvents="none" style={styles.hole} /> : null}
      {state.settling ? <SettleRing /> : null}
    </Pressable>
  );
}

/**
 * The card turned inside out in amber: what a bin looks like when it is the
 * answer to the question you asked, or the thing in your hand.
 */
function LoudFace({ cell, icon }: { cell: MapCell; icon: 'locate' | 'move' }) {
  return (
    <View pointerEvents="none" style={styles.loud}>
      <Ionicons name={icon} size={12} color={colors.amberInkOn} />
      <Text style={styles.loudName} numberOfLines={3}>
        {cell.name}
      </Text>
      <Text style={styles.loudCode} numberOfLines={1}>
        {cell.code}
      </Text>
    </View>
  );
}

/** The bin in hand: the loud face, breathing, so "still holding this" shows. */
function HeldFace({ cell }: { cell: MapCell }) {
  const opacity = useSharedValue(0.95);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.78, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" style={[styles.loud, style]}>
      <Ionicons name="move" size={12} color={colors.amberInkOn} />
      <Text style={styles.loudName} numberOfLines={3}>
        {cell.name}
      </Text>
      <Text style={styles.loudCode} numberOfLines={1}>
        {cell.code}
      </Text>
    </Animated.View>
  );
}

/** A ring that blooms and fades where a bin just landed. */
function SettleRing() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSequence(
      withTiming(1, { duration: 120 }),
      withTiming(0, { duration: 400 }),
    );
    return () => cancelAnimation(progress);
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 1 + progress.value * 0.06 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.settle, style]} testID="map-settle-ring" />
  );
}

function countLabel(items: number): string {
  if (items === 0) return 'empty';
  return `${items} item${items === 1 ? '' : 's'}`;
}

function describe(cell: MapCell, state: BinCardState): string {
  const what = `${cell.code} ${cell.name}, ${countLabel(cell.items)}`;
  const found = state.match || state.focused ? ' — a bin you are looking for' : '';
  let how = '. Hold to pick it up';
  if (state.held) how = ' — in hand, tap to put it back down';
  else if (state.selected) how = ' — picked to move, tap to unpick it';
  else if (state.holding) how = ' — tap to place the held bin in front of it';
  return `${what}${found}${how}`;
}

const styles = StyleSheet.create({
  card: {
    // Shares the row with its neighbours rather than holding a fixed width:
    // a rack is a grid, and a shelf you scroll is one you cannot count.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    maxWidth: SLOT_MAX_W,
    height: CARD_H,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: '#4A515A',
    // Catches the light from above, like the plank it stands on.
    borderTopColor: '#5A626C',
    // Restated so a state that draws dashes cannot leave them behind: on
    // Android a border keeps `dashed` when the next style merely omits it.
    borderStyle: 'solid',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    padding: 6,
    gap: 4,
    // Sits on the shelf rather than floating over it.
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  holder: {
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    padding: 2,
  },
  tag: { backgroundColor: colors.amber, borderRadius: 2, paddingVertical: 1, overflow: 'hidden' },
  tagText: {
    textAlign: 'center',
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 9,
    letterSpacing: 0.4,
    color: colors.amberInkOn,
  },
  name: { flex: 1, color: colors.text, fontSize: 9.5, lineHeight: 12 },
  count: { color: '#565C64', fontFamily: mono, fontSize: 8.5 },

  tint: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 5 },
  matchRing: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: colors.amber,
    borderRadius: 5,
  },
  picked: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: colors.amber,
    borderRadius: 5,
    backgroundColor: 'rgba(255,196,0,0.14)',
    alignItems: 'flex-end',
    padding: 3,
  },
  /** Found, or in hand: the whole face goes amber. */
  loud: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.amber,
    borderWidth: 2,
    borderColor: colors.amber,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    padding: 5,
    gap: 3,
  },
  loudName: {
    flex: 1,
    color: colors.amberInkOn,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '600',
  },
  loudCode: { color: colors.amberInkOn, fontFamily: mono, fontWeight: '700', fontSize: 8.5 },
  /** The gap a dragged bin left behind — space, not a bin. */
  hole: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#565C64',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  settle: {
    position: 'absolute',
    left: -3,
    right: -3,
    top: -3,
    bottom: -3,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.amber,
  },
});

/** Shared by the free-slot placeholders, so a gap is exactly a cell wide. */
export const slotBox: ViewStyle = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  minWidth: 0,
  maxWidth: SLOT_MAX_W,
  height: CARD_H,
};
