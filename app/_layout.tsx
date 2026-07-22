import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { DbProvider } from '@/db/DbProvider';
import { navTheme } from '@/theme';

export default function RootLayout() {
  return (
    <DbProvider>
      <Stack screenOptions={navTheme}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="bin/[id]" options={{ title: 'Bin' }} />
        <Stack.Screen name="review/[scanId]" options={{ title: 'Review scan' }} />
        <Stack.Screen name="capture" options={{ headerShown: false }} />
        <Stack.Screen name="scan-code" options={{ headerShown: false }} />
        <Stack.Screen name="move/[binId]" options={{ title: 'Move bin' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
      <StatusBar style="light" />
    </DbProvider>
  );
}
