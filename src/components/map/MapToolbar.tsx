import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { HeatMode } from '@/db/mapView';
import { HEAT_LEGEND } from '@/map/mapPresentation';
import { colors, radius, sp, type } from '@/theme';

const HEAT_MODES: [HeatMode, string][] = [
  ['none', 'none'],
  ['items', 'items'],
  ['scanned', 'last scan'],
];

/**
 * The map's own controls: tint, search, and the whole-wall toggle.
 *
 * These live in the screen rather than the navigator's header. They reflect
 * screen state, and pushing that up into `navigation.setOptions` puts the
 * controls somewhere the screen cannot see — including from a test.
 */
export function MapToolbar({
  heat,
  onHeat,
  searchOpen,
  onToggleSearch,
  wallOpen,
  onToggleWall,
  query,
  onQuery,
  onCloseSearch,
}: {
  heat: HeatMode;
  onHeat: (mode: HeatMode) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  wallOpen: boolean;
  onToggleWall: () => void;
  query: string;
  onQuery: (text: string) => void;
  onCloseSearch: () => void;
}) {
  return (
    <>
      {searchOpen ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={onQuery}
            placeholder="Find a bin on the shelves"
            placeholderTextColor={colors.textFaint}
            autoFocus
            accessibilityLabel="Find a bin on the shelves"
            testID="map-search-input"
          />
          <Pressable
            onPress={onCloseSearch}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close the search"
            testID="map-search-close"
          >
            <Ionicons name="close" size={16} color={colors.textFaint} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.toolbar}>
        <Text style={styles.heatLabel}>Tint</Text>
        {HEAT_MODES.map(([mode, label]) => (
          <Pressable
            key={mode}
            style={[styles.chip, heat === mode && styles.chipOn]}
            onPress={() => onHeat(mode)}
            accessibilityRole="button"
            accessibilityLabel={`Tint cells by ${label}`}
            testID={`map-heat-${mode}`}
          >
            <Text style={[styles.chipText, heat === mode && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
        <View style={styles.spacer} />
        <Pressable
          onPress={onToggleSearch}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Search the shelves"
          testID="map-search-toggle"
        >
          <Ionicons
            name={searchOpen ? 'search' : 'search-outline'}
            size={19}
            color={searchOpen ? colors.amber : colors.textDim}
          />
        </Pressable>
        <Pressable
          onPress={onToggleWall}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Show the whole wall"
          testID="map-wall-toggle"
        >
          <Ionicons
            name={wallOpen ? 'grid' : 'grid-outline'}
            size={19}
            color={wallOpen ? colors.amber : colors.textDim}
          />
        </Pressable>
      </View>

      {heat !== 'none' ? <Text style={styles.legend}>{HEAT_LEGEND[heat]}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.25),
    marginHorizontal: sp(4),
    marginBottom: sp(2.5),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2.25),
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 13.5, padding: 0 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
    paddingHorizontal: sp(4),
    paddingBottom: sp(2),
  },
  spacer: { flex: 1 },
  heatLabel: { ...type.stamp },
  chip: {
    paddingHorizontal: sp(2.75),
    paddingVertical: sp(1.25),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.chipBg,
  },
  chipOn: { backgroundColor: colors.chipSelectedBg, borderColor: colors.chipSelectedBorder },
  chipText: { color: colors.textDim, fontSize: 12 },
  chipTextOn: { color: colors.amber },
  legend: { color: colors.textFaint, fontSize: 11, paddingHorizontal: sp(4), paddingBottom: sp(2) },
});
