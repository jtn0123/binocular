import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { HeatMode } from '@/db/mapView';
import { HEAT_LEGEND } from '@/map/mapPresentation';
import { colors, mono, radius, sp } from '@/theme';

const HEAT_MODES: [HeatMode, string][] = [
  ['none', 'none'],
  ['items', 'items'],
  ['scanned', 'last scan'],
];

/**
 * The map's own controls: the lens the cells are tinted through, finding a
 * bin on the shelves, and the switch into edit mode (v3).
 *
 * These live in the screen rather than the navigator's header. They reflect
 * screen state, and pushing that up into `navigation.setOptions` puts the
 * controls somewhere the screen cannot see — including from a test.
 *
 * In edit mode the whole row is replaced by the two steppers that shape a
 * rack: how many slots each shelf has, and how many shelves it has. They are
 * one control read twice — one horizontal, one vertical — which is why they
 * share a button style rather than looking like unrelated widgets.
 */
export interface MapToolbarProps {
  heat: HeatMode;
  onHeat: (mode: HeatMode) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  query: string;
  onQuery: (text: string) => void;
  editing: boolean;
  onToggleEdit: () => void;
  /** Slots per shelf across this rack, and whether either step is available. */
  columns: number;
  onColumns: (next: number) => void;
  canShrinkColumns: boolean;
  /** Shelves in this rack. */
  rows: number;
  onAddRow: () => void;
  onRemoveRow: () => void;
  canAddRow: boolean;
  canRemoveRow: boolean;
}

