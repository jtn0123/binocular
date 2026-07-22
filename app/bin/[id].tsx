import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { useDb } from '@/db/DbProvider';
import { deleteBinIfEmpty, getBin, getShelf, itemsForBin, renameBin } from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';
import { printLabelSheet } from '@/qr/print';

function ActionChip({
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
    <Pressable style={[styles.action, danger && styles.actionDanger]} onPress={onPress}>
      <Ionicons name={icon} size={15} color={danger ? '#d33' : '#208AEF'} />
      <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

export default function BinDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const router = useRouter();
  useFocusTick();
  const [tick, setTick] = useState(0);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  void tick;

  const bin = id ? getBin(db, id) : null;
  if (!bin) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Bin not found.</Text>
      </View>
    );
  }
  const items = itemsForBin(db, bin.id);
  const shelf = bin.shelf_id ? getShelf(db, bin.shelf_id) : null;

  async function printLabel() {
    if (!bin) return;
    try {
      await printLabelSheet([
        { payload: { type: 'bin', id: bin.id }, code: bin.short_code, name: bin.name },
      ]);
    } catch (err) {
      Alert.alert('Print failed', err instanceof Error ? err.message : String(err));
    }
  }

  function confirmDelete() {
    if (!bin) return;
    if (items.length > 0) {
      Alert.alert('Bin not empty', 'Move or remove its items first — inventory is never deleted.');
      return;
    }
    Alert.alert(`Delete ${bin.short_code}?`, 'This bin is empty; the label becomes invalid.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (deleteBinIfEmpty(db, bin.id)) router.back();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${bin.short_code} · ${bin.name}` }} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            {bin.cover_photo_uri ? (
              <Image source={{ uri: bin.cover_photo_uri }} style={styles.cover} contentFit="cover" />
            ) : null}
            <Text style={styles.meta}>
              {items.length} item{items.length === 1 ? '' : 's'}
              {shelf ? ` · ${shelf.name}` : ' · unassigned'}
              {bin.last_scanned_at ? ` · scanned ${bin.last_scanned_at.slice(0, 10)}` : ''}
            </Text>
            <View style={styles.actionsRow}>
              <ActionChip
                icon="camera"
                label="Audit"
                onPress={() => router.push({ pathname: '/capture', params: { binId: bin.id } })}
              />
              <ActionChip
                icon="pencil"
                label="Rename"
                onPress={() =>
                  setPrompt({
                    title: 'Rename bin',
                    initialValue: bin.name,
                    onSubmit: (name) => {
                      renameBin(db, bin.id, name);
                      setTick((t) => t + 1);
                    },
                  })
                }
              />
              <ActionChip
                icon="arrow-redo"
                label="Move"
                onPress={() => router.push({ pathname: '/move/[binId]', params: { binId: bin.id } })}
              />
              <ActionChip icon="print" label="Label" onPress={printLabel} />
              <ActionChip icon="trash" label="Delete" danger onPress={confirmDelete} />
            </View>
          </View>
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
      <PromptModal request={prompt} onClose={() => setPrompt(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { gap: 10, marginBottom: 8 },
  cover: { width: '100%', height: 180, borderRadius: 12, backgroundColor: '#eee' },
  meta: { color: '#666' },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#bcdcf7',
    backgroundColor: '#f2f7fd',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
  },
  actionDanger: { borderColor: '#f3c1c1', backgroundColor: '#fdf4f4' },
  actionLabel: { color: '#1668b4', fontWeight: '600', fontSize: 13 },
  actionLabelDanger: { color: '#d33' },
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
