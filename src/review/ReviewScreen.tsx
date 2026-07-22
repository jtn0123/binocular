import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useDb } from '../db/DbProvider';
import {
  deleteItem,
  deleteItemsForBin,
  getBin,
  getScan,
  insertItem,
  itemsForBin,
  updateBinAfterScan,
  updateScanStatus,
  type ItemRow,
} from '../db/queries';
import { newId } from '../lib/id';
import { nowIso } from '../lib/time';
import { processScan } from '../scan/scanFlow';
import { ItemCategory, RecognitionResult, type Confidence } from '../vision/types';

/**
 * Recognition review (blueprint §6.3 + §8.1 step 6). Confidence maps to
 * default chip selection only — never a gate, never a percentage. Merge
 * audits of a non-empty bin group chips into new / still here / not seen;
 * removing an existing item always requires an explicit tap.
 */
interface DetectedChip {
  key: string;
  name: string;
  brand: string | null;
  category: ItemCategory;
  quantity: number;
  labelText: string | null;
  confidence: Confidence | null; // null for manually added chips
  selected: boolean;
  matchedExistingId: string | null;
}

export interface ReviewScreenProps {
  scanId: string;
  onDone: (binId: string | null) => void;
}

const norm = (s: string) => s.trim().toLowerCase();

function buildDetectedChips(result: RecognitionResult, existing: ItemRow[]): DetectedChip[] {
  const remaining = [...existing];
  return result.items.map((item, i) => {
    const matchIdx = remaining.findIndex((e) => norm(e.name) === norm(item.name));
    const matched = matchIdx >= 0 ? remaining.splice(matchIdx, 1)[0] : null;
    return {
      key: `detected-${i}`,
      name: item.name,
      brand: item.brand,
      category: item.category,
      quantity: item.quantity,
      labelText: item.label_text,
      confidence: item.confidence,
      // §6.3: high/medium pre-selected; low requires an explicit tap.
      // A chip matching an existing item defaults to keep regardless.
      selected: matched ? true : item.confidence !== 'low',
      matchedExistingId: matched?.id ?? null,
    };
  });
}

