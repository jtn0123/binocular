import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MapPrefs } from '@/settings/mapPrefs';
import { colors, radius, sp } from '@/theme';

import { MapSettings } from './MapSettings';

/**
 * The map's two switches, on the map (v3).
 *
 * They also live in Settings, and they still should — but the moment you need
 * the drag switch is the moment the map is misbehaving under your thumb, and
 * a trip through Settings to find it is exactly the tax that makes someone
 * put the phone down instead. Same component, same preferences; only the
 * route to them is new.
 */
export function MapSettingsSheet({
  visible,
  prefs,
  onChange,
  onClose,
}: Readonly<{
  visible: boolean;
  prefs: MapPrefs;
  onChange: <K extends keyof MapPrefs>(key: K, value: MapPrefs[K]) => void;
  onClose: () => void;
}>) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet} testID="map-settings-sheet">
        <View style={styles.grabber} />
        <MapSettings prefs={prefs} onChange={onChange} />
        <Pressable
          style={styles.done}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Done"
          testID="map-settings-done"
        >
          <Text style={styles.doneLabel}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.64)' },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: sp(5),
    paddingTop: sp(3.5),
    paddingBottom: sp(6),
    gap: sp(5),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
  },
  done: {
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    paddingVertical: sp(3.25),
    alignItems: 'center',
  },
  doneLabel: { color: colors.amberInkOn, fontSize: 14, fontWeight: '800' },
});
