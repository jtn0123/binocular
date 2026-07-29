import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, mono, radius, sp } from '@/theme';

/**
 * The rack you are standing in front of, while the wall is being edited (v3).
 *
 * The short code is not editable and the label is: the code is what is
 * printed on the sticker at the end of the run, so deciding "Door" is really
 * "By the door" must not renumber the wall. Only shown in edit mode — at rest
 * the scrubber already says which rack this is, and a second header saying it
 * again would cost a shelf's worth of screen.
 */
export function RackHeader({
  code,
  label,
  fill,
  onRename,
  onOpenSettings,
  onDone,
}: {
  code: string;
  label: string;
  /** "7/16" — bins filed against slots declared, across the whole rack. */
  fill: string;
  onRename: (label: string) => void;
  onOpenSettings: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <View style={styles.row}>
      <Text style={styles.code}>{code}</Text>

      {draft === null ? (
        <Pressable
          onPress={() => setDraft(label)}
          accessibilityRole="button"
          accessibilityLabel={`Rename this rack, currently ${label}`}
          style={styles.labelWrap}
          testID="rack-rename"
        >
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <Ionicons name="pencil" size={11} color={colors.chipSelectedBorder} />
        </Pressable>
      ) : (
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onBlur={() => {
            onRename(draft);
            setDraft(null);
          }}
          onSubmitEditing={() => {
            onRename(draft);
            setDraft(null);
          }}
          autoFocus
          accessibilityLabel="Rack name"
          testID="rack-rename-input"
        />
      )}

      <Text style={styles.fill}>{fill}</Text>
      <View style={styles.spacer} />

      <Pressable
        style={styles.gear}
        onPress={onOpenSettings}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Map settings"
        testID="map-settings-open"
      >
        <Ionicons name="settings-outline" size={14} color={colors.amber} />
      </Pressable>
      <Pressable
        style={styles.done}
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel="Finish editing the wall"
        testID="map-edit-done"
      >
        <Ionicons name="checkmark" size={13} color={colors.amberInkOn} />
        <Text style={styles.doneLabel}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    paddingHorizontal: sp(4),
    paddingTop: sp(2.5),
    paddingBottom: sp(1),
  },
  code: { color: colors.textDim, fontFamily: mono, fontWeight: '700', fontSize: 11 },
  labelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.5),
    borderBottomWidth: 1,
    borderBottomColor: colors.chipSelectedBorder,
    paddingBottom: 2,
    flexShrink: 1,
  },
  label: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  input: {
    width: 150,
    color: colors.amber,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    borderRadius: 5,
    paddingHorizontal: sp(1.75),
    paddingVertical: sp(1),
  },
  fill: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  spacer: { flex: 1, minWidth: sp(1.5) },
  gear: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.5),
    height: 34,
    paddingHorizontal: sp(3.5),
    borderRadius: radius.pill,
    backgroundColor: colors.amber,
  },
  doneLabel: { color: colors.amberInkOn, fontWeight: '800', fontSize: 12 },
});
