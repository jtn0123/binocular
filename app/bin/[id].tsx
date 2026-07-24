import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { useDb } from '@/db/DbProvider';
import {
  checkOutItem,
  deleteBinIfEmpty,
  deleteItem,
  getBin,
  getScan,
  getShelf,
  insertItem,
  itemsForBin,
  listAuditHistory,
  listItemPhotoUris,
  renameBin,
  returnItem,
  setItemQuantity,
  setLowStockThreshold,
  updateItem,
  type ItemRow,
} from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';
import { printLabelSheet } from '@/qr/print';
import { ChipEditor } from '@/review/ReviewScreen';
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
  const [adding, setAdding] = useState(false);
  const [sheetItem, setSheetItem] = useState<ItemRow | null>(null);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  // Delete works via undo, not a blocking confirm (field-test ask): the row
  // is removed immediately and a snackbar restores it — inventory is never
  // silently lost (§11), the whole record round-trips.
  const [undoItem, setUndoItem] = useState<ItemRow | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  void tick;
  const refresh = () => setTick((t) => t + 1);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

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
  const itemPhotos = bin.cover_photo_uri ? [] : listItemPhotoUris(db, bin.id);

  function removeItem(item: ItemRow) {
    deleteItem(db, item.id);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoItem(item);
    undoTimer.current = setTimeout(() => setUndoItem(null), 6000);
    setSheetItem(null);
    refresh();
  }

  function undoRemove() {
    if (!undoItem) return;
    insertItem(db, {
      id: undoItem.id,
      binId: undoItem.bin_id,
      name: undoItem.name,
      brand: undoItem.brand,
      category: undoItem.category,
      quantity: undoItem.quantity,
      labelText: undoItem.label_text,
      photoUri: undoItem.photo_uri,
      notes: undoItem.notes,
      lowStockThreshold: undoItem.low_stock_threshold,
      sourceScanId: undoItem.source_scan_id,
    });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoItem(null);
    refresh();
  }

  function promptQuantity(item: ItemRow) {
    setPrompt({
      title: `Quantity of ${item.name}`,
      initialValue: String(item.quantity),
      keyboardType: 'number-pad',
      onSubmit: (value) => {
        setItemQuantity(db, item.id, Math.max(0, parseInt(value, 10) || 0));
        refresh();
      },
    });
  }

  function promptLowStock(item: ItemRow) {
    setPrompt({
      title: `Alert when ${item.name} is at or below…`,
      initialValue: item.low_stock_threshold === null ? '' : String(item.low_stock_threshold),
      placeholder: '10 (0 clears it)',
      keyboardType: 'number-pad',
      onSubmit: (value) => {
        const threshold = parseInt(value, 10) || 0;
        setLowStockThreshold(db, item.id, threshold > 0 ? threshold : null);
        refresh();
      },
    });
  }

  function promptCheckout(item: ItemRow) {
    setPrompt({
      title: `Check out ${item.name} to…`,
      placeholder: 'e.g. Sam',
      submitLabel: 'Check out',
      onSubmit: (who) => {
        checkOutItem(db, item.id, who);
        refresh();
      },
    });
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
            ) : (
              itemPhotos.length > 0 && (
                <View style={styles.coverCollage}>
                  {itemPhotos.map((uri, i) => (
                    <Image
                      key={`${uri}-${i}`}
                      source={{ uri }}
                      style={[
                        styles.collageCell,
                        itemPhotos.length === 1 && styles.collageCellFull,
                        itemPhotos.length === 2 && styles.collageCellHalf,
                      ]}
                      contentFit="cover"
                    />
                  ))}
                </View>
              )
            )}
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
              <ActionChip icon="add" label="Add item" onPress={() => setAdding(true)} />
              <ActionChip
                icon="pencil"
                label="Rename"
                onPress={() =>
                  setPrompt({
                    title: 'Rename bin',
                    initialValue: bin.name,
                    onSubmit: (name) => {
                      renameBin(db, bin.id, name);
                      refresh();
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
          <ReanimatedSwipeable
            friction={2}
            rightThreshold={36}
            overshootRight={false}
            renderRightActions={() => (
              <Pressable
                style={styles.swipeDelete}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${item.name}`}
                onPress={() => removeItem(item)}
              >
                <Ionicons name="trash" size={18} color="#fff" />
                <Text style={styles.swipeDeleteLabel}>Delete</Text>
              </Pressable>
            )}
          >
            <View style={styles.itemRow}>
              {/* Tap the quantity to edit it directly (field-test ask). */}
              <Pressable
                onPress={() => promptQuantity(item)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Change quantity of ${item.name}, currently ${item.quantity}`}
                testID={`qty-${item.id}`}
              >
                <Text style={styles.itemQty}>{item.quantity}×</Text>
              </Pressable>
              <Pressable
                style={styles.itemMain}
                onPress={() => setSheetItem(item)}
                onLongPress={() => setSheetItem(item)}
                delayLongPress={300}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} — photo and options`}
              >
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
              </Pressable>
              <Text style={styles.itemCategory}>{item.category.replace(/_/g, ' ')}</Text>
            </View>
          </ReanimatedSwipeable>
        )}
      />
      {undoItem && (
        <View style={styles.snackbar} testID="undo-snackbar">
          <Text style={styles.snackbarText} numberOfLines={1}>
            Deleted {undoItem.name}
          </Text>
          <Pressable onPress={undoRemove} hitSlop={8}>
            <Text style={styles.snackbarUndo}>UNDO</Text>
          </Pressable>
        </View>
      )}
      <PromptModal request={prompt} onClose={() => setPrompt(null)} />
      <ChipEditor
        visible={adding}
        chip={null}
        onCancel={() => setAdding(false)}
        onDelete={null}
        onSave={(values) => {
          insertItem(db, {
            binId: bin.id,
            name: values.name,
            brand: values.brand,
            category: values.category,
            quantity: values.quantity,
            labelText: values.labelText,
          });
          setAdding(false);
          refresh();
        }}
      />
      <ItemSheet
        db={db}
        item={sheetItem}
        onClose={() => setSheetItem(null)}
        onEdit={(item) => {
          setSheetItem(null);
          setEditing(item);
        }}
        onQuantity={(item) => {
          setSheetItem(null);
          promptQuantity(item);
        }}
        onLowStock={(item) => {
          setSheetItem(null);
          promptLowStock(item);
        }}
        onCheckoutOrReturn={(item) => {
          setSheetItem(null);
          if (item.checked_out_to) {
            returnItem(db, item.id);
            refresh();
          } else {
            promptCheckout(item);
          }
        }}
        onDelete={removeItem}
      />
      <ChipEditor
        visible={editing !== null}
        chip={
          editing
            ? {
                key: editing.id,
                name: editing.name,
                brand: editing.brand,
                category: editing.category,
                quantity: editing.quantity,
                labelText: editing.label_text,
                confidence: null,
                selected: true,
                matchedExistingId: null,
              }
            : null
        }
        onCancel={() => setEditing(null)}
        onDelete={null}
        onSave={(values) => {
          if (editing) {
            updateItem(db, editing.id, {
              name: values.name,
              brand: values.brand,
              category: values.category,
              quantity: values.quantity,
              labelText: values.labelText,
            });
          }
          setEditing(null);
          refresh();
        }}
      />
    </View>
  );
}

/**
 * Themed replacement for the old system Alert menu (field-test: "archaic,
 * can't back off it, doesn't fit the theme"). Tap an item → its photo (from
 * the scan that cataloged it) plus every action; backdrop tap dismisses.
 */
function ItemSheet({
  db,
  item,
  onClose,
  onEdit,
  onQuantity,
  onLowStock,
  onCheckoutOrReturn,
  onDelete,
}: {
  db: ReturnType<typeof useDb>;
  item: ItemRow | null;
  onClose: () => void;
  onEdit: (item: ItemRow) => void;
  onQuantity: (item: ItemRow) => void;
  onLowStock: (item: ItemRow) => void;
  onCheckoutOrReturn: (item: ItemRow) => void;
  onDelete: (item: ItemRow) => void;
}) {
  const sourceScan = item?.source_scan_id ? getScan(db, item.source_scan_id) : null;
  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={() => {}}>
          {item && (
            <>
              {sourceScan?.photo_uri ? (
                <Image
                  source={{ uri: sourceScan.photo_uri }}
                  style={styles.sheetPhoto}
                  contentFit="contain"
                />
              ) : null}
              <Text style={styles.sheetName}>
                {item.quantity > 1 ? `${item.quantity}× ` : ''}
                {item.brand ? `${item.brand} ` : ''}
                {item.name}
              </Text>
              <Text style={styles.sheetMeta}>
                {item.category.replace(/_/g, ' ')}
                {item.label_text ? ` · ${item.label_text}` : ''}
                {sourceScan ? ` · scanned ${sourceScan.created_at.slice(0, 10)}` : ' · added manually'}
              </Text>
              <SheetRow icon="pencil" label="Edit name, tag, details" onPress={() => onEdit(item)} />
              <SheetRow
                icon="swap-vertical"
                label={`Adjust quantity (${item.quantity})`}
                onPress={() => onQuantity(item)}
              />
              <SheetRow
                icon="notifications-outline"
                label={
                  item.low_stock_threshold === null
                    ? 'Set low-stock alert'
                    : `Low-stock alert (at ${item.low_stock_threshold})`
                }
                onPress={() => onLowStock(item)}
              />
              <SheetRow
                icon={item.checked_out_to ? 'arrow-undo' : 'exit-outline'}
                label={
                  item.checked_out_to ? `Return (out to ${item.checked_out_to})` : 'Check out to…'
                }
                onPress={() => onCheckoutOrReturn(item)}
              />
              <SheetRow
                icon="trash-outline"
                label="Delete item"
                danger
                onPress={() => onDelete(item)}
              />
              <Pressable onPress={onClose} style={styles.sheetClose}>
                <Text style={styles.sheetCloseLabel}>Close</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetRow({
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
    <Pressable style={styles.sheetRow} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.steel} />
      <Text style={[styles.sheetRowLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
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
  coverCollage: {
    width: '100%',
    height: 190,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    overflow: 'hidden',
  },
  collageCell: { width: '49%', height: 92 },
  collageCellFull: { width: '100%', height: 186 },
  collageCellHalf: { height: 186 },
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
    backgroundColor: colors.bg,
  },
  itemQty: { fontFamily: mono, color: colors.textDim, minWidth: 34, fontSize: 13 },
  itemMain: { flex: 1 },
  itemName: { ...type.body, fontSize: 16 },
  itemLabel: { fontSize: 12, color: colors.textFaint, fontFamily: mono },
  itemCategory: { fontSize: 11, color: colors.textFaint },
  itemOut: { fontSize: 11, color: colors.warn },
  itemLow: { fontSize: 11, color: colors.danger },
  swipeDelete: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 84,
    gap: 2,
  },
  swipeDeleteLabel: { color: '#fff', fontWeight: '700', fontSize: 12 },
  snackbar: {
    position: 'absolute',
    left: sp(4),
    right: sp(4),
    bottom: sp(5),
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingHorizontal: sp(4),
    paddingVertical: sp(3),
  },
  snackbarText: { ...type.body, flex: 1 },
  snackbarUndo: { color: colors.amber, fontWeight: '800' },
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
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    padding: sp(4),
  },
  sheetCard: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    padding: sp(4),
    gap: sp(1),
  },
  sheetPhoto: {
    width: '100%',
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSunken,
    marginBottom: sp(2),
  },
  sheetName: { ...type.body, fontSize: 17, fontWeight: '600' },
  sheetMeta: { color: colors.textFaint, fontSize: 13, marginBottom: sp(2) },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    paddingVertical: sp(2.75),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sheetRowLabel: { ...type.body, fontSize: 15 },
  sheetClose: { alignItems: 'center', paddingTop: sp(3) },
  sheetCloseLabel: { color: colors.steel, fontWeight: '700' },
});
