import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import {
  listBinsForShelf,
  listLocations,
  listShelves,
  listUnassignedBins,
  type BinRow,
} from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';

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

export default function BrowseScreen() {
  const db = useDb();
  useFocusTick();
  const locations = listLocations(db);
  const unassigned = listUnassignedBins(db);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {locations.length === 0 && (
        <Text style={styles.empty}>No locations yet. Location CRUD arrives in Stage 2.</Text>
      )}
      {locations.map((location) => (
        <View key={location.id} style={styles.location}>
          <Text style={styles.locationName}>{location.name}</Text>
          {listShelves(db, location.id).map((shelf) => (
            <View key={shelf.id} style={styles.shelf}>
              <Text style={styles.shelfName}>{shelf.name}</Text>
              {listBinsForShelf(db, shelf.id).map((bin) => (
                <BinRowLink key={bin.id} bin={bin} />
              ))}
            </View>
          ))}
        </View>
      ))}
      {unassigned.length > 0 && (
        <View style={styles.location}>
          <Text style={styles.locationName}>Unassigned bins</Text>
          {unassigned.map((bin) => (
            <BinRowLink key={bin.id} bin={bin} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  location: { gap: 4 },
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
