import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { CodeTag } from '@/components/CodeTag';
import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { useDb } from '@/db/DbProvider';
import {
  checkOutItem,
  deleteBinIfEmpty,
  getBin,
  getScan,
  getShelf,
  insertItem,
  itemsForBin,
  listAuditHistory,
  listBins,
  listItemPhotoUris,
  moveItemToBin,
  renameBin,
  restoreDeletedItem,
  returnItem,
  setItemQuantity,
  setLowStockThreshold,
  softDeleteItem,
  updateItem,
  type BinRow,
  type ItemRow,
} from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';
import { newId } from '@/lib/id';
import { persistPhoto } from '@/scan/photos';
import { printLabelSheet } from '@/qr/print';
import { ChipEditor } from '@/review/ReviewScreen';
import { colors, mono, radius, sp, type } from '@/theme';

function ActionChip({
  icon,
  label,
  onPress,
  danger,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      style={[styles.action, danger && styles.actionDanger, active && styles.actionActive]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={15}
        color={danger ? colors.danger : active ? colors.amberInkOn : colors.steel}
      />
      <Text
        style={[
          styles.actionLabel,
          danger && styles.actionLabelDanger,
          active && styles.actionLabelActive,
        ]}
      >
        {label}
      </Text>
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
  // Move picker serves single-item and bulk moves.
  const [moving, setMoving] = useState<ItemRow[] | null>(null);
  // Multi-select mode (field-test ask: batch cleanup).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // Deletes go through the D17 trash: instantly undoable here, restorable
  // for 30 days from Recently deleted.
  const [undoItems, setUndoItems] = useState<ItemRow[]>([]);
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
  const selectedItems = items.filter((i) => selected[i.id]);

  function removeItems(list: ItemRow[]) {
    for (const item of list) softDeleteItem(db, item.id);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoItems(list);
    undoTimer.current = setTimeout(() => setUndoItems([]), 6000);
    setSheetItem(null);
    setSelectMode(false);
    setSelected({});
    refresh();
  }

  function undoRemove() {
    for (const item of undoItems) restoreDeletedItem(db, item.id);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoItems([]);
    refresh();
  }

  function moveItems(list: ItemRow[], targetBinId: string) {
    for (const item of list) moveItemToBin(db, item.id, targetBinId);
    setMoving(null);
    setSelectMode(false);
    setSelected({});
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
      const where = [shelf?.name].filter(Boolean).join(' · ');
      await printLabelSheet([
        {
          payload: { type: 'bin', id: bin.id },
          code: bin.short_code,
          name: bin.name,
          where: where || undefined,
        },
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
              <Pressable
                onLongPress={() =>
                  router.push({ pathname: '/bin-photo/[id]', params: { id: bin.id } })
                }
                delayLongPress={300}
                accessibilityRole="imagebutton"
                accessibilityLabel="Bin cover photo — press and hold to retake"
              >
                <Image
                  source={{ uri: bin.cover_photo_uri }}
                  style={styles.cover}
                  contentFit="cover"
                />
              </Pressable>
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
                icon="image"
                label="Photo"
                onPress={() => router.push({ pathname: '/bin-photo/[id]', params: { id: bin.id } })}
              />
              <ActionChip
                icon="checkmark-circle-outline"
                label={selectMode ? 'Done' : 'Select'}
                active={selectMode}
                onPress={() => {
                  setSelectMode((m) => !m);
                  setSelected({});
                }}
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
        renderItem={({ item }) =>
          selectMode ? (
            <Pressable
              style={styles.itemRow}
              onPress={() => setSelected((sel) => ({ ...sel, [item.id]: !sel[item.id] }))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!selected[item.id] }}
            >
              <Ionicons
                name={selected[item.id] ? 'checkbox' : 'square-outline'}
                size={20}
                color={selected[item.id] ? colors.amber : colors.textFaint}
              />
              <View style={styles.itemMain}>
                <Text style={styles.itemName}>
                  {item.quantity > 1 ? `${item.quantity}× ` : ''}
                  {item.brand ? `${item.brand} ` : ''}
                  {item.name}
                </Text>
              </View>
              <Text style={styles.itemCategory}>{item.category.replace(/_/g, ' ')}</Text>
            </Pressable>
          ) : (
            <ReanimatedSwipeable
              friction={2}
              rightThreshold={36}
              overshootRight={false}
              renderRightActions={() => (
                <Pressable
                  style={styles.swipeDelete}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.name}`}
                  onPress={() => removeItems([item])}
                >
                  <Ionicons name="trash" size={18} color="#fff" />
                  <Text style={styles.swipeDeleteLabel}>Delete</Text>
                </Pressable>
              )}
            >
              <View style={styles.itemRow}>
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
                  {item.notes ? (
                    <Text style={styles.itemNotes} numberOfLines={1}>
                      {item.notes}
                    </Text>
                  ) : null}
                  {item.checked_out_to ? (
                    <Text style={styles.itemOut}>checked out to {item.checked_out_to}</Text>
                  ) : null}
                  {item.low_stock_threshold !== null &&
                  item.quantity <= item.low_stock_threshold ? (
                    <Text style={styles.itemLow}>running low</Text>
                  ) : null}
                </Pressable>
                <Text style={styles.itemCategory}>{item.category.replace(/_/g, ' ')}</Text>
              </View>
            </ReanimatedSwipeable>
          )
        }
      />
      {selectMode && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkCount}>{selectedItems.length} selected</Text>
          <Pressable
            onPress={() => selectedItems.length > 0 && setMoving(selectedItems)}
            disabled={selectedItems.length === 0}
          >
            <Text style={[styles.bulkAction, selectedItems.length === 0 && styles.bulkDisabled]}>
              Move
            </Text>
          </Pressable>
          <Pressable
            onPress={() => selectedItems.length > 0 && removeItems(selectedItems)}
            disabled={selectedItems.length === 0}
          >
            <Text
              style={[
                styles.bulkAction,
                { color: colors.danger },
                selectedItems.length === 0 && styles.bulkDisabled,
              ]}
            >
              Delete
            </Text>
          </Pressable>
        </View>
      )}
      {undoItems.length > 0 && (
        <View style={styles.snackbar} testID="undo-snackbar">
          <Text style={styles.snackbarText} numberOfLines={1}>
            Deleted {undoItems.length === 1 ? undoItems[0].name : `${undoItems.length} items`}
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
            notes: values.notes,
            photoUri: values.photoUri ? persistPhoto(values.photoUri, `item-${newId()}`) : null,
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
        onMove={(item) => {
          setSheetItem(null);
          setMoving([item]);
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
        onDelete={(item) => removeItems([item])}
        onPhotoTaken={(item, uri) => {
          updateItem(db, item.id, {
            name: item.name,
            brand: item.brand,
            category: item.category,
            quantity: item.quantity,
            labelText: item.label_text,
            notes: item.notes,
            photoUri: persistPhoto(uri, `item-${item.id}`),
          });
          setSheetItem(null);
          refresh();
        }}
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
                notes: editing.notes,
                photoUri: editing.photo_uri,
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
            const photoUri =
              values.photoUri && values.photoUri !== editing.photo_uri
                ? persistPhoto(values.photoUri, `item-${editing.id}`)
                : values.photoUri;
            updateItem(db, editing.id, {
              name: values.name,
              brand: values.brand,
              category: values.category,
              quantity: values.quantity,
              labelText: values.labelText,
              notes: values.notes,
              photoUri,
            });
          }
          setEditing(null);
          refresh();
        }}
      />
      <BinPicker
        visible={moving !== null}
        excludeBinId={bin.id}
        title={
          moving && moving.length > 1 ? `Move ${moving.length} items to…` : 'Move item to…'
        }
        bins={listBins(db)}
        onClose={() => setMoving(null)}
        onPick={(target) => moving && moveItems(moving, target.id)}
      />
    </View>
  );
}

/**
 * Themed replacement for the old system Alert menu (field-test: "archaic,
 * off-theme, no way back"). Tap an item → its photo (from the scan that
 * cataloged it) plus every action; backdrop tap dismisses.
 */
function ItemSheet({
  db,
  item,
  onClose,
  onEdit,
  onQuantity,
  onMove,
  onLowStock,
  onCheckoutOrReturn,
  onDelete,
  onPhotoTaken,
}: {
  db: ReturnType<typeof useDb>;
  item: ItemRow | null;
  onClose: () => void;
  onEdit: (item: ItemRow) => void;
  onQuantity: (item: ItemRow) => void;
  onMove: (item: ItemRow) => void;
  onLowStock: (item: ItemRow) => void;
  onCheckoutOrReturn: (item: ItemRow) => void;
  onDelete: (item: ItemRow) => void;
  onPhotoTaken: (item: ItemRow, uri: string) => void;
}) {
  const sourceScan = item?.source_scan_id ? getScan(db, item.source_scan_id) : null;
  const [photoMenu, setPhotoMenu] = useState(false);
  const displayUri = item?.photo_uri ?? sourceScan?.photo_uri ?? null;
  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={() => {}}>
          {item && (
            <>
              {displayUri ? (
                <Pressable
                  onLongPress={() => setPhotoMenu((m) => !m)}
                  delayLongPress={300}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Item photo — press and hold for options"
                >
                  <Image
                    source={{ uri: displayUri }}
                    style={styles.sheetPhoto}
                    contentFit="contain"
                  />
                </Pressable>
              ) : null}
              {photoMenu && item ? (
                <>
                  <SheetRow
                    icon="camera-outline"
                    label={item.photo_uri ? 'Retake item photo' : 'Take item photo'}
                    onPress={async () => {
                      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
                      if (!result.canceled && result.assets[0]) {
                        onPhotoTaken(item, result.assets[0].uri);
                        setPhotoMenu(false);
                      }
                    }}
                  />
                  <SheetRow
                    icon="information-circle-outline"
                    label={
                      item.photo_uri
                        ? 'Photo: taken for this item'
                        : sourceScan
                          ? `Photo: from the scan on ${sourceScan.created_at.slice(0, 10)}`
                          : 'No photo yet'
                    }
                    onPress={() => setPhotoMenu(false)}
                  />
                </>
              ) : null}
              <Text style={styles.sheetName}>
                {item.quantity > 1 ? `${item.quantity}× ` : ''}
                {item.brand ? `${item.brand} ` : ''}
                {item.name}
              </Text>
              <Text style={styles.sheetMeta}>
                {item.category.replace(/_/g, ' ')}
                {item.label_text ? ` · ${item.label_text}` : ''}
                {sourceScan
                  ? ` · scanned ${sourceScan.created_at.slice(0, 10)}`
                  : ' · added manually'}
              </Text>
              {item.notes ? <Text style={styles.sheetNotes}>{item.notes}</Text> : null}
              {!displayUri ? (
                <SheetRow
                  icon="camera-outline"
                  label="Take item photo"
                  onPress={async () => {
                    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
                    if (!result.canceled && result.assets[0]) {
                      onPhotoTaken(item, result.assets[0].uri);
                    }
                  }}
                />
              ) : null}
              <SheetRow icon="pencil" label="Edit name, tag, notes" onPress={() => onEdit(item)} />
              <SheetRow
                icon="swap-vertical"
                label={`Adjust quantity (${item.quantity})`}
                onPress={() => onQuantity(item)}
              />
              <SheetRow icon="arrow-redo" label="Move to another bin…" onPress={() => onMove(item)} />
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

function BinPicker({
  visible,
  bins,
  excludeBinId,
  title,
  onClose,
  onPick,
}: {
  visible: boolean;
  bins: BinRow[];
  excludeBinId: string;
  title: string;
  onClose: () => void;
  onPick: (bin: BinRow) => void;
}) {
  const candidates = bins.filter((b) => b.id !== excludeBinId);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={() => {}}>
          <Text style={styles.sheetName}>{title}</Text>
          {candidates.length === 0 ? (
            <Text style={styles.sheetMeta}>No other bins yet — create one in Browse first.</Text>
          ) : (
            candidates.map((candidate) => (
              <Pressable
                key={candidate.id}
                style={styles.sheetRow}
                onPress={() => onPick(candidate)}
                accessibilityRole="button"
                testID={`move-to-${candidate.short_code}`}
              >
                <CodeTag code={candidate.short_code} small />
                <Text style={styles.sheetRowLabel} numberOfLines={1}>
                  {candidate.name}
                </Text>
              </Pressable>
            ))
          )}
          <Pressable onPress={onClose} style={styles.sheetClose}>
            <Text style={styles.sheetCloseLabel}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
  actionActive: { backgroundColor: colors.amber, borderColor: colors.amber },
  actionLabel: { color: colors.steel, fontWeight: '600', fontSize: 13 },
  actionLabelDanger: { color: colors.danger },
  actionLabelActive: { color: colors.amberInkOn },
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
  itemNotes: { fontSize: 12, color: colors.textDim, fontStyle: 'italic' },
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
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(5),
    paddingVertical: sp(3),
    paddingHorizontal: sp(2),
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bulkCount: { ...type.body, flex: 1, fontWeight: '600' },
  bulkAction: { color: colors.amber, fontWeight: '800' },
  bulkDisabled: { opacity: 0.35 },
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
  sheetNotes: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', marginBottom: sp(2) },
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
