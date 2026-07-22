import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin, listLocations, listShelves, moveBinToShelf } from '@/db/queries';
import { colors, radius, sp, type } from '@/theme';

/**
 * Move mode destination picker (blueprint §8.5): pick a shelf from the
 * tree, or jump to the label scanner. An optional locationId param
 * pre-filters to one location (set when a location QR was scanned).
 */
export default function MoveBinScreen() {
  const { binId, locationId } = useLocalSearchParams<{ binId: string; locationId?: string }>();
  const db = useDb();
  const router = useRouter();

  const bin = binId ? getBin(db, binId) : null;
  if (!bin) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>Bin not found.</Text>
      </View>
    );
  }

  const locations = listLocations(db).filter((l) => !locationId || l.id === locationId);

  function moveTo(shelfId: string | null) {
    if (!bin) return;
    moveBinToShelf(db, bin.id, shelfId);
    router.replace({ pathname: '/bin/[id]', params: { id: bin.id } });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: `Move ${bin.short_code}` }} />
      <Text style={styles.subtitle}>
        Where does {bin.short_code} · {bin.name} live now?
      </Text>

      <Pressable
        style={styles.scanButton}
        onPress={() => router.replace({ pathname: '/scan-code', params: { binId: bin.id } })}
      >
        <Ionicons name="qr-code" size={18} color={colors.amberInkOn} />
        <Text style={styles.scanLabel}>Scan a shelf label</Text>
      </Pressable>

      {locations.map((location) => (
        <View key={location.id} style={styles.location}>
          <Text style={styles.locationName}>{location.name}</Text>
          {listShelves(db, location.id).map((shelf) => (
            <Pressable
              key={shelf.id}
              style={[styles.shelfRow, shelf.id === bin.shelf_id && styles.shelfCurrent]}
              onPress={() => moveTo(shelf.id)}
              testID={`move-to-${shelf.id}`}
            >
              <Text style={styles.shelfName}>{shelf.name}</Text>
              {shelf.id === bin.shelf_id && <Text style={styles.currentTag}>current</Text>}
            </Pressable>
          ))}
        </View>
      ))}

      <Pressable style={styles.unassign} onPress={() => moveTo(null)}>
        <Text style={styles.unassignLabel}>Unassign (no shelf)</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: sp(4), gap: sp(3.5), paddingBottom: sp(10), backgroundColor: colors.bg, flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  subtitle: { ...type.dim, fontSize: 15 },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(2),
    backgroundColor: colors.amber,
    padding: sp(3.25),
    borderRadius: radius.lg,
  },
  scanLabel: { color: colors.amberInkOn, fontWeight: '800' },
  location: { gap: sp(1) },
  locationName: { ...type.h2, marginBottom: 2 },
  shelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: sp(3.25),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginLeft: sp(2),
    marginBottom: sp(1.5),
  },
  shelfCurrent: { opacity: 0.55, borderStyle: 'dashed' },
  shelfName: { ...type.body, fontWeight: '600' },
  currentTag: { fontSize: 11, color: colors.textFaint },
  unassign: { alignItems: 'center', padding: sp(2.5) },
  unassignLabel: { color: colors.textFaint },
  dim: { ...type.dim },
});
