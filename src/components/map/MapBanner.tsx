import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MapCell } from '@/db/mapView';
import { colors, mono, radius, sp } from '@/theme';

/**
 * One line above the shelves that always says what the map is doing.
 *
 * Idle it names the workshop; holding, it names the bin in your hand;
 * dragging, the exact slot the bin would land in; searching, which match of
 * how many. The states are exclusive on purpose — two banners stacked is how
 * the previous version lost the one that mattered.
 *
 * Every state is a live region: this line is the only thing that says what the
 * map is doing, so a screen reader that has to be navigated to it hears about
 * a lift or a landing slot only by accident.
 */
export interface MapBannerProps {
  /** Under the finger right now. */
  dragged: MapCell | null;
  /** "Garage › Shelf B", or null when the finger is over no shelf. */
  targetName: string | null;
  /** 1-based; null when the target came from the wall strip. */
  targetSlot: number | null;
  viaWall: boolean;
  /** Lifted but not being dragged. */
  held: boolean;
  heldLabel: string;
  onCancelHold: () => void;
  focused: { code: string; name: string; where: string } | null;
  findCount: number;
  findIndex: number;
  onStepFocus: () => void;
  /** Searching with a query that matched nothing. */
  searching: boolean;
  query: string;
  /** Sent here to find a bin that is not drawn. */
  wantedButMissing: boolean;
  summary: string;
}

export function MapBanner(props: MapBannerProps) {
  if (props.dragged) return <DragBanner {...props} dragged={props.dragged} />;
  if (props.held) return <HeldBanner {...props} />;
  if (props.focused) return <FoundBanner {...props} focused={props.focused} />;

  if (props.searching) {
    return (
      <View style={styles.quiet} accessibilityLiveRegion="polite" testID="map-banner-nohits">
        <Ionicons name="search-outline" size={18} color={colors.textFaint} />
        <Text style={styles.where}>Nothing on the shelves matches “{props.query}”.</Text>
      </View>
    );
  }

  if (props.wantedButMissing) {
    return (
      <View style={styles.banner} accessibilityLiveRegion="polite">
        <Ionicons name="help-circle-outline" size={18} color={colors.textDim} />
        <Text style={styles.where}>That bin is not on the map.</Text>
      </View>
    );
  }

  return (
    <View style={styles.quiet} accessibilityLiveRegion="polite">
      <Ionicons name="hand-left-outline" size={18} color={colors.textDim} />
      <View style={styles.text}>
        <Text style={styles.summary} numberOfLines={1}>
          {props.summary}
        </Text>
        <Text style={styles.where} numberOfLines={1}>
          Drag a bin to rearrange. The map is the arrangement.
        </Text>
      </View>
    </View>
  );
}

function DragBanner({
  dragged,
  targetName,
  targetSlot,
  viaWall,
}: MapBannerProps & { dragged: MapCell }) {
  return (
    <View
      style={[styles.banner, styles.active]}
      accessibilityLiveRegion="polite"
      testID="map-banner-drag"
    >
      <Ionicons name="move" size={18} color={colors.amber} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          Moving {dragged.code} · {dragged.name}
        </Text>
        <Text style={styles.where} numberOfLines={2}>
          {targetName === null
            ? 'Release away from a shelf to cancel'
            : viaWall
              ? `Drop on the wall strip → end of ${targetName}`
              : `Lands in ${targetName}, slot ${targetSlot}`}
        </Text>
      </View>
    </View>
  );
}

function HeldBanner({ heldLabel, onCancelHold }: MapBannerProps) {
  return (
    <View style={[styles.banner, styles.active]} accessibilityLiveRegion="polite">
      <Ionicons name="move" size={18} color={colors.amber} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {heldLabel}
        </Text>
        <Text style={styles.where} numberOfLines={2}>
          Tap a bin to slide in front of it, or a slot to drop there.
        </Text>
      </View>
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

function FoundBanner({
  focused,
  findCount,
  findIndex,
  onStepFocus,
}: MapBannerProps & { focused: { code: string; name: string; where: string } }) {
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Ionicons name="locate" size={18} color={colors.amber} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {focused.code} · {focused.name}
        </Text>
        <Text style={styles.where} numberOfLines={1}>
          {focused.where}
        </Text>
      </View>
      {findCount > 1 ? (
        <Pressable
          style={styles.next}
          onPress={onStepFocus}
          accessibilityRole="button"
          accessibilityLabel={`Match ${findIndex + 1} of ${findCount}. Show the next one`}
          testID="map-next-match"
        >
          <Text style={styles.nextCount}>
            {findIndex + 1}/{findCount}
          </Text>
          <Ionicons name="chevron-forward-circle" size={20} color={colors.amber} />
        </Pressable>
      ) : null}
    </View>
  );
}

const base = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: sp(2.5),
  marginHorizontal: sp(4),
  marginBottom: sp(2.5),
  borderWidth: 1,
  borderRadius: radius.md,
  padding: sp(3),
  minHeight: 54,
} as const;

const styles = StyleSheet.create({
  banner: {
    ...base,
    backgroundColor: colors.chipSelectedBg,
    borderColor: colors.chipSelectedBorder,
  },
  quiet: { ...base, backgroundColor: '#1A1D20', borderColor: colors.border },
  active: { borderStyle: 'dashed' },
  text: { flex: 1, gap: 2 },
  name: { color: colors.amber, fontFamily: mono, fontSize: 13 },
  summary: { color: colors.text, fontFamily: mono, fontSize: 13 },
  where: { color: colors.textDim, fontSize: 11.5, lineHeight: 15 },
  next: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  nextCount: { color: colors.amber, fontFamily: mono, fontSize: 12 },
});
