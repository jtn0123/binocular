import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin, listLocations, listShelves, moveBinToShelf } from '@/db/queries';

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
        <Ionicons name="qr-code" size={18} color="#fff" />
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
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subtitle: { fontSize: 15, color: '#555' },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#208AEF',
    padding: 13,
    borderRadius: 12,
  },
  scanLabel: { color: '#fff', fontWeight: '700' },
  location: { gap: 4 },
  locationName: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  shelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 13,
    borderRadius: 10,
    backgroundColor: '#f2f7fd',
    marginLeft: 8,
    marginBottom: 6,
  },
  shelfCurrent: { backgroundColor: '#e8e8e8' },
  shelfName: { fontSize: 15, fontWeight: '500' },
  currentTag: { fontSize: 11, color: '#888' },
  unassign: { alignItems: 'center', padding: 10 },
  unassignLabel: { color: '#888' },
  dim: { color: '#888' },
});
