import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, sp } from '@/theme';

/**
 * A tab's own title bar.
 *
 * The tabs draw their headers rather than letting the navigator do it, for
 * two reasons. The navigator's header is a fixed slab on every screen, and
 * the map wants that height back — it is a picture of a wall, and 54pt of
 * chrome is half a shelf. And each tab's right-hand action belongs to the
 * tab, not to the app: Browse offers a new bin, Home offers Settings, Scan
 * offers nothing at all. A single `headerRight` cannot say that.
 *
 * The status-bar inset is padded here rather than by a wrapping SafeAreaView,
 * so the bar's own 54pt height stays exactly 54pt on every device.
 */
export function ScreenHeader({
  title,
  action,
}: Readonly<{
  title: string;
  /** The one thing this tab offers from its title bar, if it offers anything. */
  action?: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    /** Amber for an action that adds something; dim for one that navigates. */
    tone?: 'amber' | 'dim';
    testID?: string;
  } | null;
}>) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {action ? (
          <Pressable
            onPress={action.onPress}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            testID={action.testID}
          >
            <Ionicons
              name={action.icon}
              size={action.tone === 'amber' ? 22 : 20}
              color={action.tone === 'amber' ? colors.amber : colors.textDim}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A pushed screen's title bar: back, then what you are looking at.
 *
 * Slimmer and quieter than the navigator's, which puts a 24pt title in a 90pt
 * slab — on bin detail that is a third of the first screenful spent saying
 * the name of the thing you just tapped.
 */
export function DetailHeader({
  title,
  onBack,
  testID,
}: Readonly<{
  title: string;
  onBack: () => void;
  testID?: string;
}>) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.detailRow}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID={testID}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.detailTitle} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

/**
 * The same status-bar inset with no title bar over it — for a screen whose
 * first row is its own controls, like the map.
 */
export function ScreenTop() {
  const insets = useSafeAreaInsets();
  return <View style={{ paddingTop: insets.top }} />;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.bg },
  row: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp(4),
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  detailRow: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
    paddingHorizontal: sp(3),
  },
  detailTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
});