export function ReviewScreen({ scanId, onDone }: ReviewScreenProps) {
  const db = useDb();
  const scan = getScan(db, scanId);
  const bin = scan?.bin_id ? getBin(db, scan.bin_id) : null;

  const existingItems = useMemo(
    () => (scan?.bin_id ? itemsForBin(db, scan.bin_id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scanId],
  );

  const parsed = useMemo(() => {
    if (!scan?.raw_response) return null;
    try {
      const result = RecognitionResult.safeParse(JSON.parse(scan.raw_response));
      return result.success ? result.data : null;
    } catch {
      return null;
    }
     
  }, [scan?.raw_response]);

  const [chips, setChips] = useState<DetectedChip[]>(() =>
    parsed ? buildDetectedChips(parsed, existingItems) : [],
  );
  const [keepExisting, setKeepExisting] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(existingItems.map((e) => [e.id, true])),
  );
  const [mode, setMode] = useState<'merge' | 'replace'>(
    existingItems.length > 0 ? 'merge' : 'replace',
  );
  const [editingKey, setEditingKey] = useState<string | 'new' | null>(null);
  const [retrying, setRetrying] = useState(false);

  if (!scan) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>Scan not found.</Text>
      </View>
    );
  }

  if (scan.status === 'queued' || scan.status === 'processing' || retrying) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.dim}>
          {retrying ? 'Recognizing…' : 'Waiting for recognition — retry when you have signal.'}
        </Text>
        {!retrying && (
          <Pressable
            style={styles.primaryButton}
            onPress={async () => {
              setRetrying(true);
              const r = await processScan(db, scanId);
              setRetrying(false);
              if (r.outcome === 'review') {
                const fresh = getScan(db, scanId);
                if (fresh?.raw_response) {
                  try {
                    const result = RecognitionResult.parse(JSON.parse(fresh.raw_response));
                    setChips(buildDetectedChips(result, existingItems));
                  } catch {
                    // fall through to failed state on next render
                  }
                }
              }
            }}
          >
            <Text style={styles.primaryLabel}>Retry now</Text>
          </Pressable>
        )}
        <Pressable onPress={() => discard()}>
          <Text style={styles.link}>Discard scan</Text>
        </Pressable>
      </View>
    );
  }

  if (scan.status === 'failed' || (scan.status === 'review' && !parsed && chips.length === 0)) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Recognition failed</Text>
        <Text style={styles.dim}>{scan.error ?? 'The response could not be read.'}</Text>
        <Pressable
          style={styles.primaryButton}
          onPress={async () => {
            setRetrying(true);
            await processScan(db, scanId);
            setRetrying(false);
          }}
        >
          <Text style={styles.primaryLabel}>Retry</Text>
        </Pressable>
        <Pressable onPress={() => discard()}>
          <Text style={styles.link}>Discard scan</Text>
        </Pressable>
      </View>
    );
  }

  const isMergeDiff = mode === 'merge' && existingItems.length > 0;
  const newChips = chips.filter((c) => c.matchedExistingId === null);
  const stillHere = chips.filter((c) => c.matchedExistingId !== null);
  const matchedIds = new Set(stillHere.map((c) => c.matchedExistingId));
  const notSeen = existingItems.filter((e) => !matchedIds.has(e.id));

  function toggleChip(key: string) {
    setChips((cs) => cs.map((c) => (c.key === key ? { ...c, selected: !c.selected } : c)));
  }

  function discard() {
    updateScanStatus(db, scanId, 'discarded', { resolvedAt: nowIso() });
    onDone(scan?.bin_id ?? null);
  }

  function save() {
    if (!scan?.bin_id) return;
    const binId = scan.bin_id;
    db.withTransactionSync(() => {
      if (mode === 'replace') {
        deleteItemsForBin(db, binId);
        for (const chip of chips.filter((c) => c.selected)) {
          insertChip(binId, chip);
        }
      } else {
        for (const chip of newChips.filter((c) => c.selected)) {
          insertChip(binId, chip);
        }
        for (const chip of stillHere.filter((c) => !c.selected)) {
          if (chip.matchedExistingId) deleteItem(db, chip.matchedExistingId);
        }
        for (const item of notSeen) {
          if (!keepExisting[item.id]) deleteItem(db, item.id);
        }
      }
      updateScanStatus(db, scanId, 'confirmed', { resolvedAt: nowIso() });
      updateBinAfterScan(db, binId, {
        lastScannedAt: nowIso(),
        coverPhotoUri: scan.photo_uri,
      });
    });
    onDone(binId);
  }

  function insertChip(binId: string, chip: DetectedChip) {
    insertItem(db, {
      id: newId(),
      binId,
      name: chip.name,
      brand: chip.brand,
      category: chip.category,
      quantity: chip.quantity,
      labelText: chip.labelText,
      sourceScanId: scanId,
    });
  }

  const editingChip = chips.find((c) => c.key === editingKey) ?? null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {bin ? (
          <Text style={styles.binHeader}>
            {bin.short_code} · {bin.name}
          </Text>
        ) : null}
        {parsed?.scene_notes ? (
          <View style={styles.sceneNotes} testID="scene-notes">
            <Text style={styles.sceneNotesText}>{parsed.scene_notes}</Text>
          </View>
        ) : null}

        {existingItems.length > 0 && (
          <View style={styles.modeRow}>
            {(['merge', 'replace'] as const).map((m) => (
              <Pressable
                key={m}
                testID={`mode-${m}`}
                style={[styles.modeButton, mode === m && styles.modeButtonActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.modeLabel, mode === m && styles.modeLabelActive]}>
                  {m === 'merge' ? 'Merge with existing' : 'Replace contents'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {isMergeDiff ? (
          <>
            <ChipSection title="New" chips={newChips} onToggle={toggleChip} onEdit={setEditingKey} />
            <ChipSection
              title="Still here"
              chips={stillHere}
              onToggle={toggleChip}
              onEdit={null}
            />
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Not seen in this photo</Text>
              {notSeen.length === 0 ? (
                <Text style={styles.dim}>Everything previously recorded was seen.</Text>
              ) : (
                <View style={styles.chipWrap}>
                  {notSeen.map((item) => {
                    const keep = keepExisting[item.id] ?? true;
                    return (
                      <Pressable
                        key={item.id}
                        testID={`existing-${item.id}`}
                        accessibilityState={{ selected: keep }}
                        style={[styles.chip, !keep && styles.chipRemoved]}
                        onPress={() =>
                          setKeepExisting((m) => ({ ...m, [item.id]: !(m[item.id] ?? true) }))
                        }
                      >
                        <Text style={[styles.chipText, !keep && styles.chipTextRemoved]}>
                          {item.quantity > 1 ? `${item.quantity}× ` : ''}
                          {item.name}
                        </Text>
                        <Text style={styles.chipMeta}>{keep ? 'keep' : 'remove'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        ) : (
          <ChipSection
            title="Detected items"
            chips={chips}
            onToggle={toggleChip}
            onEdit={setEditingKey}
          />
        )}

        <Pressable style={styles.addButton} onPress={() => setEditingKey('new')} testID="add-item">
          <Text style={styles.addLabel}>+ Add item manually</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.discardButton} onPress={discard} testID="discard">
          <Text style={styles.discardLabel}>Discard</Text>
        </Pressable>
        <Pressable style={styles.saveButton} onPress={save} testID="save">
          <Text style={styles.saveLabel}>Save to bin</Text>
        </Pressable>
      </View>

      <ChipEditor
        visible={editingKey !== null}
        chip={editingChip}
        onCancel={() => setEditingKey(null)}
        onDelete={
          editingChip
            ? () => {
                setChips((cs) => cs.filter((c) => c.key !== editingChip.key));
                setEditingKey(null);
              }
            : null
        }
        onSave={(values) => {
          if (editingKey === 'new') {
            setChips((cs) => [
              ...cs,
              {
                key: `manual-${newId()}`,
                ...values,
                confidence: null,
                selected: true,
                matchedExistingId: null,
              },
            ]);
          } else if (editingKey) {
            setChips((cs) => cs.map((c) => (c.key === editingKey ? { ...c, ...values } : c)));
          }
          setEditingKey(null);
        }}
      />
    </View>
  );
}

function ChipSection({
  title,
  chips,
  onToggle,
  onEdit,
}: {
  title: string;
  chips: DetectedChip[];
  onToggle: (key: string) => void;
  onEdit: ((key: string) => void) | null;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {chips.length === 0 ? (
        <Text style={styles.dim}>Nothing here.</Text>
      ) : (
        <View style={styles.chipWrap}>
          {chips.map((chip) => (
            <Pressable
              key={chip.key}
              testID={`chip-${chip.key}`}
              accessibilityState={{ selected: chip.selected }}
              style={[styles.chip, !chip.selected && styles.chipUnselected]}
              onPress={() => onToggle(chip.key)}
              onLongPress={onEdit ? () => onEdit(chip.key) : undefined}
            >
              {chip.confidence === 'medium' && <View style={styles.amberDot} testID="amber-dot" />}
              <Text style={[styles.chipText, !chip.selected && styles.chipTextUnselected]}>
                {chip.quantity > 1 ? `${chip.quantity}× ` : ''}
                {chip.brand ? `${chip.brand} ` : ''}
                {chip.name}
              </Text>
              {chip.confidence === 'low' && !chip.selected && (
                <Text style={styles.chipMeta}>tap to include</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ChipEditor({
  visible,
  chip,
  onCancel,
  onDelete,
  onSave,
}: {
  visible: boolean;
  chip: DetectedChip | null;
  onCancel: () => void;
  onDelete: (() => void) | null;
  onSave: (values: {
    name: string;
    brand: string | null;
    category: ItemCategory;
    quantity: number;
    labelText: string | null;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [category, setCategory] = useState<ItemCategory>('other');
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const seedKey = chip?.key ?? 'new';
  if (visible && seededFor !== seedKey) {
    setName(chip?.name ?? '');
    setBrand(chip?.brand ?? '');
    setQuantity(String(chip?.quantity ?? 1));
    setCategory(chip?.category ?? 'other');
    setSeededFor(seedKey);
  }
  if (!visible && seededFor !== null) setSeededFor(null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{chip ? 'Edit item' : 'Add item'}</Text>
          <TextInput
            style={styles.input}
            placeholder="Name"
            value={name}
            onChangeText={setName}
            testID="editor-name"
          />
          <TextInput
            style={styles.input}
            placeholder="Brand (optional)"
            value={brand}
            onChangeText={setBrand}
          />
          <TextInput
            style={styles.input}
            placeholder="Quantity"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
            testID="editor-quantity"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow}>
            {ItemCategory.options.map((cat) => (
              <Pressable
                key={cat}
                style={[styles.catChip, category === cat && styles.catChipActive]}
                onPress={() => setCategory(cat)}
              >
                <Text style={[styles.catLabel, category === cat && styles.catLabelActive]}>
                  {cat.replace(/_/g, ' ')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.modalActions}>
            {onDelete && (
              <Pressable onPress={onDelete} testID="editor-delete">
                <Text style={styles.deleteLabel}>Delete</Text>
              </Pressable>
            )}
            <View style={styles.modalActionsRight}>
              <Pressable onPress={onCancel}>
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="editor-save"
                onPress={() => {
                  const qty = Math.max(1, parseInt(quantity, 10) || 1);
                  if (!name.trim()) return;
                  onSave({
                    name: name.trim(),
                    brand: brand.trim() || null,
                    category,
                    quantity: qty,
                    labelText: chip?.labelText ?? null,
                  });
                }}
              >
                <Text style={styles.saveInline}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  binHeader: { fontSize: 15, fontWeight: '600', color: '#666' },
  sceneNotes: { backgroundColor: '#fff7e0', borderRadius: 10, padding: 12 },
  sceneNotesText: { color: '#7a5d00' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeButton: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  modeButtonActive: { backgroundColor: '#208AEF', borderColor: '#208AEF' },
  modeLabel: { color: '#444', fontWeight: '500', fontSize: 13 },
  modeLabelActive: { color: '#fff' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', color: '#666' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e7f2fd',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#bcdcf7',
  },
  chipUnselected: { backgroundColor: '#f2f2f2', borderColor: '#ddd', borderStyle: 'dashed' },
  chipRemoved: { backgroundColor: '#fdecec', borderColor: '#f3c1c1' },
  chipText: { fontSize: 15, color: '#12395c' },
  chipTextUnselected: { color: '#999' },
  chipTextRemoved: { color: '#a33', textDecorationLine: 'line-through' },
  chipMeta: { fontSize: 11, color: '#999' },
  amberDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f5a623' },
  addButton: { alignItems: 'center', padding: 10 },
  addLabel: { color: '#208AEF', fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  discardButton: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d33',
    alignItems: 'center',
    flex: 1,
  },
  discardLabel: { color: '#d33', fontWeight: '600' },
  saveButton: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    flex: 2,
  },
  saveLabel: { color: '#fff', fontWeight: '700' },
  primaryButton: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  link: { color: '#208AEF' },
  saveInline: { color: '#208AEF', fontWeight: '700' },
  deleteLabel: { color: '#d33', fontWeight: '600' },
  dim: { color: '#888', textAlign: 'center' },
  errorTitle: { fontSize: 18, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 10 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 10, fontSize: 15 },
  catRow: { flexGrow: 0 },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: '#f0f0f0',
    marginRight: 6,
  },
  catChipActive: { backgroundColor: '#208AEF' },
  catLabel: { fontSize: 12, color: '#555' },
  catLabelActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  modalActionsRight: {
    flexDirection: 'row',
    gap: 18,
    marginLeft: 'auto',
    alignItems: 'center',
  },
});
