import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin, listDeletedItems, restoreDeletedItem, type DeletedItemRow } from '@/db/queries';
import { quickCreateBin } from '@/db/scaffold';
import { colors, radius, sp, type } from '@/theme';

/**
 * Recently deleted (blueprint D17): deleted items are restorable for 30
 * days, then purged on boot. Restore puts the item back in its original bin,
 * or a fresh bin if that one is gone.
 */
export default function TrashScreen() {
  const db = useDb();
  const [tick, setTick] = useState(0);
  void tick;
  const rows = listDeletedItems(db);

  function restore(row: DeletedItemRow) {
    const originalBin = row.bin_id ? getBin(db, row.bin_id) : null;
    let targetBinId = originalBin?.id;
    if (!targetBinId) {
      const created = quickCreateBin(db);
      targetBinId = created.id;
    }
    if (restoreDeletedItem(db, row.id, targetBinId)) {
      setTick((t) => t + 1);
    } else {
      Alert.alert('Restore failed', 'This item could not be restored.');
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Recently deleted' }} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ gap: sp(2), padding: sp(4) }}
        ListHeaderComponent={
          rows.length > 0 ? (
            <Text style={styles.note}>
              Deleted items stay here for 30 days, then are removed for good.
            </Text>
          ) : null
        }
        ListEmptyComponent={<Text style={styles.empty}>Nothing deleted recently.</Text>}
        renderItem={({ item: row }) => {
          const originalBin = row.bin_id ? getBin(db, row.bin_id) : null;
          return (
            <View style={styles.row}>
              <Ionicons name="trash-outline" size={18} color={colors.textFaint} />
              <View style={styles.main}>
                <Text style={styles.name} numberOfLines={1}>
                  {row.quantity > 1 ? `${row.quantity}× ` : ''}
                  {row.brand ? `${row.brand} ` : ''}
                  {row.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  deleted {row.deleted_at.slice(0, 10)}
                  {originalBin ? ` · from ${originalBin.short_code}` : ' · original bin gone'}
                </Text>
              </View>
              <Pressable
                style={styles.restore}
                onPress={() => restore(row)}
                accessibilityRole="button"
                accessibilityLabel={`Restore ${row.name}`}
                testID={`restore-${row.id}`}
              >
                <Text style={styles.restoreLabel}>Restore</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  note: { ...type.dim, fontSize: 12, marginBottom: sp(2) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: sp(3),
  },
  main: { flex: 1 },
  name: { ...type.body, fontWeight: '600' },
  meta: { ...type.dim, fontSize: 12 },
  restore: {
    backgroundColor: colors.amber,
    paddingHorizontal: sp(3),
    paddingVertical: sp(1.75),
    borderRadius: radius.pill,
  },
  restoreLabel: { color: colors.amberInkOn, fontWeight: '700', fontSize: 13 },
  empty: { ...type.dim, paddingVertical: sp(10), textAlign: 'center' },
});
