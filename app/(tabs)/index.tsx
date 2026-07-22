import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { listRecentBins } from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';

export default function HomeScreen() {
  const db = useDb();
  useFocusTick();
  const recentBins = listRecentBins(db, 10);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search your workshop… (arrives in Stage 3)"
        editable={false}
      />
      <Text style={styles.sectionTitle}>Recent bins</Text>
      <FlatList
        data={recentBins}
        keyExtractor={(bin) => bin.id}
        ListEmptyComponent={<Text style={styles.empty}>No bins yet — create one in Browse.</Text>}
        renderItem={({ item: bin }) => (
          <Link href={{ pathname: '/bin/[id]', params: { id: bin.id } }} asChild>
            <Pressable style={styles.row}>
              <Text style={styles.rowCode}>{bin.short_code}</Text>
              <Text style={styles.rowName}>{bin.name}</Text>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  search: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', color: '#666' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  rowCode: { fontVariant: ['tabular-nums'], fontWeight: '600', color: '#208AEF' },
  rowName: { fontSize: 16, flexShrink: 1 },
  empty: { color: '#888', paddingVertical: 24, textAlign: 'center' },
});
