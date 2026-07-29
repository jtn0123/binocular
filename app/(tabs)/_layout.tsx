import Ionicons from '@expo/vector-icons/Ionicons';
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
          // Home *is* search — the icon fills in when you are standing on it.
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'search' : 'search-outline'} size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color }) => <Ionicons name="camera" size={21} color={color} />,
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.amber, color: colors.amberInkOn },
        }}
      />
      <Tabs.Screen
        name="browse"
        options={{
          title: 'Browse',
          tabBarIcon: ({ color }) => (
            <Ionicons name="file-tray-stacked" size={21} color={color} />
          ),
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
          tabBarIcon: ({ color }) => <Ionicons name="map" size={21} color={color} />,
        }}
      />
    </Tabs>
  );
}
