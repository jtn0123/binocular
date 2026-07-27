import type { ErrorBoundaryProps } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors, mono, radius, sp, type } from '@/theme';

/**
 * A field-test phone has no Metro console, so a screen that throws is just a
 * blank rectangle. expo-router renders this in the route's place instead, and
 * the message is selectable because reading it out loud over the phone was
 * how the last two map crashes were actually diagnosed.
 */
export function MapErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView contentContainerStyle={styles.center}>
      <Text style={styles.title}>The map could not be drawn.</Text>
      <Text style={styles.message} selectable>
        {error?.message ?? String(error)}
      </Text>
      {error?.stack ? (
        <Text style={styles.stack} selectable>
          {error.stack.split('\n').slice(0, 8).join('\n')}
        </Text>
      ) : null}
      <Pressable
        style={styles.retry}
        onPress={() => void retry()}
        accessibilityRole="button"
        accessibilityLabel="Try drawing the map again"
        testID="map-retry"
      >
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
      <Text style={styles.dim}>
        Settings › Open diagnostics keeps a copy of this, and can copy it out.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: sp(6),
    gap: sp(3),
    backgroundColor: colors.bg,
  },
  dim: { ...type.dim, textAlign: 'center', lineHeight: 20 },
  title: { ...type.h2, textAlign: 'center' },
  message: { color: colors.danger, fontFamily: mono, fontSize: 13, lineHeight: 18 },
  stack: { color: colors.textFaint, fontFamily: mono, fontSize: 10, lineHeight: 14 },
  retry: {
    alignSelf: 'center',
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    paddingHorizontal: sp(5),
    paddingVertical: sp(2.5),
  },
  retryText: { color: colors.amberInkOn, fontWeight: '800' },
});
