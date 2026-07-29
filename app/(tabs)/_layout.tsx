import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDb } from '@/db/DbProvider';
import { countAttentionScans } from '@/db/queries';
import { colors } from '@/theme';

/**
 * The four tabs, and nothing else.
 *
 * No navigator header: each tab draws its own title bar (see
 * `ScreenHeader`), because the right-hand action belongs to the tab rather
 * than to the app — and because the map wants that 54pt back.
 *
 * The bar itself is the design's: 56pt, an icon over a small label, amber for
 * where you are and a dim grey for where you are not.
 */
/**
 * The tab icons, declared once at module scope.
 *
 * Written inline in `options` they are a fresh component type on every render
 * of the navigator, which makes React unmount and remount the icon rather than
 * update it. Naming them costs four lines and stops that.
 */
const ICON_SIZE = 21;
/** Home *is* search — the glass fills in when you are standing on it. */
function HomeIcon({ color, focused }: Readonly<{ color: ColorValue; focused: boolean }>) {
  return <Ionicons name={focused ? 'search' : 'search-outline'} size={ICON_SIZE} color={color as string} />;
}
function ScanIcon({ color }: Readonly<{ color: ColorValue }>) {
  return <Ionicons name="camera" size={ICON_SIZE} color={color as string} />;
}
function BrowseIcon({ color }: Readonly<{ color: ColorValue }>) {
  return <Ionicons name="file-tray-stacked" size={ICON_SIZE} color={color as string} />;
}
function MapIcon({ color }: Readonly<{ color: ColorValue }>) {
  return <Ionicons name="map" size={ICON_SIZE} color={color as string} />;
}

export default function TabsLayout() {
  const db = useDb();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const read = () => setPending(countAttentionScans(db));
    read();
    const interval = setInterval(read, 3000);
    return () => clearInterval(interval);
  }, [db]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          // 56pt of bar, plus whatever the gesture area needs under it —
          // a flat 56 clips the labels on a phone with a home indicator.
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: colors.surfaceSunken,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarLabelStyle: { fontSize: 10, marginTop: 3 },
        tabBarActiveTintColor: colors.amber,
        tabBarInactiveTintColor: colors.textFaint,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: HomeIcon,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ScanIcon,
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.amber, color: colors.amberInkOn },
        }}
      />
      <Tabs.Screen
        name="browse"
        options={{
          title: 'Browse',
          tabBarIcon: BrowseIcon,
        }}
      />
      {/*
        The map is a tab rather than a screen you get sent to (D21): it is
        where the workshop is arranged, not just a picture of it, and
        arranging is something you go and do. Browse stays the searchable
        list. Deep links still work — `/map?highlight=…` resolves here,
        because the `(tabs)` group is not part of the path.
      */}
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: MapIcon,
        }}
      />
    </Tabs>
  );
}
