import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CodeTag } from '@/components/CodeTag';
import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { useDb } from '@/db/DbProvider';
import {
  createBinsBulk,
  createLocation,
  getBinPlace,
  createShelf,
  deleteLocation,
  deleteShelf,
  listBins,
  listBinsForShelf,
  listLocations,
  listShelves,
  listUnassignedBins,
  renameLocation,
  renameShelf,
  type BinRow,
  type LocationRow,
  type ShelfRow,
} from '@/db/queries';
import { quickCreateBin } from '@/db/scaffold';
import { useFocusTick } from '@/lib/useFocusTick';
import { printLabelSheet, printShelfPoster } from '@/qr/print';
import { colors, radius, sp, type } from '@/theme';

function BinRowLink({ bin }: { bin: BinRow }) {
  return (
    <Link href={{ pathname: '/bin/[id]', params: { id: bin.id } }} asChild>
      <Pressable style={styles.binRow}>
        <CodeTag code={bin.short_code} small />
        <Text style={styles.binName} numberOfLines={1}>
          {bin.name}
        </Text>
        <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
      </Pressable>
    </Link>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.iconButton} onPress={onPress} accessibilityLabel={label}>
      <Ionicons name={icon} size={17} color={danger ? colors.danger : colors.steel} />
    </Pressable>
  );
}

