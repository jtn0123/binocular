import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DbProvider } from '@/db/DbProvider';
import { DiagnosticsRunner } from '@/diagnostics/DiagnosticsRunner';
import { QueueRunner } from '@/queue/QueueRunner';
import { navTheme } from '@/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DbProvider>
      <QueueRunner />
      <DiagnosticsRunner />
      <Stack screenOptions={navTheme}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="bin/[id]" options={{ title: 'Bin' }} />
        <Stack.Screen name="review/[scanId]" options={{ title: 'Review scan' }} />
        <Stack.Screen name="capture" options={{ headerShown: false }} />
        <Stack.Screen name="scan-code" options={{ headerShown: false }} />
        <Stack.Screen name="move/[binId]" options={{ title: 'Move bin' }} />
        <Stack.Screen name="queue" options={{ title: 'Scan queue' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="diagnostics" options={{ title: 'Diagnostics' }} />
        <Stack.Screen name="visual-memory" options={{ title: 'Match strength' }} />
        <Stack.Screen name="photo" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="map" options={{ title: 'Map' }} />
        <Stack.Screen name="trash" options={{ title: 'Recently deleted' }} />
        <Stack.Screen name="bin-photo/[id]" options={{ headerShown: false }} />
      </Stack>
        <StatusBar style="light" />
      </DbProvider>
    </GestureHandlerRootView>
  );
}
