import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
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
import { colors, mono, radius, shelf, sp } from '@/theme';

import { CARD_H, CARD_W } from './metrics';

/**
 * A bin standing on a shelf (D21).
 *
 * Drawn as an object rather than a list row: a lit top edge so it catches the
 * light from above like the plank does, and the short code in a recessed
 * label holder — the physical thing the printed tag slides into. Code and
 * name lead; the cover photo is a thumbnail in the corner when there is one,
 * because a photo of a closed grey tub identifies nothing on its own.
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
  const loud = state.focused || state.held;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onLayout={onLayout}
      style={[
        styles.card,
        heatStyle,
        state.match && styles.cardMatch,
        loud && styles.cardLoud,
        state.ghosted && styles.cardHole,
      ]}
      accessibilityRole="button"
      accessibilityLabel={describe(cell, state)}
      testID={`map-cell-${cell.code}`}
    >
      {state.ghosted ? null : <CardFace cell={cell} held={state.held} loud={loud} />}

      {state.held ? <HeldPulse /> : null}
      {state.settling ? <SettleRing /> : null}
    </Pressable>
  );
}

/**
 * What the card shows when the bin is actually standing there — everything
 * except the dashed hole a drag leaves behind. Its own component so the card
 * body stays a short list of states rather than a nest of them.
 */
function CardFace({ cell, held, loud }: { cell: MapCell; held: boolean; loud: boolean }) {
  return (
    <>
      <View style={styles.head}>
        <View style={styles.well}>
          {cell.photoUri ? (
            <Image source={{ uri: cell.photoUri }} style={styles.photo} contentFit="cover" />
          ) : (
            <Ionicons
              name={held ? 'move' : 'cube-outline'}
              size={13}
              color={loud ? colors.amberInkOn : colors.textFaint}
            />
          )}
        </View>
        <Text style={[styles.count, loud && styles.inkOn]} numberOfLines={1}>
          {held ? 'lifted' : countLabel(cell.items)}
        </Text>
      </View>

      <Text style={[styles.name, loud && styles.inkOnName]} numberOfLines={2}>
        {cell.name}
      </Text>

      {/* The recessed label holder: a dark well with the amber tag in it. */}
      <View style={[styles.holder, loud && styles.holderLoud]}>
        <View style={[styles.tag, loud && styles.tagLoud]}>
          <Text style={[styles.tagText, loud && styles.tagTextLoud]} numberOfLines={1}>
            {cell.code}
          </Text>
        </View>
      </View>
    </>
  );
}

/** A slow breath on the card in hand, so "still holding this" is visible. */
function HeldPulse() {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.22, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" style={[styles.pulse, style]} />;
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
  else if (state.holding) how = ' — tap to place the held bin in front of it';
  return `${what}${found}${how}`;
}

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    // Catches the light from above, like the plank it stands on.
    borderTopColor: shelf.plankLit,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    paddingHorizontal: sp(2),
    paddingTop: sp(2),
    paddingBottom: 7,
    gap: 4,
    // Sits on the shelf rather than floating over it.
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
  cardMatch: { borderWidth: 2, borderColor: colors.amber, borderTopColor: colors.amber },
  cardLoud: {
    backgroundColor: colors.amber,
    borderColor: colors.amber,
    borderTopColor: colors.amber,
  },
  /** The gap a dragged bin left behind — space, not a bin. */
  cardHole: {
    backgroundColor: colors.bg,
    borderColor: shelf.slotLabel,
    borderTopColor: shelf.slotLabel,
    borderStyle: 'dashed',
    borderWidth: 1,
    elevation: 0,
    shadowOpacity: 0,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  well: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: { width: 22, height: 22 },
  count: { flex: 1, color: colors.textFaint, fontFamily: mono, fontSize: 9.5 },
  name: { flex: 1, color: colors.text, fontSize: 11.5, lineHeight: 14 },
  inkOn: { color: colors.amberInkOn },
  inkOnName: { color: colors.amberInkOn, fontWeight: '600' },
  holder: {
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    padding: 2,
  },
  holderLoud: { backgroundColor: colors.amberInkOn, borderColor: colors.amberInkOn },
  tag: { backgroundColor: colors.amber, borderRadius: 2, paddingVertical: 1 },
  tagLoud: { backgroundColor: colors.amberInkOn },
  tagText: {
    textAlign: 'center',
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.4,
    color: colors.amberInkOn,
  },
  tagTextLoud: { color: colors.amber },
  pulse: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 5,
    backgroundColor: colors.bg,
  },
  settle: {
    position: 'absolute',
    left: -3,
    right: -3,
    top: -3,
    bottom: -3,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.amber,
  },
});
