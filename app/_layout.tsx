import * as Clipboard from 'expo-clipboard';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DbProvider } from '@/db/DbProvider';
import { DiagnosticsRunner } from '@/diagnostics/DiagnosticsRunner';
import { QueueRunner } from '@/queue/QueueRunner';
import { colors, mono, navTheme, radius, sp, type } from '@/theme';

/**
 * The last resort, and the only one that covers boot.
 *
 * `DbProvider` runs migrations synchronously inside a `useState` initializer
 * (src/db/DbProvider.tsx:19-25), so a failed migration throws during the very
 * first render. Every other screen in the app sits below this point, which
 * meant a boot throw was a blank rectangle — no message, no diagnostics, and
 * the backup locked inside an app that would not start. On a field-test phone
 * with no Metro console that is unrecoverable without reinstalling, which
 * deletes the workshop.
 *
 * So this deliberately depends on nothing: no database, no theme provider, no
 * navigation. Clipboard only, because a user who cannot open the app also
 * cannot use Share diagnostics — and the error text is the whole diagnosis.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const details = [error?.message ?? String(error), error?.stack ?? '']
    .filter(Boolean)
    .join('\n\n');

  return (
    <ScrollView contentContainerStyle={styles.center}>
      <Text style={styles.title}>Binocular could not start.</Text>
      <Text style={styles.body} selectable>
        {error?.message ?? String(error)}
      </Text>
      {error?.stack ? (
        <Text style={styles.stack} selectable>
          {error.stack.split('\n').slice(0, 10).join('\n')}
        </Text>
      ) : null}

      <Pressable
        style={styles.primary}
        onPress={() => void retry()}
        accessibilityRole="button"
        accessibilityLabel="Try starting again"
        testID="boot-retry"
      >
        <Text style={styles.primaryLabel}>Try again</Text>
      </Pressable>
      <Pressable
        style={styles.secondary}
        onPress={() => void Clipboard.setStringAsync(details)}
        accessibilityRole="button"
        accessibilityLabel="Copy the error"
        testID="boot-copy"
      >
        <Text style={styles.secondaryLabel}>Copy the error</Text>
      </Pressable>

      <Text style={styles.dim}>
        Your bins, items and photos are still on the device — this is a startup
        failure, not data loss. Do not uninstall: that is what would delete
        them. Copy the error above and it can be diagnosed from the text alone.
      </Text>
    </ScrollView>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DbProvider>
        <QueueRunner />
        <DiagnosticsRunner />
        <Stack screenOptions={navTheme}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* Draws its own slim header, per the design. */}
          <Stack.Screen name="bin/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="review/[scanId]" options={{ title: 'Review scan' }} />
          <Stack.Screen name="capture" options={{ headerShown: false }} />
          <Stack.Screen name="scan-code" options={{ headerShown: false }} />
          <Stack.Screen name="move/[binId]" options={{ title: 'Move bin' }} />
          <Stack.Screen name="queue" options={{ title: 'Scan queue' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="diagnostics" options={{ title: 'Diagnostics' }} />
          <Stack.Screen name="visual-memory" options={{ title: 'Match strength' }} />
          <Stack.Screen
            name="photo"
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen name="trash" options={{ title: 'Recently deleted' }} />
          <Stack.Screen name="bin-photo/[id]" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="light" />
      </DbProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: sp(3),
    padding: sp(6),
    backgroundColor: colors.bg,
  },
  title: { color: colors.danger, fontSize: 20, fontWeight: '700' },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  stack: { fontFamily: mono, fontSize: 10, lineHeight: 14, color: colors.textFaint },
  primary: {
    alignSelf: 'flex-start',
    backgroundColor: colors.amber,
    paddingHorizontal: sp(4.5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  primaryLabel: { color: colors.amberInkOn, fontWeight: '700' },
  secondary: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: sp(4.5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  secondaryLabel: { color: colors.steel, fontWeight: '600' },
  dim: { ...type.dim, lineHeight: 18 },
});
