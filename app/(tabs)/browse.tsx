import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CodeTag } from '@/components/CodeTag';
import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ShelfSheet, type ShelfDraft } from '@/components/map/ShelfSheet';
import { useDb } from '@/db/DbProvider';
import {
  createBinsBulk,
  createLocation,
  getBinPlace,
  createShelf,
  deleteLocation,
  deleteShelf,
  itemCountsByBin,
  listBins,
  listBinsForShelf,
  listLocations,
  listShelves,
  listUnassignedBins,
  renameLocation,
  renameShelf,
  setShelfCapacity,
  type BinRow,
  type LocationRow,
  type ShelfRow,
} from '@/db/queries';
import { quickCreateBin } from '@/db/scaffold';
import { useFocusTick } from '@/lib/useFocusTick';
import { scannedAgo } from '@/lib/time';
import { printLabelSheet, printShelfPoster } from '@/qr/print';
import { colors, mono, radius, sp, type } from '@/theme';

/**
 * Browse: the wall as a list (v3).
 *
 * The map answers "where is it"; this answers "what have I got, and is any of
 * it stale". Same hierarchy, same rows, no second truth — a rack is a
 * location, its shelves are the groups, its bins are the lines. Each line
 * carries what a list can say and a picture cannot: how many items are in the
 * bin, and how long since anyone looked in it.
 *
 * The filter narrows to matching bins and hides the shelves that end up empty,
 * because a filtered list full of empty headings is a worse answer than a
 * short one.
 */
