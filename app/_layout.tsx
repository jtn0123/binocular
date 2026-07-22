import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { DbProvider } from '@/db/DbProvider';

export default function RootLayout() {
  return (
    <DbProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="bin/[id]" options={{ title: 'Bin' }} />
        <Stack.Screen name="review/[scanId]" options={{ title: 'Review scan' }} />
      </Stack>
      <StatusBar style="auto" />
    </DbProvider>
  );
}
