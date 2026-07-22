import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin, itemsForBin } from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';

export default function BinDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  useFocusTick();

  const bin = id ? getBin(db, id) : null;
  if (!bin) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Bin not found.</Text>
      </View>
    );
  }
  const items = itemsForBin(db, bin.id);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${bin.short_code} · ${bin.name}` }} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <Text style={styles.meta}>
            {items.length} item{items.length === 1 ? '' : 's'}
            {bin.last_scanned_at ? ` · last scanned ${bin.last_scanned_at.slice(0, 10)}` : ''}
          </Text>
        }
        ListEmptyComponent={<Text style={styles.empty}>Nothing recorded in this bin yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <Text style={styles.itemQty}>{item.quantity}×</Text>
            <View style={styles.itemMain}>
              <Text style={styles.itemName}>
                {item.brand ? `${item.brand} ` : ''}
                {item.name}
              </Text>
              {item.label_text ? <Text style={styles.itemLabel}>{item.label_text}</Text> : null}
            </View>
            <Text style={styles.itemCategory}>{item.category.replace(/_/g, ' ')}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  meta: { color: '#666', marginBottom: 8 },
  itemRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    alignItems: 'center',
  },
  itemQty: { fontVariant: ['tabular-nums'], color: '#666', minWidth: 32 },
  itemMain: { flex: 1 },
  itemName: { fontSize: 16 },
  itemLabel: { fontSize: 12, color: '#888' },
  itemCategory: { fontSize: 11, color: '#999' },
  empty: { color: '#888', paddingVertical: 24, textAlign: 'center' },
});