export function MapToolbar(props: Readonly<MapToolbarProps>) {
  if (props.editing) return <EditRow {...props} />;

  return (
    <>
      <View style={styles.toolbar}>
        {props.searchOpen ? (
          <View style={styles.searchBar}>
            <Ionicons name="search" size={15} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              value={props.query}
              onChangeText={props.onQuery}
              placeholder="Find a bin on the shelves"
              placeholderTextColor={colors.textFaint}
              autoFocus
              accessibilityLabel="Find a bin on the shelves"
              testID="map-search-input"
            />
            {props.query.length > 0 ? (
              <Pressable
                onPress={() => props.onQuery('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear the search"
                testID="map-search-clear"
              >
                <Ionicons name="close-circle" size={15} color={colors.textFaint} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            {/*
              The design captions this group "Lens". Dropped here, and only
              here: at 430pt the caption plus three labels plus Find plus Edit
              fit; at 360pt they do not, and the caption is the only element
              whose loss costs neither a control nor a legible word. Losing it
              buys the chips their full size instead of ellipsising them to
              "no…", "ite…", "last s…".
            */}
            <View style={styles.lensGroup}>
              {HEAT_MODES.map(([mode, label]) => (
                <Pressable
                  key={mode}
                  style={[styles.lens, props.heat === mode && styles.lensOn]}
                  onPress={() => props.onHeat(mode)}
                  accessibilityRole="button"
                  // Selection is colour-only otherwise, so all three read alike.
                  accessibilityState={{ selected: props.heat === mode }}
                  accessibilityLabel={`Tint cells by ${label}`}
                  testID={`map-heat-${mode}`}
                >
                  <Text
                    style={[styles.lensText, props.heat === mode && styles.lensTextOn]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.spacer} />
          </>
        )}

        <Pressable
          style={[styles.chip, props.searchOpen && styles.chipOn]}
          onPress={props.onToggleSearch}
          accessibilityRole="button"
          accessibilityState={{ selected: props.searchOpen }}
          accessibilityLabel="Find a bin on the shelves"
          testID="map-search-toggle"
        >
          <Ionicons
            name={props.searchOpen ? 'search' : 'search-outline'}
            size={12}
            color={props.searchOpen ? colors.amber : colors.textDim}
          />
          <Text style={[styles.chipText, props.searchOpen && styles.chipTextOn]}>Find</Text>
        </Pressable>

        {props.searchOpen ? null : (
          <Pressable
            style={styles.chip}
            onPress={props.onToggleEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit the wall"
            testID="map-edit-toggle"
          >
            <Text style={styles.chipText}>Edit</Text>
          </Pressable>
        )}
      </View>

      {props.heat !== 'none' ? <Text style={styles.legend}>{HEAT_LEGEND[props.heat]}</Text> : null}
    </>
  );
}

/** COLUMNS and ROWS: the two numbers that describe the shape of a rack. */
function EditRow(props: Readonly<MapToolbarProps>) {
  return (
    <View style={styles.editRow}>
      <Text style={styles.editLabel}>COLUMNS</Text>
      <StepButton
        icon="remove"
        live={props.canShrinkColumns}
        label="One slot fewer per shelf"
        onPress={() => props.onColumns(props.columns - 1)}
        testID="rack-cols-down"
      />
      <Text style={styles.editValue} testID="rack-cols">
        {props.columns}
      </Text>
      <StepButton
        icon="add"
        live={props.columns < MAX_COLUMNS}
        label="One slot more per shelf"
        onPress={() => props.onColumns(props.columns + 1)}
        testID="rack-cols-up"
      />

      <View style={styles.spacer} />

      <Text style={styles.editLabel}>ROWS</Text>
      <StepButton
        icon="remove"
        live={props.canRemoveRow}
        label="Remove the last empty shelf"
        onPress={props.onRemoveRow}
        testID="rack-rows-down"
      />
      <Text style={styles.editValue} testID="rack-rows">
        {props.rows}
      </Text>
      <StepButton
        icon="add"
        live={props.canAddRow}
        label="Add a shelf to this rack"
        onPress={props.onAddRow}
        testID="rack-rows-up"
      />
    </View>
  );
}

/**
 * A stepper that is *drawn* dead rather than removed when it cannot act. A
 * control that vanishes takes its own explanation with it, and "why can I not
 * make this rack shorter" is a question the shelf label answers.
 */
function StepButton({
  icon,
  live,
  label,
  onPress,
  testID,
}: Readonly<{
  icon: 'add' | 'remove';
  live: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}>) {
  return (
    <Pressable
      style={[styles.step, !live && styles.stepDead]}
      onPress={onPress}
      disabled={!live}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ disabled: !live }}
      accessibilityLabel={label}
      testID={testID}
    >
      <Ionicons name={icon} size={12} color={live ? colors.amber : '#6B6446'} />
    </Pressable>
  );
}

/** Wider than this and the cards stop being legible on a phone. */
export const MAX_COLUMNS = 8;
/** A rack taller than this scrolls past usefulness on one screen. */
export const MAX_ROWS = 8;

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.5),
    minHeight: 40,
    paddingHorizontal: sp(4),
    paddingTop: sp(2.5),
    paddingBottom: sp(1.5),
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
    minHeight: 36,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: sp(3),
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 13, padding: 0 },
  spacer: { flex: 1, minWidth: sp(2) },
  lensGroup: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    padding: 2,
  },
  lens: {
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: sp(2.75),
    borderRadius: radius.pill,
  },
  lensOn: { backgroundColor: colors.chipSelectedBg },
  lensText: { color: '#8F959D', fontSize: 11.5 },
  lensTextOn: { color: colors.amber, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.25),
    height: 32,
    flexShrink: 0,
    paddingHorizontal: sp(2.75),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.chipBg,
  },
  chipOn: { backgroundColor: colors.chipSelectedBg, borderColor: colors.chipSelectedBorder },
  chipText: { color: colors.textDim, fontSize: 12 },
  chipTextOn: { color: colors.amber },
  legend: {
    color: colors.textFaint,
    fontSize: 11,
    lineHeight: 15,
    paddingHorizontal: sp(4),
    paddingBottom: sp(2),
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    minHeight: 40,
    paddingHorizontal: sp(4),
    paddingTop: sp(2.5),
    paddingBottom: sp(1.5),
  },
  editLabel: { color: colors.amber, fontSize: 9, fontWeight: '800', letterSpacing: 1.3 },
  editValue: {
    color: colors.amber,
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 13,
    minWidth: 16,
    textAlign: 'center',
  },
  step: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDead: { borderColor: '#4A4630' },
});
