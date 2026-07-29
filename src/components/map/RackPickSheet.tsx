import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  areaFill,
  openRowOf,
  rackCodeOf,
  rackLabelOf,
  rackRoom,
  type MapArea,
  type MapRow,
} from '@/db/mapView';
import { colors, mono, radius, sp } from '@/theme';

/**
 * Which rack, when the rail cannot say (v3).
 *
 * Dropping on a side rail means "send it that way". One rack that way is
 * unambiguous and just happens — the re-home confirm still asks. Two or more
 * and the direction alone cannot pick between them, so this asks instead of
 * guessing, and says for each one where the bin would actually land: which
 * shelf, which slot, how full the rack already is. A packed rack says so
 * rather than silently making a shelf read over.
 */
export interface RackPickRequest {
  /** What is being carried — one bin, or a stack. */
  code: string;
  name: string;
  /** "Racks right of R1" — why these are the ones on offer. */
  which: string;
  /** Racks to choose from, nearest first, paired with their wall index. */
  candidates: readonly { index: number; area: MapArea }[];
}

/** What this rack would do with the bin, in the one line the row has for it. */
function landingLine(
  open: MapRow | null,
  full: boolean,
  fill: { filled: number; slots: number },
): string {
  if (!open) return 'no shelves yet';
  if (full) return `full — ${open.name} would read over`;
  return `lands on ${open.name} · slot ${open.bins.length + 1} · ${fill.filled}/${fill.slots} full`;
}

export function RackPickSheet({
  request,
  onPick,
  onCancel,
}: Readonly<{
  request: RackPickRequest | null;
  /** The chosen shelf, and the rack it belongs to so the map can page there. */
  onPick: (rackIndex: number, shelfId: string) => void;
  onCancel: () => void;
}>) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (!request) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Cancel" />
      <View style={styles.sheet} testID="rack-pick-sheet">
        <View style={styles.grabber} />
        <Text style={styles.title}>Which rack?</Text>
        <Text style={styles.which}>{request.which}</Text>

        <View style={styles.subject}>
          <Text style={styles.subjectCode}>{request.code}</Text>
          <Text style={styles.subjectName} numberOfLines={1}>
            {request.name}
          </Text>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listBody}>
          {request.candidates.map(({ index, area }) => {
            const code = rackCodeOf(area.name, index);
            const open = openRowOf(area);
            const fill = areaFill(area);
            const full = rackRoom(area) === 0;
            const isOpen = expanded === index;
            return (
              <View key={area.locationId ?? code} style={styles.rack}>
                <View style={styles.rackHead}>
                  <Pressable
                    style={styles.rackMain}
                    onPress={() => open && onPick(index, open.shelfId as string)}
                    disabled={!open}
                    accessibilityRole="button"
                    accessibilityLabel={
                      open
                        ? `Send it to rack ${code}, ${rackLabelOf(area.name)} — lands on ${open.name}`
                        : `Rack ${code} has no shelf to land on`
                    }
                    testID={`rack-pick-${code}`}
                  >
                    <Text style={styles.rackCode}>{code}</Text>
                    <View style={styles.rackText}>
                      <Text style={styles.rackLabel} numberOfLines={1}>
                        {rackLabelOf(area.name)}
                      </Text>
                      <Text style={styles.rackWhere} numberOfLines={2}>
                        {landingLine(open, full, fill)}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={[styles.shelfToggle, isOpen && styles.shelfToggleOn]}
                    onPress={() => setExpanded(isOpen ? null : index)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`Choose a shelf in rack ${code}`}
                    testID={`rack-pick-shelves-${code}`}
                  >
                    <Text style={[styles.shelfToggleText, isOpen && styles.shelfToggleTextOn]}>
                      SHELF
                    </Text>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={10}
                      color={isOpen ? colors.amber : colors.textDim}
                    />
                  </Pressable>
                </View>

                {isOpen ? (
                  <View style={styles.shelves}>
                    {area.rows.map((row) => (
                      <Pressable
                        key={row.shelfId ?? 'unshelved'}
                        style={styles.shelfChip}
                        onPress={() => row.shelfId && onPick(index, row.shelfId)}
                        accessibilityRole="button"
                        accessibilityLabel={`Send it to ${row.name} in rack ${code}`}
                        testID={`rack-pick-shelf-${row.shelfId ?? 'unshelved'}`}
                      >
                        <Text style={styles.shelfName}>{row.name}</Text>
                        <Text style={styles.shelfFill}>
                          {row.bins.length}/{row.capacity ?? row.bins.length}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        <Pressable
          style={styles.keep}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Keep it where it is"
          testID="rack-pick-cancel"
        >
          <Text style={styles.keepLabel}>Keep it where it is</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.64)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: sp(5),
    paddingTop: sp(3.5),
    paddingBottom: sp(6.5),
    gap: sp(1.5),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: sp(2.5),
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  which: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17 },
  subject: { flexDirection: 'row', alignItems: 'center', gap: sp(2.5), marginVertical: sp(3) },
  subjectCode: {
    color: colors.amberInkOn,
    backgroundColor: colors.amber,
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 12,
    borderRadius: 4,
    paddingHorizontal: sp(2),
    paddingVertical: sp(1),
  },
  subjectName: { flex: 1, color: colors.text, fontSize: 14 },
  list: { flexGrow: 0 },
  listBody: { gap: sp(2) },
  rack: {
    gap: sp(2),
    padding: sp(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  rackHead: { flexDirection: 'row', alignItems: 'center', gap: sp(2.75) },
  rackMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp(2.75), minHeight: 38 },
  rackCode: {
    color: colors.amber,
    backgroundColor: colors.chipSelectedBg,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 11,
    borderRadius: 4,
    paddingHorizontal: sp(1.75),
    paddingVertical: sp(1),
  },
  rackText: { flex: 1, gap: 2 },
  rackLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  rackWhere: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, lineHeight: 14 },
  shelfToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.25),
    paddingHorizontal: sp(2.25),
    paddingVertical: sp(2),
    borderWidth: 1,
    borderColor: colors.chipBorder,
    borderRadius: 8,
  },
  shelfToggleOn: { borderColor: colors.chipSelectedBorder },
  shelfToggleText: { color: colors.textDim, fontFamily: mono, fontWeight: '700', fontSize: 9 },
  shelfToggleTextOn: { color: colors.amber },
  shelves: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sp(1.5),
    paddingTop: sp(0.5),
    borderTopWidth: 1,
    borderTopColor: colors.chipBorder,
    borderStyle: 'dashed',
  },
  shelfChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1.5),
    minHeight: 36,
    paddingHorizontal: sp(2.5),
    borderWidth: 1,
    borderColor: colors.chipBorder,
    borderRadius: 8,
  },
  shelfName: {
    color: colors.text,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  shelfFill: { color: colors.textFaint, fontFamily: mono, fontSize: 9 },
  keep: {
    marginTop: sp(3.5),
    alignItems: 'center',
    paddingVertical: sp(3.5),
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
  keepLabel: { color: colors.textDim, fontWeight: '700', fontSize: 14 },
});
