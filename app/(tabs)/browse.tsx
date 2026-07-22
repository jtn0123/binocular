import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { useDb } from '@/db/DbProvider';
import {
  createBinsBulk,
  createLocation,
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
import { useFocusTick } from '@/lib/useFocusTick';
import { printLabelSheet } from '@/qr/print';

function BinRowLink({ bin }: { bin: BinRow }) {
  return (
    <Link href={{ pathname: '/bin/[id]', params: { id: bin.id } }} asChild>
      <Pressable style={styles.binRow}>
        <Text style={styles.binCode}>{bin.short_code}</Text>
        <Text style={styles.binName}>{bin.name}</Text>
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
      <Ionicons name={icon} size={17} color={danger ? '#d33' : '#208AEF'} />
    </Pressable>
  );
}

export default function BrowseScreen() {
  const db = useDb();
  useFocusTick();
  const [tick, setTick] = useState(0);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const refresh = () => setTick((t) => t + 1);
  void tick;

  const locations = listLocations(db);
  const unassigned = listUnassignedBins(db);

  async function printAllLabels() {
    const bins = listBins(db);
    if (bins.length === 0) {
      Alert.alert('No bins', 'Create some bins first.');
      return;
    }
    try {
      await printLabelSheet(
        bins.map((bin) => ({
          payload: { type: 'bin', id: bin.id },
          code: bin.short_code,
          name: bin.name,
        })),
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
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.toolbarLabel}>Location</Text>
          </Pressable>
          <Pressable style={styles.toolbarButtonAlt} onPress={printAllLabels}>
            <Ionicons name="print" size={16} color="#208AEF" />
            <Text style={styles.toolbarLabelAlt}>Print bin labels</Text>
          </Pressable>
        </View>

        {locations.length === 0 && unassigned.length === 0 && (
          <Text style={styles.empty}>No locations yet — add one to get started.</Text>
        )}

        {locations.map((location) => {
          const shelves = listShelves(db, location.id);
          return (
            <View key={location.id} style={styles.location}>
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
          <View style={styles.location}>
            <Text style={styles.locationName}>Unassigned bins</Text>
            {unassigned.map((bin) => (
              <BinRowLink key={bin.id} bin={bin} />
            ))}
          </View>
        )}
      </ScrollView>
      <PromptModal request={prompt} onClose={() => setPrompt(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { padding: 16, gap: 16, paddingBottom: 40 },
  toolbar: { flexDirection: 'row', gap: 10 },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#208AEF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  toolbarLabel: { color: '#fff', fontWeight: '600', fontSize: 13 },
  toolbarButtonAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#208AEF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  toolbarLabelAlt: { color: '#208AEF', fontWeight: '600', fontSize: 13 },
  location: { gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', gap: 2 },
  iconButton: { padding: 6 },
  locationName: { fontSize: 20, fontWeight: '700' },
  shelf: { marginLeft: 8, marginTop: 8, gap: 2 },
  shelfName: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', color: '#666' },
  binRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    marginLeft: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  binCode: { fontVariant: ['tabular-nums'], fontWeight: '600', color: '#208AEF' },
  binName: { fontSize: 16, flexShrink: 1 },
  empty: { color: '#888', paddingVertical: 24, textAlign: 'center' },
});
