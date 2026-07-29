import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { MapCell } from '@/db/mapView';
import { colors, mono, sp } from '@/theme';

import { CARD_H, SLOT_MAX_W } from './metrics';

/**
 * The bin under the finger.
 *
 * Position comes straight off shared values written by the gesture worklet,
 * so the card tracks the finger on the UI thread and never waits for a React
 * render. Nothing else about the drag is animated this way — only the
 * transform has to keep up with a moving thumb.
 */
export function DragGhost({
  cell,
  x,
  y,
  scale,
  opacity,
}: {
  cell: MapCell;
  x: SharedValue<number>;
  y: SharedValue<number>;
  /** Lift-pop on pick-up, and the shrink back on a snap-back. */
  scale: SharedValue<number>;
  opacity: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, style]} testID="map-drag-ghost">
      <View style={styles.card}>
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
          {cell.items === 0 ? 'empty' : `${cell.items} item${cell.items === 1 ? '' : 's'}`}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, top: 0, zIndex: 25 },
  card: {
    width: SLOT_MAX_W,
    height: CARD_H,
    backgroundColor: '#2B2F35',
    borderWidth: 1,
    borderColor: colors.amber,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    paddingHorizontal: sp(2),
    paddingTop: sp(2),
    paddingBottom: 7,
    gap: 4,
    // Lifted clear of the shelf, so it reads as held rather than placed.
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.95,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 11 },
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  count: { flex: 1, color: colors.textDim, fontFamily: mono, fontSize: 9.5 },
  name: { flex: 1, color: colors.text, fontSize: 11.5, lineHeight: 14 },
  holder: {
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    padding: 2,
  },
  tag: { backgroundColor: colors.amber, borderRadius: 2, paddingVertical: 1 },
  tagText: {
    textAlign: 'center',
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.4,
    color: colors.amberInkOn,
  },
});
