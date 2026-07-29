import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MapRow } from '@/db/mapView';
import { colors, mono, radius, sp, type } from '@/theme';

/**
 * Everything a shelf can be, in one sheet (D21: "shelves are editable in
 * place").
 *
 * Replaces three separate icon buttons that each opened a prompt. Renaming a
 * shelf and giving it eight slots are the same errand — you are describing
 * the piece of furniture — and doing them one modal at a time meant reading
 * the shelf's current state from the map behind the dialog.
 *
 * Deleting is here too, and it never destroys anything: the bins come off the
 * shelf and land in the unshelved tray, which is why the map draws that tray
 * at all.
 */
export interface ShelfDraft {
  shelfId: string;
  locationName: string;
  name: string;
  capacity: number | null;
  binCount: number;
}

/** The sheet's view of a shelf, taken from the row the map already drew. */
export function shelfDraft(row: MapRow, locationName: string): ShelfDraft {
  return {
    shelfId: row.shelfId!,
    locationName,
    name: row.name,
    capacity: row.capacity,
    binCount: row.bins.length,
  };
}

/**
 * An errand that belongs to a shelf but not to every screen showing one —
 * bulk-creating bins and printing a shelf poster are Browse's, not the map's.
 * Passed in rather than built in so the sheet stays one thing.
 */
export interface ShelfExtra {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

export interface ShelfSheetProps {
  shelf: ShelfDraft | null;
  onRename: (name: string) => void;
  onCapacity: (capacity: number | null) => void;
  onAddBin: () => void;
  onDelete: () => void;
  onClose: () => void;
  extras?: readonly ShelfExtra[];
}

export function ShelfSheet(props: ShelfSheetProps) {
  const { shelf, onClose } = props;
  return (
    <Modal
      visible={shelf !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {shelf ? <ShelfSheetBody {...props} shelf={shelf} /> : null}
    </Modal>
  );
}

function ShelfSheetBody({
  shelf,
  onRename,
  onCapacity,
  onAddBin,
  onDelete,
  onClose,
  extras,
}: ShelfSheetProps & { shelf: ShelfDraft }) {
  const [name, setName] = useState(shelf.name);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== shelf.name) onRename(trimmed);
    else if (!trimmed) setName(shelf.name);
  };

  // Stepping from "unsized" starts at what is already on the shelf, so the
  // first tap sizes it honestly rather than declaring it full or empty.
  const stepCapacity = (by: number) => {
    const from = shelf.capacity ?? shelf.binCount;
    const next = from + by;
    onCapacity(next > 0 ? Math.min(next, 200) : null);
  };

  return (
    <View style={styles.sheet} testID="map-shelf-sheet">
      <View style={styles.grabber} />
      <Text style={styles.where}>{shelf.locationName}</Text>
      <TextInput
        style={styles.nameInput}
        value={name}
        onChangeText={setName}
        onBlur={commitName}
        onSubmitEditing={commitName}
        placeholder="Shelf name"
        placeholderTextColor={colors.textFaint}
        accessibilityLabel="Shelf name"
        testID="map-shelf-name"
      />

      <View style={styles.slotsRow}>
        <View style={styles.slotsBody}>
          <Text style={styles.slotsTitle}>Slots</Text>
          <Text style={styles.slotsNote}>
            {shelf.capacity === null
              ? `unlimited · ${shelf.binCount} filed`
              : `${shelf.binCount} filed${shelf.binCount > shelf.capacity ? ' — over' : ''}`}
          </Text>
        </View>
        <Pressable
          style={styles.stepper}
          onPress={() => stepCapacity(-1)}
          accessibilityRole="button"
          accessibilityLabel="One slot fewer"
          testID="map-slots-down"
        >
          <Ionicons name="remove" size={15} color={colors.textDim} />
        </Pressable>
        <Text style={styles.slotsCount} testID="map-slots-count">
          {shelf.capacity === null ? '—' : String(shelf.capacity)}
        </Text>
        <Pressable
          style={styles.stepper}
          onPress={() => stepCapacity(1)}
          accessibilityRole="button"
          accessibilityLabel="One slot more"
          testID="map-slots-up"
        >
          <Ionicons name="add" size={15} color={colors.textDim} />
        </Pressable>
      </View>

      <View style={styles.buttons}>
        <Pressable
          style={styles.addBin}
          onPress={onAddBin}
          accessibilityRole="button"
          accessibilityLabel={`New bin on ${shelf.name}`}
          testID="map-sheet-add-bin"
        >
          <Ionicons name="add" size={16} color={colors.textDim} />
          <Text style={styles.addBinLabel}>Add bin</Text>
        </Pressable>
        <Pressable
          style={styles.delete}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${shelf.name}`}
          testID="map-sheet-delete-shelf"
        >
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      </View>

      {extras && extras.length > 0 ? (
        <View style={styles.extras}>
          {extras.map((extra) => (
            <Pressable
              key={extra.key}
              style={styles.extra}
              onPress={extra.onPress}
              accessibilityRole="button"
              accessibilityLabel={extra.label}
              testID={`map-sheet-${extra.key}`}
            >
              <Ionicons name={extra.icon} size={15} color={colors.steel} />
              <Text style={styles.extraLabel}>{extra.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.note}>
        {shelf.binCount > 0
          ? `Deleting the shelf moves its ${shelf.binCount} bin${
              shelf.binCount === 1 ? '' : 's'
            } to the unshelved tray. Nothing is thrown away.`
          : 'This shelf is empty.'}
      </Text>

      <Pressable
        style={styles.done}
        onPress={() => {
          commitName();
          onClose();
        }}
        accessibilityRole="button"
        accessibilityLabel="Done"
        testID="map-sheet-done"
      >
        <Text style={styles.doneLabel}>Done</Text>
      </Pressable>
    </View>
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
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: sp(4),
  },
  where: { ...type.stamp },
  nameInput: {
    marginTop: sp(2.25),
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.borderStrong,
    paddingBottom: sp(1.25),
  },
  slotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    marginTop: sp(5),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: sp(3.25),
    paddingVertical: sp(2.75),
  },
  slotsBody: { flex: 1, gap: 2 },
  slotsTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  slotsNote: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, lineHeight: 14 },
  stepper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotsCount: {
    minWidth: 34,
    textAlign: 'center',
    color: colors.text,
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 15,
  },
  buttons: { flexDirection: 'row', gap: sp(2.25), marginTop: sp(3.5) },
  addBin: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(2),
    paddingVertical: sp(3.25),
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
  addBinLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(2),
    paddingVertical: sp(3.25),
    paddingHorizontal: sp(4),
    borderWidth: 1,
    borderColor: colors.dangerDim,
    borderRadius: radius.md,
  },
  deleteLabel: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  extras: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2.25), marginTop: sp(2.25) },
  extra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.75),
    paddingVertical: sp(2.5),
    paddingHorizontal: sp(3),
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
  extraLabel: { color: colors.steel, fontSize: 12.5, fontWeight: '600' },
  note: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: sp(3) },
  done: {
    marginTop: sp(3.5),
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    paddingVertical: sp(3.25),
    alignItems: 'center',
  },
  doneLabel: { color: colors.amberInkOn, fontSize: 14, fontWeight: '800' },
});
