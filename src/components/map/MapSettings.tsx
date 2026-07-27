import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, sp, type } from '@/theme';

import type { MapPrefs } from '../../settings/mapPrefs';

/**
 * The map's settings.
 *
 * The drag switch is the load-bearing one. A finger-following drag was built
 * once, shipped to the field phone and withdrawn the same day when it killed
 * the process (docs/PLAN.md, "Map customization › Withdrawn"). The rebuild
 * uses one gesture detector for the whole map rather than one per cell, which
 * is the specific thing believed to have caused it — but believed is not
 * tested, so it can be turned off, and the map stays fully usable when it is.
 *
 * The wording matters as much as the switch: someone whose map has just
 * closed itself needs to find this without knowing what a gesture handler is.
 */
export function MapSettings({
  prefs,
  onChange,
}: {
  prefs: MapPrefs;
  onChange: <K extends keyof MapPrefs>(key: K, value: MapPrefs[K]) => void;
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>Map</Text>
      <Row
        label="Drag bins to rearrange"
        hint="Hold a bin and it follows your finger to the slot you want. Turning this off leaves the map fully usable — hold a bin to lift it, then tap where it goes. Switch it off if the map ever closes itself while you are arranging."
        value={prefs.dragEnabled}
        onValueChange={(on) => onChange('dragEnabled', on)}
        accessibilityLabel="Drag bins to rearrange the map"
        testID="map-drag-switch"
      />
      <Row
        label="Show slot ticks"
        hint="Marks the divisions along each shelf edge."
        value={prefs.showTicks}
        onValueChange={(on) => onChange('showTicks', on)}
        accessibilityLabel="Show slot ticks on shelves"
        testID="map-ticks-switch"
      />
    </>
  );
}

function Row({
  label,
  hint,
  value,
  onValueChange,
  accessibilityLabel,
  testID,
}: {
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (on: boolean) => void;
  accessibilityLabel: string;
  testID: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.borderStrong, true: colors.amber }}
        thumbColor={colors.text}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...type.stamp, marginTop: sp(2) },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: sp(3) },
  body: { flex: 1, gap: sp(1) },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { ...type.dim, lineHeight: 18 },
});
