import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors, mono, radius, sp } from '@/theme';
import { plural } from '@/lib/text';

/**
 * Where the other matches are (v3).
 *
 * Search spans the whole wall but the map shows one rack, so a rack with no
 * hits would otherwise look empty-handed while three bins two racks over are
 * lit up. This says how many are here and offers the ones that are not,
 * by rack, as somewhere to go.
 */
export interface RackHit {
  /** Index along the wall — what tapping the chip pages to. */
  index: number;
  code: string;
  count: number;
}

export function HitsBar({
  hereCount,
  elsewhere,
  onGo,
}: Readonly<{
  hereCount: number;
  elsewhere: readonly RackHit[];
  onGo: (index: number) => void;
}>) {
  if (elsewhere.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Without this a horizontal ScrollView inside a flex column claims all
      // the leftover height, and the chips end up marooned in the middle of
      // the screen with the shelves squeezed underneath them.
      style={styles.strip}
      contentContainerStyle={styles.bar}
      testID="map-hits-bar"
    >
      <Text style={styles.here}>
        {hereCount > 0 ? `${plural(hereCount, 'hit')} here ·` : 'none in this rack ·'}
      </Text>
      {elsewhere.map((hit) => (
        <Pressable
          key={hit.code}
          style={styles.chip}
          onPress={() => onGo(hit.index)}
          accessibilityRole="button"
          accessibilityLabel={`${plural(hit.count, 'match', 'matches')} on rack ${hit.code}. Go there`}
          testID={`map-hit-${hit.code}`}
        >
          <Text style={styles.chipText}>
            {hit.code} · {hit.count}
          </Text>
          <Ionicons name="chevron-forward" size={9} color={colors.amber} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { flexGrow: 0, flexShrink: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.75),
    paddingHorizontal: sp(4),
    paddingBottom: sp(2),
  },
  here: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.25),
    minHeight: 30,
    paddingHorizontal: sp(2.5),
    borderRadius: radius.pill,
    backgroundColor: colors.chipSelectedBg,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
  },
  chipText: { color: colors.amber, fontFamily: mono, fontWeight: '700', fontSize: 10 },
});