export default function BrowseScreen() {
  const db = useDb();
  useFocusTick();
  const [tick, setTick] = useState(0);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  // Print picker (field-test ask): choose which bins to print, not all-or-nothing.
  const [printPicking, setPrintPicking] = useState(false);
  const [printSelected, setPrintSelected] = useState<Record<string, boolean>>({});
  const refresh = () => setTick((t) => t + 1);
  void tick;

  const locations = listLocations(db);
  const unassigned = listUnassignedBins(db);

  function openPrintPicker() {
    const bins = listBins(db);
    if (bins.length === 0) {
      Alert.alert('No bins', 'Create some bins first.');
      return;
    }
    // Everything pre-selected — "all bins" stays one tap away.
    setPrintSelected(Object.fromEntries(bins.map((b) => [b.id, true])));
    setPrintPicking(true);
  }

  async function printSelectedLabels() {
    const bins = listBins(db).filter((b) => printSelected[b.id]);
    setPrintPicking(false);
    if (bins.length === 0) return;
    try {
      await printLabelSheet(
        bins.map((bin) => {
          const place = getBinPlace(db, bin.id);
          const where = [place.shelfName, place.locationName].filter(Boolean).join(' \u00b7 ');
          return {
            payload: { type: 'bin' as const, id: bin.id },
            code: bin.short_code,
            name: bin.name,
            where: where || undefined,
          };
        }),
      );
    } catch (err) {
      Alert.alert('Print failed', err instanceof Error ? err.message : String(err));
    }
  }

  async function printLocationLabels(location: LocationRow, shelves: ShelfRow[]) {
    try {
      await printLabelSheet([
        { payload: { type: 'location', id: location.id }, code: location.name, name: 'Location' },
        ...shelves.map((shelf) => ({
          payload: { type: 'shelf' as const, id: shelf.id },
          code: shelf.name,
          name: `Shelf · ${location.name}`,
        })),
      ]);
    } catch (err) {
      Alert.alert('Print failed', err instanceof Error ? err.message : String(err));
    }
  }

  function confirmDeleteShelf(shelf: ShelfRow) {
    const bins = listBinsForShelf(db, shelf.id);
    Alert.alert(
      `Delete ${shelf.name}?`,
      bins.length > 0
        ? `Its ${bins.length} bin${bins.length === 1 ? '' : 's'} will become unassigned — never deleted.`
        : 'This shelf is empty.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteShelf(db, shelf.id);
            refresh();
          },
        },
      ],
    );
  }

  function confirmDeleteLocation(location: LocationRow) {
    Alert.alert(
      `Delete ${location.name}?`,
      'Its shelves are removed; bins become unassigned — never deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteLocation(db, location.id);
            refresh();
          },
        },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.toolbar}>
          <Pressable
            style={styles.toolbarButton}
            onPress={() =>
              setPrompt({
                title: 'New location',
                placeholder: 'e.g. Garage',
                onSubmit: (name) => {
                  createLocation(db, { name });
                  refresh();
                },
              })
            }
          >
            <Ionicons name="add" size={16} color={colors.amberInkOn} />
            <Text style={styles.toolbarLabel}>Location</Text>
          </Pressable>
          <Pressable
            style={styles.toolbarButton}
            accessibilityRole="button"
            accessibilityLabel="Create a new bin"
            onPress={() => {
              quickCreateBin(db);
              refresh();
            }}
          >
            <Ionicons name="add" size={16} color={colors.amberInkOn} />
            <Text style={styles.toolbarLabel}>Bin</Text>
          </Pressable>
          <Pressable style={styles.toolbarButtonAlt} onPress={openPrintPicker}>
            <Ionicons name="print" size={16} color={colors.steel} />
            <Text style={styles.toolbarLabelAlt}>Print bin labels</Text>
          </Pressable>
        </View>

        {locations.length === 0 && unassigned.length === 0 && (
          <Text style={styles.empty}>
            Empty workshop — tap + Bin for a one-tap start (a default location and shelf are
            created for you), or + Location to lay out your space first.
          </Text>
        )}

        {locations.map((location) => {
          const shelves = listShelves(db, location.id);
          return (
            <View key={location.id} style={styles.locationCard}>
              <View style={styles.headerRow}>
                <Text style={styles.locationName}>{location.name}</Text>
                <View style={styles.headerActions}>
                  <IconButton
                    icon="add-circle-outline"
                    label={`Add shelf to ${location.name}`}
                    onPress={() =>
                      setPrompt({
                        title: `New shelf in ${location.name}`,
                        placeholder: 'e.g. Shelf C',
                        onSubmit: (name) => {
                          createShelf(db, { locationId: location.id, name });
                          refresh();
                        },
                      })
                    }
                  />
                  <IconButton
                    icon="print-outline"
                    label={`Print labels for ${location.name}`}
                    onPress={() => printLocationLabels(location, shelves)}
                  />
                  <IconButton
                    icon="pencil"
                    label={`Rename ${location.name}`}
                    onPress={() =>
                      setPrompt({
                        title: 'Rename location',
                        initialValue: location.name,
                        onSubmit: (name) => {
                          renameLocation(db, location.id, name);
                          refresh();
                        },
                      })
                    }
                  />
                  <IconButton
                    icon="trash-outline"
                    label={`Delete ${location.name}`}
                    danger
                    onPress={() => confirmDeleteLocation(location)}
                  />
                </View>
              </View>
              {shelves.map((shelf) => (
                <View key={shelf.id} style={styles.shelf}>
                  <View style={styles.headerRow}>
                    <Text style={styles.shelfName}>{shelf.name}</Text>
                    <View style={styles.headerActions}>
                      <IconButton
                        icon="duplicate-outline"
                        label={`Create bins on ${shelf.name}`}
                        onPress={() =>
                          setPrompt({
                            title: `How many new bins on ${shelf.name}?`,
                            placeholder: '4',
                            keyboardType: 'number-pad',
                            submitLabel: 'Create',
                            onSubmit: (value) => {
                              const count = Math.min(Math.max(parseInt(value, 10) || 0, 1), 100);
                              createBinsBulk(db, { count, shelfId: shelf.id });
                              refresh();
                            },
                          })
                        }
                      />
                      <IconButton
                        icon="grid-outline"
                        label={`Print poster for ${shelf.name}`}
                        onPress={async () => {
                          try {
                            await printShelfPoster({
                              shelfName: shelf.name,
                              locationName: location.name,
                              shelfPayload: { type: 'shelf', id: shelf.id },
                              bins: listBinsForShelf(db, shelf.id).map((bin) => ({
                                payload: { type: 'bin' as const, id: bin.id },
                                code: bin.short_code,
                                name: bin.name,
                              })),
                            });
                          } catch (err) {
                            Alert.alert(
                              'Print failed',
                              err instanceof Error ? err.message : String(err),
                            );
                          }
                        }}
                      />
                      <IconButton
                        icon="pencil"
                        label={`Rename ${shelf.name}`}
                        onPress={() =>
                          setPrompt({
                            title: 'Rename shelf',
                            initialValue: shelf.name,
                            onSubmit: (name) => {
                              renameShelf(db, shelf.id, name);
                              refresh();
                            },
                          })
                        }
                      />
                      <IconButton
                        icon="trash-outline"
                        label={`Delete ${shelf.name}`}
                        danger
                        onPress={() => confirmDeleteShelf(shelf)}
                      />
                    </View>
                  </View>
                  {listBinsForShelf(db, shelf.id).map((bin) => (
                    <BinRowLink key={bin.id} bin={bin} />
                  ))}
                </View>
              ))}
            </View>
          );
        })}

        {unassigned.length > 0 && (
          <View style={styles.locationCard}>
            <Text style={styles.locationName}>Unassigned bins</Text>
            {unassigned.map((bin) => (
              <BinRowLink key={bin.id} bin={bin} />
            ))}
          </View>
        )}
      </ScrollView>
      <PromptModal request={prompt} onClose={() => setPrompt(null)} />
      <Modal
        visible={printPicking}
        transparent
        animationType="fade"
        onRequestClose={() => setPrintPicking(false)}
      >
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Print which labels?</Text>
            <ScrollView style={styles.pickerList}>
              {listBins(db).map((bin) => {
                const checked = printSelected[bin.id] ?? false;
                return (
                  <Pressable
                    key={bin.id}
                    style={styles.pickerRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() =>
                      setPrintSelected((sel) => ({ ...sel, [bin.id]: !(sel[bin.id] ?? false) }))
                    }
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={checked ? colors.amber : colors.textFaint}
                    />
                    <CodeTag code={bin.short_code} small />
                    <Text style={styles.pickerName} numberOfLines={1}>
                      {bin.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => {
                  const bins = listBins(db);
                  const allOn = bins.every((b) => printSelected[b.id]);
                  setPrintSelected(Object.fromEntries(bins.map((b) => [b.id, !allOn])));
                }}
              >
                <Text style={styles.pickerLink}>All / none</Text>
              </Pressable>
              <View style={styles.pickerActionsRight}>
                <Pressable onPress={() => setPrintPicking(false)}>
                  <Text style={styles.pickerLink}>Cancel</Text>
                </Pressable>
                <Pressable onPress={printSelectedLabels}>
                  <Text style={styles.pickerPrint}>
                    Print {Object.values(printSelected).filter(Boolean).length}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { padding: sp(4), gap: sp(4), paddingBottom: sp(10) },
  toolbar: { flexDirection: 'row', gap: sp(2.5), flexWrap: 'wrap' },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.amber,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2),
    borderRadius: radius.md,
  },
  toolbarLabel: { color: colors.amberInkOn, fontWeight: '700', fontSize: 13 },
  toolbarButtonAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2),
    borderRadius: radius.md,
  },
  toolbarLabelAlt: { color: colors.steel, fontWeight: '600', fontSize: 13 },
  locationCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: sp(3.5),
    gap: sp(1),
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', gap: 2 },
  iconButton: { padding: sp(1.5) },
  locationName: { ...type.title, fontSize: 19 },
  shelf: { marginTop: sp(2), gap: 2 },
  shelfName: { ...type.stamp },
  binRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    paddingVertical: sp(2.25),
    paddingLeft: sp(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  binName: { ...type.body, flex: 1 },
  empty: { ...type.dim, paddingVertical: sp(6), textAlign: 'center' },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: sp(5),
  },
  pickerCard: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    padding: sp(4),
    gap: sp(3),
    maxHeight: '75%',
  },
  pickerTitle: { ...type.h2 },
  pickerList: { flexGrow: 0 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    paddingVertical: sp(2.25),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerName: { ...type.body, flex: 1 },
  pickerActions: { flexDirection: 'row', alignItems: 'center' },
  pickerActionsRight: { flexDirection: 'row', gap: sp(5), marginLeft: 'auto' },
  pickerLink: { color: colors.steel, fontWeight: '600' },
  pickerPrint: { color: colors.amber, fontWeight: '800' },
});
