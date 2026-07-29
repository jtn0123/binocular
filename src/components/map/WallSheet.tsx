import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { areaFill, rackCodeOf, rackLabelOf, rowGaps, type MapArea } from '@/db/mapView';
import { colors, mono, radius, shelf, sp } from '@/theme';

/**
 * The whole wall at a glance (v3), as a screen rather than a strip.
 *
 * The map shows one rack, so this is how you see the shape of the room: every
 * rack shrunk to its grid of cells, matches lit, the one you are on ringed.
 * Tap a rack to go there.
 *
 * Edit mode turns it into the plan view of the wall — nudge a rack left or
 * right, rename it, take one off. Codes ride along with the rack rather than
 * renumbering, because the sticker on the shelving does not move when you
 * shuffle the plan. Nothing here can destroy a bin: taking a rack off the
 * wall sends its bins to the unshelved tray (§11).
 */
export function WallSheet({
  racks,
  currentIndex,
  matchedBinIds,
  editing,
  onToggleEdit,
  onClose,
  onGo,
  onMove,
  onRename,
  onRemove,
  onAddRack,
  trayLabel,
}: Readonly<{
  racks: readonly MapArea[];
  currentIndex: number;
  matchedBinIds: readonly string[];
  editing: boolean;
  onToggleEdit: () => void;
  onClose: () => void;
  onGo: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRename: (index: number, label: string) => void;
  onRemove: (index: number) => void;
  onAddRack: () => void;
  trayLabel: string;
}>) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  /**
   * One commit per edit, whichever way it ends: pressing return fires
   * `onSubmitEditing` and then blurs the field, so both handlers ran and the
   * same name was written twice — a database round trip and a full map redraw
   * each time.
   */
  const commitRename = () => {
    if (renaming === null) return;
    onRename(renaming, draft);
    setRenaming(null);
  };

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.head}>
          <Text style={styles.title}>Whole wall</Text>
          <View style={styles.headActions}>
            <Pressable
              onPress={onToggleEdit}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityState={{ selected: editing }}
              accessibilityLabel={editing ? 'Finish arranging the wall' : 'Arrange the wall'}
              testID="wall-edit-toggle"
            >
              <Ionicons
                name={editing ? 'checkmark-circle' : 'create-outline'}
                size={editing ? 21 : 17}
                color={editing ? colors.amber : colors.textDim}
              />
            </Pressable>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close the whole wall"
              testID="wall-close"
            >
              <Ionicons name="close-circle" size={22} color={colors.textDim} />
            </Pressable>
          </View>
        </View>

        <Text style={styles.hint}>
          {editing
            ? 'nudge a rack with ‹ › to reorder it · tap a name to rename · codes stay with the rack'
            : 'tap a rack to open it'}
        </Text>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.well}>
            <View style={styles.thumbs}>
              {racks.map((rack, index) => {
                const code = rackCodeOf(rack.name, index);
                const label = rackLabelOf(rack.name);
                const fill = areaFill(rack);
                const isRenaming = editing && renaming === index;
                return (
                  <Pressable
                    key={rack.locationId ?? code}
                    style={[styles.thumb, index === currentIndex && styles.thumbOn]}
                    onPress={() => (editing ? undefined : onGo(index))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: index === currentIndex }}
                    accessibilityLabel={`Rack ${code}, ${label}, ${fill.filled} of ${fill.slots} slots used`}
                    testID={`wall-rack-${code}`}
                  >
                    <View style={styles.rows}>
                      {rack.rows.map((row) => (
                        <View key={row.shelfId ?? 'unshelved'} style={styles.row}>
                          <View style={styles.cells}>
                            {row.bins.map((cell) => (
                              <View
                                key={cell.binId}
                                style={[
                                  styles.cell,
                                  matchedBinIds.includes(cell.binId) && styles.cellHit,
                                ]}
                              />
                            ))}
                            {Array.from({ length: rowGaps(row) }, (_, i) => (
                              <View key={`free-${i}`} style={[styles.cell, styles.cellFree]} />
                            ))}
                            {row.bins.length === 0 && rowGaps(row) === 0 ? (
                              <View style={[styles.cell, styles.cellFree]} />
                            ) : null}
                          </View>
                          <View style={styles.plank} />
                        </View>
                      ))}
                    </View>

                    {editing ? (
                      <>
                        <View style={styles.nameRow}>
                          <Text style={styles.codeTag}>{code}</Text>
                          {isRenaming ? (
                            <TextInput
                              style={styles.nameInput}
                              value={draft}
                              onChangeText={setDraft}
                              onBlur={commitRename}
                              onSubmitEditing={commitRename}
                              autoFocus
                              accessibilityLabel={`Name of rack ${code}`}
                              testID={`wall-rename-input-${code}`}
                            />
                          ) : (
                            <Pressable
                              style={styles.nameWrap}
                              onPress={() => {
                                setDraft(label);
                                setRenaming(index);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`Rename rack ${code}`}
                              testID={`wall-rename-${code}`}
                            >
                              <Text style={styles.name} numberOfLines={1}>
                                {label}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                        <View style={styles.editRow}>
                          <ArrowButton
                            direction={-1}
                            live={index > 0}
                            code={code}
                            onPress={() => onMove(index, -1)}
                          />
                          <ArrowButton
                            direction={1}
                            live={index < racks.length - 1}
                            code={code}
                            onPress={() => onMove(index, 1)}
                          />
                          <Text style={styles.fill}>
                            {fill.filled}/{fill.slots}
                          </Text>
                          {racks.length > 1 ? (
                            <Pressable
                              style={styles.drop}
                              onPress={() => onRemove(index)}
                              accessibilityRole="button"
                              accessibilityLabel={`Take rack ${code} off the wall`}
                              testID={`wall-remove-${code}`}
                            >
                              <Ionicons name="trash-outline" size={12} color={colors.danger} />
                            </Pressable>
                          ) : null}
                        </View>
                      </>
                    ) : (
                      <View style={styles.nameRow}>
                        <Text
                          style={[styles.plainName, index === currentIndex && styles.plainNameOn]}
                          numberOfLines={1}
                        >
                          {rack.name}
                        </Text>
                        <Text style={styles.fill}>
                          {fill.filled}/{fill.slots}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}

              {editing ? (
                <Pressable
                  style={styles.addRack}
                  onPress={onAddRack}
                  accessibilityRole="button"
                  accessibilityLabel="Add a rack to the wall"
                  testID="wall-add-rack"
                >
                  <Ionicons name="add" size={17} color={colors.amber} />
                  <Text style={styles.addRackLabel}>ADD RACK</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.trayRow}>
              <Ionicons name="file-tray-stacked" size={14} color="#767D86" />
              <Text style={styles.trayLabel}>{trayLabel}</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ArrowButton({
  direction,
  live,
  code,
  onPress,
}: Readonly<{
  direction: -1 | 1;
  live: boolean;
  code: string;
  onPress: () => void;
}>) {
  return (
    <Pressable
      style={[styles.arrow, live && styles.arrowLive]}
      onPress={onPress}
      disabled={!live}
      accessibilityRole="button"
      accessibilityState={{ disabled: !live }}
      accessibilityLabel={`Move rack ${code} ${direction === -1 ? 'left' : 'right'} along the wall`}
      testID={`wall-move-${direction === -1 ? 'left' : 'right'}-${code}`}
    >
      <Ionicons
        name={direction === -1 ? 'chevron-back' : 'chevron-forward'}
        size={11}
        color={live ? colors.amber : colors.chipBorder}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  head: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp(4),
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: sp(4.5) },
  hint: { color: '#565C64', fontFamily: mono, fontSize: 10, paddingHorizontal: sp(4), paddingBottom: sp(2.5) },
  body: { paddingHorizontal: sp(3), paddingBottom: sp(4) },
  well: {
    borderRadius: radius.md,
    backgroundColor: shelf.well,
    borderWidth: 1,
    borderColor: shelf.wellBorder,
    padding: sp(3.5),
    gap: sp(3),
  },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2.5), alignItems: 'flex-start' },
  // Two to a row on the narrowest phone, rather than a fixed width that only
  // pairs up on a wide one — a wall you have to scroll is not a wall at a
  // glance, which is the whole reason this screen exists.
  thumb: {
    // Fixed share rather than flexGrow: an odd rack left alone on the last
    // row must stay the same size as its neighbours, not stretch to fill it.
    flexGrow: 0,
    flexBasis: '48%',
    maxWidth: 220,
    gap: sp(1.5),
    padding: sp(2.25),
    borderRadius: 7,
    borderWidth: 1,
    borderColor: shelf.wellBorder,
  },
  thumbOn: { borderWidth: 2, borderColor: colors.amber, backgroundColor: 'rgba(255,196,0,0.05)' },
  rows: { gap: 5 },
  row: { gap: 2 },
  cells: { flexDirection: 'row', gap: 2 },
  cell: {
    flex: 1,
    height: 11,
    borderRadius: 1.5,
    backgroundColor: '#22262B',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    // Restated: a cell flips between free (dashed) and filled as bins move.
    borderStyle: 'solid',
  },
  cellHit: { backgroundColor: colors.amber, borderColor: '#FFD84D' },
  cellFree: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: colors.border },
  plank: { height: 2.5, borderRadius: 1, backgroundColor: '#4A5158' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  plainName: {
    flex: 1,
    color: colors.textDim,
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 8.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  plainNameOn: { color: colors.amber },
  codeTag: {
    color: colors.amber,
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 8.5,
    backgroundColor: colors.chipSelectedBg,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  nameWrap: { flex: 1, borderBottomWidth: 1, borderBottomColor: colors.borderStrong },
  name: {
    color: colors.text,
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 8.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  nameInput: {
    flex: 1,
    color: colors.amber,
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 8.5,
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.chipSelectedBorder,
  },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  arrow: {
    width: 38,
    height: 32,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#2A2F35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowLive: { borderColor: colors.chipSelectedBorder, backgroundColor: 'rgba(255,196,0,0.07)' },
  fill: { marginLeft: 'auto', color: '#565C64', fontFamily: mono, fontSize: 8 },
  drop: {
    width: 32,
    height: 32,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#4A2622',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRack: {
    flexGrow: 0,
    flexBasis: '48%',
    maxWidth: 220,
    minHeight: 110,
    borderRadius: 7,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.chipSelectedBorder,
    backgroundColor: 'rgba(255,196,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(1.75),
    padding: sp(2.25),
  },
  addRackLabel: {
    color: colors.amber,
    fontFamily: mono,
    fontWeight: '800',
    fontSize: 9,
    letterSpacing: 0.7,
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.25),
    paddingTop: sp(2.5),
    borderTopWidth: 1,
    borderTopColor: colors.chipBorder,
    borderStyle: 'dashed',
  },
  trayLabel: { color: '#767D86', fontFamily: mono, fontSize: 10 },
});
