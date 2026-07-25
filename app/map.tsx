import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { buildMap, describePlace, locate, mapSize, type MapCell } from '@/db/mapView';
import { listBins, listLocations, listShelves, itemsForBin } from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';
import { colors, mono, radius, sp, type } from '@/theme';

/**
 * The workshop map (blueprint D21).
 *
 * A schematic of the wall: shelves are rows, bins are cells. Nothing is
 * positioned by hand — the layout is derived, so this works on an existing
 * workshop with no setup at all.
 *
 * `highlight` marks the bin you were looking for, which is the whole point:
 * "where is my 10 mm socket" should end on a picture of the wall, not on a
 * breadcrumb that still leaves you standing in front of it. So the screen
 * names the bin, says which shelf it is on, and scrolls to it — a map that
 * makes you hunt for the marked spot is not doing its job.
 */
export default function MapScreen() {
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const db = useDb();
  const router = useRouter();
  useFocusTick();

  const areas = useMemo(() => {
    const locations = listLocations(db);
    const shelves = locations.flatMap((l) => listShelves(db, l.id));
    const bins = listBins(db);
    const itemCounts = new Map(bins.map((b) => [b.id, itemsForBin(db, b.id).length]));
    return buildMap({ locations, shelves, bins, itemCounts });
  }, [db]);

  const found = useMemo(() => (highlight ? locate(areas, highlight) : null), [areas, highlight]);

  const scrollRef = useRef<ScrollView>(null);
  const [scrolled, setScrolled] = useState(false);

  // Scroll the marked bin into view once, after its row has been laid out.
  // Once only: re-scrolling on every layout pass would fight the user the
  // moment they tried to look anywhere else.
  const onRowLayout = useCallback(
    (y: number) => {
      if (scrolled) return;
      setScrolled(true);
      scrollRef.current?.scrollTo({ y: Math.max(0, y - sp(6)), animated: true });
    },
    [scrolled],
  );

  const total = mapSize(areas);

  if (total === 0) {
    return (
      <ScrollView contentContainerStyle={styles.center}>
        <Stack.Screen options={{ title: 'Map' }} />
        <Text style={styles.dim}>
          Nothing to draw yet. Once you have a bin or two, this shows them laid out by shelf.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Map' }} />

      {highlight ? (
        found ? (
          <View style={styles.banner}>
            <Ionicons name="locate" size={18} color={colors.amber} />
            <View style={styles.bannerText}>
              <Text style={styles.bannerName} numberOfLines={1}>
                {found.cell.code} · {found.cell.name}
              </Text>
              <Text style={styles.bannerWhere} numberOfLines={1}>
                {describePlace(found)}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.banner}>
            <Ionicons name="help-circle-outline" size={18} color={colors.textDim} />
            <Text style={styles.bannerWhere}>That bin is not on the map.</Text>
          </View>
        )
      ) : null}

      {areas.map((area) => (
        <View key={area.locationId ?? 'unplaced'} style={styles.area}>
          <Text style={styles.areaName}>{area.name}</Text>
          {area.rows.map((row) => {
            const marked = found?.row === row;
            return (
              <View
                key={row.shelfId ?? 'unshelved'}
                style={[styles.row, marked && styles.rowFound]}
                onLayout={marked ? (e) => onRowLayout(e.nativeEvent.layout.y) : undefined}
              >
                <Text style={[styles.rowName, marked && styles.rowNameFound]} numberOfLines={1}>
                  {row.name}
                </Text>
                {row.bins.length === 0 ? (
                  <Text style={styles.rowEmpty}>no bins yet</Text>
                ) : (
                  <View style={styles.cells}>
                    {row.bins.map((cell) => (
                      <Cell
                        key={cell.binId}
                        cell={cell}
                        found={cell.binId === highlight}
                        onPress={() =>
                          router.push({ pathname: '/bin/[id]', params: { id: cell.binId } })
                        }
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}

      <Text style={styles.foot}>
        {total} bin{total === 1 ? '' : 's'} drawn. Shelves are rows — the layout comes from how your
        workshop is filed, not from anything you have to arrange here.
      </Text>
    </ScrollView>
  );
}

function Cell({ cell, found, onPress }: { cell: MapCell; found: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.cell, cell.empty && styles.cellEmpty, found && styles.cellFound]}
      accessibilityRole="button"
      accessibilityLabel={`${cell.code} ${cell.name}, ${cell.items} item${
        cell.items === 1 ? '' : 's'
      }${found ? ' — the bin you are looking for' : ''}`}
      testID={`map-cell-${cell.code}`}
    >
      <View style={styles.cellHead}>
        {cell.photoUri ? (
          <Image source={{ uri: cell.photoUri }} style={styles.cellPhoto} contentFit="cover" />
        ) : (
          <View style={[styles.cellPhoto, styles.cellPhotoEmpty]}>
            <Ionicons
              name="cube-outline"
              size={14}
              color={found ? colors.amberInkOn : colors.textFaint}
            />
          </View>
        )}
        <Text style={[styles.cellCode, found && styles.cellCodeFound]} numberOfLines={1}>
          {cell.code}
        </Text>
        {found ? <Ionicons name="locate" size={13} color={colors.amberInkOn} /> : null}
      </View>
      <Text style={[styles.cellName, found && styles.cellNameFound]} numberOfLines={2}>
        {cell.name}
      </Text>
      <Text style={[styles.cellCount, found && styles.cellNameFound]}>
        {cell.empty ? 'empty' : `${cell.items} item${cell.items === 1 ? '' : 's'}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: sp(4),
    paddingBottom: sp(12),
    gap: sp(4),
    backgroundColor: colors.bg,
    flexGrow: 1,
  },
  center: { flex: 1, justifyContent: 'center', padding: sp(6), backgroundColor: colors.bg },
  dim: { ...type.dim, textAlign: 'center', lineHeight: 20 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    backgroundColor: colors.chipSelectedBg,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    borderRadius: radius.md,
    padding: sp(3),
  },
  bannerText: { flex: 1, gap: 2 },
  bannerName: { color: colors.amber, fontFamily: mono, fontSize: 14 },
  bannerWhere: { color: colors.textDim, fontSize: 12 },
  area: { gap: sp(2) },
  areaName: { ...type.stamp },
  row: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: sp(2.5),
    gap: sp(1.5),
    marginBottom: sp(1),
  },
  rowFound: { borderLeftColor: colors.amber },
  rowName: { color: colors.textDim, fontSize: 12, fontFamily: mono },
  rowNameFound: { color: colors.amber },
  rowEmpty: { color: colors.textFaint, fontSize: 11, fontStyle: 'italic' },
  cells: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  cell: {
    width: 104,
    minHeight: 92,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: sp(2),
    gap: 3,
  },
  cellEmpty: { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
  cellFound: { backgroundColor: colors.amber, borderColor: colors.amber },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  cellPhoto: { width: 22, height: 22, borderRadius: radius.sm },
  cellPhotoEmpty: {
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellCode: { color: colors.steel, fontFamily: mono, fontSize: 11, flex: 1 },
  cellCodeFound: { color: colors.amberInkOn },
  cellName: { color: colors.text, fontSize: 12, flex: 1 },
  cellNameFound: { color: colors.amberInkOn },
  cellCount: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  foot: { ...type.dim, fontSize: 11, lineHeight: 16 },
});
