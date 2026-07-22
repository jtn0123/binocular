import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, Tabs } from 'expo-router';
import { Pressable } from 'react-native';

import { colors, navTheme } from '@/theme';

function SettingsGear() {
  return (
    <Link href="/settings" asChild>
      <Pressable style={{ paddingHorizontal: 16 }} accessibilityLabel="Settings">
        <Ionicons name="settings-outline" size={22} color={colors.textDim} />
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        ...navTheme,
        headerRight: () => <SettingsGear />,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.surfaceSunken,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.amber,
        tabBarInactiveTintColor: colors.textFaint,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color, size }) => <Ionicons name="camera" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="browse"
        options={{
          title: 'Browse',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="file-tray-stacked" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
