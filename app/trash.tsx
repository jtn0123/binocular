import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import {
  getBin,
  listDeletedItems,
  restoreDeletedItem,
  type BinRow,
  type DeletedItemRow,
} from '@/db/queries';
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

  /**
   * Replacement bins, keyed by the deleted bin they stand in for.
   *
   * Restoring items whose original bin is gone used to mint a brand new bin
   * per row, so five items from one deleted bin scattered across five
   * unlabelled bins — turning a restore into a tidying job. Items that lived
   * together land together.
   */
  const replacements = useRef<Map<string, string>>(new Map());

  function restore(row: DeletedItemRow) {
    const originalBin = row.bin_id ? getBin(db, row.bin_id) : null;
    let targetBinId = originalBin?.id;
    let created: BinRow | null = null;

    if (!targetBinId) {
      const key = row.bin_id ?? 'never-had-a-bin';
      const reused = replacements.current.get(key);
      // Re-check it still exists: the screen can outlive a bin deleted from
      // elsewhere, and restoring into a missing bin would fail silently.
      if (reused && getBin(db, reused)) {
        targetBinId = reused;
      } else {
        created = quickCreateBin(db);
        targetBinId = created.id;
        replacements.current.set(key, created.id);
      }
    }

    if (restoreDeletedItem(db, row.id, targetBinId)) {
      setTick((t) => t + 1);
      if (created) {
        // Say where it went. A restore that reports nothing leaves you
        // hunting for the thing you just recovered.
        Alert.alert(
          'Restored to a new bin',
          `${row.name} is in ${created.short_code}, because the bin it came from no longer exists. Anything else restored from that bin joins it there.`,
        );
      }
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
