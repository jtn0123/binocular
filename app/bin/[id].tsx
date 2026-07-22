import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { useDb } from '@/db/DbProvider';
import {
  checkOutItem,
  deleteBinIfEmpty,
  getBin,
  getShelf,
  itemsForBin,
  listAuditHistory,
  renameBin,
  returnItem,
  setItemQuantity,
  setLowStockThreshold,
  type ItemRow,
} from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';
import { printLabelSheet } from '@/qr/print';
import { colors, mono, radius, sp, type } from '@/theme';

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
      <Ionicons name={icon} size={15} color={danger ? colors.danger : colors.steel} />
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
  const history = listAuditHistory(db, bin.id);

  function openItemMenu(item: ItemRow) {
    const buttons = [
      item.checked_out_to
        ? {
            text: `Return (out to ${item.checked_out_to})`,
            onPress: () => {
              returnItem(db, item.id);
              setTick((t) => t + 1);
            },
          }
        : {
            text: 'Check out to…',
            onPress: () =>
              setPrompt({
                title: `Check out ${item.name} to…`,
                placeholder: 'e.g. Sam',
                submitLabel: 'Check out',
                onSubmit: (who) => {
                  checkOutItem(db, item.id, who);
                  setTick((t) => t + 1);
                },
              }),
          },
      {
        text: 'Adjust quantity…',
        onPress: () =>
          setPrompt({
            title: `Quantity of ${item.name}`,
            initialValue: String(item.quantity),
            keyboardType: 'number-pad' as const,
            onSubmit: (value) => {
              setItemQuantity(db, item.id, parseInt(value, 10) || 0);
              setTick((t) => t + 1);
            },
          }),
      },
      {
        text: item.low_stock_threshold === null ? 'Set low-stock alert…' : 'Change low-stock alert…',
        onPress: () =>
          setPrompt({
            title: `Alert when ${item.name} is at or below…`,
            initialValue: item.low_stock_threshold === null ? '' : String(item.low_stock_threshold),
            placeholder: '10 (0 clears it)',
            keyboardType: 'number-pad' as const,
            onSubmit: (value) => {
              const threshold = parseInt(value, 10) || 0;
              setLowStockThreshold(db, item.id, threshold > 0 ? threshold : null);
              setTick((t) => t + 1);
            },
          }),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(item.name, undefined, buttons);
  }

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
            {history.length > 1 && (
              <View>
                <Text style={styles.historyTitle}>Audit history</Text>
                <FlatList
                  horizontal
                  data={history}
                  keyExtractor={(scan) => scan.id}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                  renderItem={({ item: scan }) => (
                    <View style={styles.historyCell}>
                      <Image
                        source={{ uri: scan.photo_uri }}
                        style={styles.historyThumb}
                        contentFit="cover"
                      />
                      <Text style={styles.historyDate}>{scan.created_at.slice(0, 10)}</Text>
                    </View>
                  )}
                />
              </View>
            )}
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Nothing recorded in this bin yet.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.itemRow} onLongPress={() => openItemMenu(item)} delayLongPress={300}>
            <Text style={styles.itemQty}>{item.quantity}×</Text>
            <View style={styles.itemMain}>
              <Text style={styles.itemName}>
                {item.brand ? `${item.brand} ` : ''}
                {item.name}
              </Text>
              {item.label_text ? <Text style={styles.itemLabel}>{item.label_text}</Text> : null}
              {item.checked_out_to ? (
                <Text style={styles.itemOut}>checked out to {item.checked_out_to}</Text>
              ) : null}
              {item.low_stock_threshold !== null && item.quantity <= item.low_stock_threshold ? (
                <Text style={styles.itemLow}>running low</Text>
              ) : null}
            </View>
            <Text style={styles.itemCategory}>{item.category.replace(/_/g, ' ')}</Text>
          </Pressable>
        )}
      />
      <PromptModal request={prompt} onClose={() => setPrompt(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: sp(4) },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  header: { gap: sp(2.5), marginBottom: sp(2) },
  cover: {
    width: '100%',
    height: 190,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meta: { ...type.dim },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: sp(2.75),
    paddingVertical: sp(1.75),
    borderRadius: radius.pill,
  },
  actionDanger: { borderColor: '#5A2F2A', backgroundColor: colors.dangerDim },
  actionLabel: { color: colors.steel, fontWeight: '600', fontSize: 13 },
  actionLabelDanger: { color: colors.danger },
  itemRow: {
    flexDirection: 'row',
    gap: sp(2.5),
    paddingVertical: sp(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  itemQty: { fontFamily: mono, color: colors.textDim, minWidth: 34, fontSize: 13 },
  itemMain: { flex: 1 },
  itemName: { ...type.body, fontSize: 16 },
  itemLabel: { fontSize: 12, color: colors.textFaint, fontFamily: mono },
  itemCategory: { fontSize: 11, color: colors.textFaint },
  itemOut: { fontSize: 11, color: colors.warn },
  itemLow: { fontSize: 11, color: colors.danger },
  historyTitle: { ...type.stamp, marginBottom: sp(1.5), marginTop: sp(1) },
  historyCell: { alignItems: 'center', gap: 2 },
  historyThumb: {
    width: 72,
    height: 54,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.border,
  },
  historyDate: { fontSize: 10, color: colors.textFaint, fontFamily: mono },
  empty: { ...type.dim, paddingVertical: sp(6), textAlign: 'center' },
});