function BinLine({
  bin,
  itemCount,
}: {
  bin: BinRow;
  itemCount: number;
}) {
  return (
    <Link href={{ pathname: '/bin/[id]', params: { id: bin.id } }} asChild>
      <Pressable
        style={styles.binRow}
        accessibilityRole="button"
        accessibilityLabel={`Bin ${bin.short_code}, ${bin.name}, ${itemCount} item${
          itemCount === 1 ? '' : 's'
        }, ${scannedAgo(bin.last_scanned_at)}`}
      >
        <CodeTag code={bin.short_code} small />
        <View style={styles.binMain}>
          <Text style={styles.binName} numberOfLines={1}>
            {bin.name}
          </Text>
          <Text style={styles.binMeta} numberOfLines={1}>
            {itemCount === 0 ? 'empty' : `${itemCount} item${itemCount === 1 ? '' : 's'}`} ·{' '}
            {scannedAgo(bin.last_scanned_at)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={13} color={colors.textFaint} />
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
    <Pressable style={styles.iconButton} onPress={onPress} accessibilityLabel={label} hitSlop={6}>
      <Ionicons name={icon} size={16} color={danger ? colors.danger : colors.steel} />
    </Pressable>
  );
}

export default function BrowseScreen() {
  const db = useDb();
  useFocusTick();
  const [tick, setTick] = useState(0);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<(ShelfDraft & { locationId: string }) | null>(null);
  // Print picker (field-test ask): choose which bins to print, not all-or-nothing.
  const [printPicking, setPrintPicking] = useState(false);
  const [printSelected, setPrintSelected] = useState<Record<string, boolean>>({});
  const refresh = () => setTick((t) => t + 1);
  // Searching a shelf or location from Home lands here; highlight and scroll
  // to it, otherwise the tree is a wall of identical cards to hunt through.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  // A shelf lays out relative to its location card, so the scroll position is
  // the sum of the two. Kept apart because the two onLayout callbacks fire
  // independently and in no guaranteed order.
  const focusParentY = useRef(0);
  const focusY = useRef<number | null>(null);

  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => {
      if (focusY.current === null) return;
      const y = focusParentY.current + focusY.current;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [focus]);

  const locations = listLocations(db);
  const unassigned = listUnassignedBins(db);
  // One grouped count rather than one query per bin — the same reason the map
  // does it: this re-runs on every keystroke in the filter. `tick` is the
  // dependency that matters and the linter cannot see it, since the query
  // reads the database rather than any value in scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const counts = useMemo(() => itemCountsByBin(db), [db, tick]);
  const filter = query.trim().toLowerCase();
  const matches = (bin: BinRow) =>
    !filter ||
    bin.name.toLowerCase().includes(filter) ||
    bin.short_code.toLowerCase().includes(filter);

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
          const where = [place.shelfName, place.locationName].filter(Boolean).join(' · ');
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

  const empty = locations.length === 0 && unassigned.length === 0;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Browse"
        action={{
          icon: 'add-circle-outline',
          label: 'Create a new bin',
          tone: 'amber',
          onPress: () => {
            quickCreateBin(db);
            refresh();
          },
          testID: 'browse-new-bin',
        }}
      />
      <View style={styles.toolbar}>
        <Pressable
          style={styles.toolbarButtonAlt}
          accessibilityRole="button"
          accessibilityLabel="Create a new location"
          onPress={() =>
            setPrompt({
              title: 'New location',
              placeholder: 'e.g. R2 · Main run',
              onSubmit: (name) => {
                createLocation(db, { name });
                refresh();
              },
            })
          }
        >
          <Ionicons name="add" size={16} color={colors.steel} />
          <Text style={styles.toolbarLabelAlt}>Location</Text>
        </Pressable>
        <Pressable
          style={styles.toolbarButtonAlt}
          accessibilityRole="button"
          accessibilityLabel="Print bin labels"
          onPress={openPrintPicker}
        >
          <Ionicons name="print" size={16} color={colors.steel} />
          <Text style={styles.toolbarLabelAlt}>Labels</Text>
        </Pressable>
        {/* D21: the map is a view of this same list, so this is where you
            would go looking for it — kept even though the map is now a tab,
            because that is where a field tester actually looked for it. */}
        <Link href="/map" asChild>
          <Pressable
            style={styles.toolbarButtonAlt}
            accessibilityRole="button"
            accessibilityLabel="See the workshop as a map"
          >
            <Ionicons name="map" size={16} color={colors.steel} />
            <Text style={styles.toolbarLabelAlt}>Map</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.filterWrap}>
        <Ionicons name="search-outline" size={16} color={colors.textFaint} />
        <TextInput
          style={styles.filter}
          value={query}
          onChangeText={setQuery}
          placeholder="Filter bins"
          placeholderTextColor={colors.textFaint}
          autoCorrect={false}
          accessibilityLabel="Filter bins"
          testID="browse-filter"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear the filter"
          >
            <Ionicons name="close-circle" size={16} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.container}>
        {empty && (
          <Text style={styles.empty}>
            Empty workshop — tap + Bin for a one-tap start (a default location and shelf are
            created for you), or + Location to lay out your space first.
          </Text>
        )}

        {locations.map((location) => {
          const shelves = listShelves(db, location.id);
          const rows = shelves.map((shelf) => ({
            shelf,
            bins: listBinsForShelf(db, shelf.id).filter(matches),
            total: listBinsForShelf(db, shelf.id).length,
          }));
          // A filtered view that keeps every empty heading answers the
          // question with a wall of nothing.
          const visible = filter ? rows.filter((r) => r.bins.length > 0) : rows;
          if (filter && visible.length === 0) return null;
          return (
            <View
              key={location.id}
              style={[styles.area, focus === location.id && styles.focused]}
              onLayout={(e) => {
                if (focus === location.id) {
                  focusParentY.current = 0;
                  focusY.current = e.nativeEvent.layout.y;
                } else if (shelves.some((shelf) => shelf.id === focus)) {
                  focusParentY.current = e.nativeEvent.layout.y;
                }
              }}
            >
              <View style={styles.areaHead}>
                <Text style={styles.areaName} numberOfLines={1}>
                  {location.name}
                </Text>
                <View style={styles.areaActions}>
                  <IconButton
                    icon="add-circle-outline"
                    label={`Add shelf to ${location.name}`}
                    onPress={() =>
                      setPrompt({
                        title: `New shelf in ${location.name}`,
                        placeholder: 'e.g. Top',
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

              {visible.map(({ shelf, bins, total }) => {
                const over = shelf.capacity !== null && total > shelf.capacity;
                return (
                  <View
                    key={shelf.id}
                    style={[styles.shelf, focus === shelf.id && styles.focused]}
                    onLayout={(e) => {
                      if (focus === shelf.id) focusY.current = e.nativeEvent.layout.y;
                    }}
                  >
                    <Pressable
                      style={styles.shelfHead}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${shelf.name}`}
                      testID={`browse-shelf-${shelf.id}`}
                      onPress={() =>
                        setSheet({
                          shelfId: shelf.id,
                          locationId: location.id,
                          locationName: location.name,
                          name: shelf.name,
                          capacity: shelf.capacity,
                          binCount: total,
                        })
                      }
                    >
                      <Text style={styles.shelfName} numberOfLines={1}>
                        {shelf.name}
                      </Text>
                      <Text style={[styles.shelfFill, over && styles.shelfFillOver]}>
                        {shelf.capacity !== null ? `${total}/${shelf.capacity}` : String(total)}
                        {over ? ' — over' : ''}
                      </Text>
                      <Ionicons name="pencil" size={13} color={colors.textFaint} />
                    </Pressable>

                    {bins.map((bin) => (
                      <BinLine key={bin.id} bin={bin} itemCount={counts.get(bin.id) ?? 0} />
                    ))}
                    {bins.length === 0 ? (
                      <Text style={styles.shelfEmpty}>Nothing filed here yet.</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}

        {unassigned.filter(matches).length > 0 && (
          <View style={styles.area}>
            <View style={styles.areaHead}>
              <Text style={styles.areaName}>Not on a shelf</Text>
            </View>
            <View style={styles.shelf}>
              {unassigned.filter(matches).map((bin) => (
                <BinLine key={bin.id} bin={bin} itemCount={counts.get(bin.id) ?? 0} />
              ))}
            </View>
          </View>
        )}

        {!empty && filter && (
          <BrowseFilterEmpty
            query={query.trim()}
            anyMatch={listBins(db).some(matches)}
          />
        )}
      </ScrollView>

      <ShelfSheet
        shelf={sheet}
        onRename={(name) => {
          if (!sheet) return;
          renameShelf(db, sheet.shelfId, name);
          setSheet({ ...sheet, name });
          refresh();
        }}
        onCapacity={(capacity) => {
          if (!sheet) return;
          setShelfCapacity(db, sheet.shelfId, capacity);
          setSheet({ ...sheet, capacity });
          refresh();
        }}
        onAddBin={() => {
          if (!sheet) return;
          createBinsBulk(db, { count: 1, shelfId: sheet.shelfId });
          setSheet({ ...sheet, binCount: sheet.binCount + 1 });
          refresh();
        }}
        onDelete={() => {
          if (!sheet) return;
          deleteShelf(db, sheet.shelfId);
          setSheet(null);
          refresh();
        }}
        onClose={() => setSheet(null)}
        extras={
          sheet
            ? [
                {
                  key: 'bulk',
                  icon: 'duplicate-outline',
                  label: 'Create bins…',
                  onPress: () => {
                    const target = sheet;
                    setSheet(null);
                    setPrompt({
                      title: `How many new bins on ${target.name}?`,
                      placeholder: '4',
                      keyboardType: 'number-pad',
                      submitLabel: 'Create',
                      onSubmit: (value) => {
                        const count = Math.min(Math.max(parseInt(value, 10) || 0, 1), 100);
                        createBinsBulk(db, { count, shelfId: target.shelfId });
                        refresh();
                      },
                    });
                  },
                },
                {
                  key: 'poster',
                  icon: 'grid-outline',
                  label: 'Print poster',
                  onPress: async () => {
                    const target = sheet;
                    setSheet(null);
                    try {
                      await printShelfPoster({
                        shelfName: target.name,
                        locationName: target.locationName,
                        shelfPayload: { type: 'shelf', id: target.shelfId },
                        bins: listBinsForShelf(db, target.shelfId).map((bin) => ({
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
                  },
                },
              ]
            : undefined
        }
      />

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

/** Says nothing matched, but only once the filter really has excluded it all. */
function BrowseFilterEmpty({ query, anyMatch }: { query: string; anyMatch: boolean }) {
  if (anyMatch) return null;
  return <Text style={styles.empty}>No bin matches “{query}”.</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { paddingBottom: sp(10) },
  // The errands that are not "add a bin": quieter than the header's action,
  // and quieter than they were, since the map now creates racks itself.
  toolbar: {
    flexDirection: 'row',
    gap: sp(2),
    flexWrap: 'wrap',
    paddingHorizontal: sp(4),
    paddingTop: sp(1),
  },
  toolbarButtonAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: sp(2.5),
    paddingVertical: sp(1.5),
    borderRadius: radius.md,
  },
  toolbarLabelAlt: { color: colors.steel, fontWeight: '600', fontSize: 12 },
  filterWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.25),
    marginHorizontal: sp(4),
    marginTop: sp(2.5),
    marginBottom: sp(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2.25),
  },
  filter: { flex: 1, color: colors.text, fontSize: 13.5, padding: 0 },
  area: { paddingHorizontal: sp(4), paddingBottom: sp(3.5) },
  areaHead: { flexDirection: 'row', alignItems: 'center', gap: sp(2), paddingBottom: sp(1.5) },
  areaName: { ...type.stamp, flex: 1 },
  areaActions: { flexDirection: 'row', gap: sp(1) },
  iconButton: { padding: sp(1.25) },
  shelf: { paddingBottom: sp(3.5) },
  // Where a search for a shelf or location lands.
  focused: { borderWidth: 1, borderColor: colors.amber, borderRadius: radius.md },
  shelfHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
    paddingVertical: sp(1.75),
    paddingHorizontal: sp(0.5),
  },
  shelfName: {
    color: colors.textDim,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  shelfFill: { flex: 1, color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  shelfFillOver: { color: colors.danger },
  shelfEmpty: {
    color: colors.textFaint,
    fontSize: 11.5,
    padding: sp(2.5),
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 9,
  },
  binRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.75),
    backgroundColor: '#1A1D20',
    borderWidth: 1,
    borderColor: '#262A2F',
    borderRadius: 9,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2.75),
    marginBottom: 1,
  },
  binMain: { flex: 1, gap: 2 },
  binName: { ...type.body, fontSize: 13.5 },
  binMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5 },
  empty: { ...type.dim, paddingVertical: sp(6), paddingHorizontal: sp(5), textAlign: 'center' },
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
