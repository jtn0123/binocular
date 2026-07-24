import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
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

import { CodeTag } from '../components/CodeTag';
import { PromptModal, type PromptRequest } from '../components/PromptModal';
import { useDb } from '../db/DbProvider';
import {
  deleteItem,
  deleteItemsForBin,
  getBin,
  getScan,
  insertItem,
  itemsForBin,
  listRecentBins,
  renameBin,
  updateBinAfterScan,
  updateScanStatus,
  type ItemRow,
} from '../db/queries';
import { quickCreateBin } from '../db/scaffold';
import { FALLBACK_TAG, listTags } from '../db/tags';
import { findDuplicate, suggestTag } from '../db/tagSuggest';
import { logEvent } from '../diagnostics/events';
import { hapticSuccess, hapticWarning } from '../lib/haptics';
import { newId } from '../lib/id';
import { nowIso } from '../lib/time';
import { persistPhoto } from '../scan/photos';
import { processScan } from '../scan/scanFlow';
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from './reviewDraft';
import { colors, mono, radius, sp, type } from '../theme';
import { formatTokens, formatUsd } from '../vision/cost';
import { RecognitionResult, type Confidence, type ItemCategory } from '../vision/types';

/**
 * Recognition review (blueprint §6.3 + §8.1 step 6). Confidence maps to
 * default chip selection only — never a gate, never a percentage. Merge
 * audits of a non-empty bin group chips into new / still here / not seen;
 * removing an existing item always requires an explicit tap.
 */
export interface DetectedChip {
  key: string;
  name: string;
  brand: string | null;
  category: ItemCategory;
  quantity: number;
  labelText: string | null;
  notes: string | null;
  /** Item-specific photo (user-taken); scans provide their own photo. */
  photoUri: string | null;
  confidence: Confidence | null; // null for manually added chips
  selected: boolean;
  matchedExistingId: string | null;
  /** User corrected the AI's values in the editor (D16 accuracy signal). */
  edited?: boolean;
}

export interface ReviewScreenProps {
  scanId: string;
  onDone: (binId: string | null) => void;
  /** Check-in: pre-selected destination (e.g. returned from a QR scan). */
  initialDestBinId?: string | null;
  /** Check-in: open the label scanner to pick the destination. */
  onScanDestination?: () => void;
}

const norm = (s: string) => s.trim().toLowerCase();

export function buildDetectedChips(
  result: RecognitionResult,
  existing: ItemRow[],
  known: ReadonlySet<string>,
  suggest: (name: string, brand: string | null) => string | null = () => null,
): DetectedChip[] {
  const remaining = [...existing];
  return result.items.map((item, i) => {
    const matchIdx = remaining.findIndex((e) => norm(e.name) === norm(item.name));
    const matched = matchIdx >= 0 ? remaining.splice(matchIdx, 1)[0] : null;
    const resolved = known.has(item.category) ? item.category : FALLBACK_TAG;
    return {
      key: `detected-${i}`,
      name: item.name,
      brand: item.brand,
      // §6.1 tag resolution (D19): the shape passed zod, but the vocabulary
      // is the user's and may have changed since the scan was queued. An
      // unknown tag becomes the fallback rather than failing the whole scan
      // — and it is visible on the chip, so it can be corrected before save.
      //
      // Where that leaves us on `other` — routinely, with the on-device
      // engine — this workshop's own history gets a say before we give up.
      category: resolved === FALLBACK_TAG ? (suggest(item.name, item.brand) ?? resolved) : resolved,
      quantity: item.quantity,
      labelText: item.label_text,
      notes: null,
      photoUri: null,
      confidence: item.confidence,
      // §6.3: high/medium pre-selected; low requires an explicit tap.
      // A chip matching an existing item defaults to keep regardless.
      selected: matched ? true : item.confidence !== 'low',
      matchedExistingId: matched?.id ?? null,
    };
  });
}

export function ReviewScreen({
  scanId,
  onDone,
  initialDestBinId,
  onScanDestination,
}: ReviewScreenProps) {
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

  // D19: the vocabulary as it stands now — used both to resolve what the
  // model returned and to render the Tag picker.
  const tags = listTags(db);
  const knownTags = useMemo(() => new Set(tags.map((t) => t.slug)), [tags]);
  const suggestFromHistory = (name: string, brand: string | null) =>
    suggestTag(db, name, brand)?.slug ?? null;

  // Restore any in-progress work from a previous visit (draft survives the
  // QR-label detour, the queue round-trip, and plain back navigation).
  const [draft] = useState(() => loadReviewDraft(scanId));
  const [chips, setChips] = useState<DetectedChip[]>(
    () =>
      draft?.chips ??
      (parsed ? buildDetectedChips(parsed, existingItems, knownTags, suggestFromHistory) : []),
  );
  const [keepExisting, setKeepExisting] = useState<Record<string, boolean>>(
    () => draft?.keepExisting ?? Object.fromEntries(existingItems.map((e) => [e.id, true])),
  );
  const [mode, setMode] = useState<'merge' | 'replace'>(
    () => draft?.mode ?? (existingItems.length > 0 ? 'merge' : 'replace'),
  );
  const [editingKey, setEditingKey] = useState<string | 'new' | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [renameTick, setRenameTick] = useState(0);
  void renameTick;
  const [destBinId, setDestBinId] = useState<string | null>(
    initialDestBinId ?? draft?.destBinId ?? null,
  );

  const scanStatus = scan?.status;
  useEffect(() => {
    if (scanStatus !== 'review') return;
    saveReviewDraft(scanId, { chips, keepExisting, mode, destBinId });
  }, [scanId, scanStatus, chips, keepExisting, mode, destBinId]);

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
                    setChips(
                      buildDetectedChips(result, existingItems, knownTags, suggestFromHistory),
                    );
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

  const isCheckIn = scan.mode === 'check_in';
  const destCandidates = isCheckIn ? listRecentBins(db, 8) : [];
  const isMergeDiff = !isCheckIn && mode === 'merge' && existingItems.length > 0;
  const newChips = chips.filter((c) => c.matchedExistingId === null);
  const stillHere = chips.filter((c) => c.matchedExistingId !== null);
  const matchedIds = new Set(stillHere.map((c) => c.matchedExistingId));
  const notSeen = existingItems.filter((e) => !matchedIds.has(e.id));

  function toggleChip(key: string) {
    setChips((cs) => cs.map((c) => (c.key === key ? { ...c, selected: !c.selected } : c)));
  }

  function discard() {
    hapticWarning();
    updateScanStatus(db, scanId, 'discarded', { resolvedAt: nowIso() });
    clearReviewDraft(scanId);
    onDone(scan?.bin_id ?? null);
  }

  function save() {
    const binId = isCheckIn ? destBinId : (scan?.bin_id ?? null);
    if (!binId) return;
    db.withTransactionSync(() => {
      if (isCheckIn) {
        // §8.2: check-in appends the selected chips to the destination bin.
        for (const chip of chips.filter((c) => c.selected)) {
          insertChip(binId, chip);
        }
      } else if (mode === 'replace') {
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
      if (!isCheckIn && scan) {
        // Only a bin audit re-stamps the bin photo/timestamp (§8.1 step 7).
        updateBinAfterScan(db, binId, {
          lastScannedAt: nowIso(),
          coverPhotoUri: scan.photo_uri,
        });
      }
    });
    // D16: the real-world accuracy signal — what the AI proposed versus what
    // the user actually confirmed. No labeling required.
    logEvent(db, {
      kind: 'scan',
      name: 'review_saved',
      scanId,
      detail: {
        mode: isCheckIn ? 'check_in' : mode,
        proposed: chips.length,
        accepted: chips.filter((c) => c.selected).length,
        edited: chips.filter((c) => c.edited).length,
        existingRemoved: notSeen.filter((i) => !keepExisting[i.id]).length,
      },
    });
    hapticSuccess();
    clearReviewDraft(scanId);
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
      notes: chip.notes,
      photoUri: chip.photoUri ? persistPhoto(chip.photoUri, `item-${newId()}`) : null,
      sourceScanId: scanId,
    });
  }

  const editingChip = chips.find((c) => c.key === editingKey) ?? null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {bin ? (
          <View style={styles.binHeaderRow}>
            <Text style={styles.binHeader}>
              {bin.short_code} · {bin.name}
            </Text>
            <Pressable
              testID="rename-bin"
              accessibilityRole="button"
              accessibilityLabel={`Rename ${bin.name}`}
              hitSlop={8}
              onPress={() =>
                setPrompt({
                  title: 'Rename bin',
                  initialValue: bin.name,
                  onSubmit: (name) => {
                    renameBin(db, bin.id, name);
                    setRenameTick((t) => t + 1);
                  },
                })
              }
            >
              <Text style={styles.renameLink}>rename</Text>
            </Pressable>
          </View>
        ) : null}
        {scan.engine === 'fixture' && (
          <View style={styles.demoNotice} testID="demo-engine-notice">
            <Text style={styles.demoNoticeText}>
              Demo engine — these are canned results, not a reading of your photo. Pick Local or add
              a cloud API key in Settings for real recognition.
            </Text>
          </View>
        )}
        {parsed?.scene_notes ? (
          <View style={styles.sceneNotes} testID="scene-notes">
            <Text style={styles.sceneNotesText}>{parsed.scene_notes}</Text>
          </View>
        ) : null}
        {scan.input_tokens != null && (
          <Text style={styles.usageLine} testID="scan-usage">
            This scan: {formatTokens(scan.input_tokens)} tokens in ·{' '}
            {formatTokens(scan.output_tokens ?? 0)} out
            {scan.cost_usd != null ? ` · ${formatUsd(scan.cost_usd)} measured` : ''}
          </Text>
        )}

        {!isCheckIn && existingItems.length > 0 && (
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
            <ChipSection
              title="New"
              chips={newChips}
              onToggle={toggleChip}
              onEdit={setEditingKey}
            />
            <ChipSection title="Still here" chips={stillHere} onToggle={toggleChip} onEdit={null} />
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

        {isCheckIn && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Save to which bin?</Text>
            {destCandidates.length === 0 && (
              <Text style={styles.dim}>No bins yet — create your first one:</Text>
            )}
            {destCandidates.map((candidate) => (
              <Pressable
                key={candidate.id}
                testID={`dest-${candidate.id}`}
                accessibilityState={{ selected: destBinId === candidate.id }}
                style={[styles.destRow, destBinId === candidate.id && styles.destRowActive]}
                onPress={() => setDestBinId(candidate.id)}
              >
                <CodeTag code={candidate.short_code} small />
                <Text style={styles.destName} numberOfLines={1}>
                  {candidate.name}
                </Text>
                {destBinId === candidate.id && (
                  <Pressable
                    testID={`rename-dest-${candidate.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${candidate.name}`}
                    hitSlop={8}
                    onPress={() =>
                      setPrompt({
                        title: 'Rename bin',
                        initialValue: candidate.name,
                        onSubmit: (name) => {
                          renameBin(db, candidate.id, name);
                          setRenameTick((t) => t + 1);
                        },
                      })
                    }
                  >
                    <Text style={styles.renameLink}>rename</Text>
                  </Pressable>
                )}
              </Pressable>
            ))}
            <Pressable
              style={styles.addButton}
              testID="new-bin"
              accessibilityRole="button"
              accessibilityLabel="Create a new bin"
              onPress={() => {
                const created = quickCreateBin(db);
                setDestBinId(created.id);
              }}
            >
              <Text style={styles.addLabel}>+ New bin</Text>
            </Pressable>
            {onScanDestination && (
              <Pressable style={styles.addButton} onPress={onScanDestination}>
                <Text style={styles.addLabel}>Scan a bin label instead</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.discardButton} onPress={discard} testID="discard">
          <Text style={styles.discardLabel}>Discard</Text>
        </Pressable>
        <Pressable
          style={[styles.saveButton, isCheckIn && !destBinId && styles.saveButtonDisabled]}
          onPress={save}
          testID="save"
        >
          <Text style={styles.saveLabel}>
            {isCheckIn && !destBinId ? 'Pick a bin below' : 'Save to bin'}
          </Text>
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
            setChips((cs) =>
              cs.map((c) => (c.key === editingKey ? { ...c, ...values, edited: true } : c)),
            );
          }
          setEditingKey(null);
        }}
      />
      <PromptModal request={prompt} onClose={() => setPrompt(null)} />
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

export function ChipEditor({
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
    notes: string | null;
    photoUri: string | null;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [category, setCategory] = useState<ItemCategory>(FALLBACK_TAG);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  // Once the user picks a tag, autofill stops second-guessing them.
  const [tagTouched, setTagTouched] = useState(false);
  const [tagSuggested, setTagSuggested] = useState(false);
  // D19: read straight from the vocabulary rather than taking a prop, so all
  // three places that open this editor stay unchanged.
  const db = useDb();
  const editorTags = listTags(db);
  const duplicate = findDuplicate(db, name, chip?.matchedExistingId ?? null);

  const seedKey = chip?.key ?? 'new';
  if (visible && seededFor !== seedKey) {
    setName(chip?.name ?? '');
    setBrand(chip?.brand ?? '');
    setQuantity(String(chip?.quantity ?? 1));
    setNotes(chip?.notes ?? '');
    setPhotoUri(chip?.photoUri ?? null);
    setCategory(chip?.category ?? FALLBACK_TAG);
    // An existing chip already carries a decided tag; a fresh one does not.
    setTagTouched(chip != null);
    setTagSuggested(false);
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
            onChangeText={(next) => {
              setName(next);
              // Autofill the tag from this workshop's own history, until the
              // user picks one — then their choice always wins.
              if (!tagTouched) {
                const suggested = suggestTag(db, next, brand || null);
                setCategory(suggested?.slug ?? FALLBACK_TAG);
                setTagSuggested(suggested !== null);
              }
            }}
            testID="editor-name"
          />
          {duplicate ? (
            <Text style={styles.duplicateHint} testID="duplicate-hint">
              You already have {duplicate.quantity > 1 ? `${duplicate.quantity}× ` : ''}
              {duplicate.name}
              {duplicate.binCode ? ` in ${duplicate.binCode}` : ''}
              {duplicate.binName ? ` · ${duplicate.binName}` : ''}
            </Text>
          ) : null}
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
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Notes (optional) — e.g. half used, borrowed from Dave"
            value={notes}
            onChangeText={setNotes}
            multiline
            testID="editor-notes"
          />
          <View style={styles.photoRow}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoThumb} contentFit="cover" />
            ) : null}
            <Pressable
              testID="editor-photo"
              accessibilityRole="button"
              onPress={async () => {
                const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
                if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
              }}
            >
              <Text style={styles.photoLink}>{photoUri ? 'Retake photo' : 'Add photo'}</Text>
            </Pressable>
            {photoUri ? (
              <Pressable onPress={() => setPhotoUri(null)}>
                <Text style={styles.photoLink}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.tagHeading}>
            Tag{tagSuggested && !tagTouched ? ' · from your past items' : ''}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow}>
            {editorTags.map((tag) => (
              <Pressable
                key={tag.slug}
                style={[styles.catChip, category === tag.slug && styles.catChipActive]}
                onPress={() => {
                  setCategory(tag.slug);
                  setTagTouched(true);
                  setTagSuggested(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: category === tag.slug }}
              >
                <Text style={[styles.catLabel, category === tag.slug && styles.catLabelActive]}>
                  {tag.label}
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
                    notes: notes.trim() || null,
                    photoUri,
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
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: sp(4), gap: sp(4), paddingBottom: sp(8) },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(3.5),
    padding: sp(6),
    backgroundColor: colors.bg,
  },
  binHeader: { ...type.dim, fontWeight: '600' },
  binHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2.5) },
  renameLink: { color: colors.steel, fontSize: 12, fontWeight: '600' },
  demoNotice: {
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: sp(3),
  },
  demoNoticeText: { color: colors.textDim, fontSize: 13 },
  sceneNotes: {
    backgroundColor: '#2E2A1C',
    borderWidth: 1,
    borderColor: '#4A4227',
    borderRadius: radius.md,
    padding: sp(3),
  },
  sceneNotesText: { color: '#E8CE7A', fontSize: 13 },
  usageLine: { color: colors.textFaint, fontSize: 12 },
  modeRow: { flexDirection: 'row', gap: sp(2) },
  modeButton: {
    flex: 1,
    padding: sp(2.5),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
  },
  modeButtonActive: { backgroundColor: colors.amber, borderColor: colors.amber },
  modeLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  modeLabelActive: { color: colors.amberInkOn },
  section: { gap: sp(2) },
  sectionTitle: { ...type.stamp },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.chipSelectedBg,
    borderRadius: radius.pill,
    paddingHorizontal: sp(3.5),
    paddingVertical: sp(2.25),
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
  },
  chipUnselected: {
    backgroundColor: colors.chipBg,
    borderColor: colors.chipBorder,
    borderStyle: 'dashed',
  },
  chipRemoved: { backgroundColor: colors.dangerDim, borderColor: '#6B3831' },
  chipText: { fontSize: 15, color: colors.text },
  chipTextUnselected: { color: colors.textFaint },
  chipTextRemoved: { color: colors.danger, textDecorationLine: 'line-through' },
  chipMeta: { fontSize: 11, color: colors.textFaint },
  amberDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warn },
  addButton: { alignItems: 'center', padding: sp(2.5) },
  addLabel: { color: colors.steel, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    gap: sp(2.5),
    padding: sp(4),
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSunken,
  },
  discardButton: {
    padding: sp(3.5),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    flex: 1,
  },
  discardLabel: { color: colors.danger, fontWeight: '700' },
  saveButton: {
    padding: sp(3.5),
    borderRadius: radius.lg,
    backgroundColor: colors.amber,
    alignItems: 'center',
    flex: 2,
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveLabel: { color: colors.amberInkOn, fontWeight: '800', fontSize: 15 },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    padding: sp(2.75),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  destRowActive: { borderColor: colors.amber, backgroundColor: colors.chipSelectedBg },
  destName: { ...type.body, flex: 1 },
  primaryButton: {
    backgroundColor: colors.amber,
    paddingHorizontal: sp(5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  primaryLabel: { color: colors.amberInkOn, fontWeight: '700' },
  link: { color: colors.steel },
  saveInline: { color: colors.amber, fontWeight: '800' },
  deleteLabel: { color: colors.danger, fontWeight: '600' },
  dim: { ...type.dim, textAlign: 'center' },
  errorTitle: { ...type.h2 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: sp(6),
  },
  modalCard: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    padding: sp(4.5),
    gap: sp(2.5),
  },
  modalTitle: { ...type.h2 },
  inputMultiline: { minHeight: 56, textAlignVertical: 'top' },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSunken,
    color: colors.text,
    borderRadius: radius.md,
    padding: sp(2.5),
    fontSize: 15,
  },
  tagHeading: { ...type.stamp, marginTop: sp(1) },
  duplicateHint: { ...type.dim, fontSize: 12, color: colors.amber, marginTop: -sp(1) },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: sp(4) },
  photoThumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
  },
  photoLink: { color: colors.steel, fontWeight: '600' },
  catRow: { flexGrow: 0 },
  catChip: {
    paddingHorizontal: sp(3),
    paddingVertical: sp(1.75),
    borderRadius: radius.pill,
    backgroundColor: colors.chipBg,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    marginRight: 6,
  },
  catChipActive: { backgroundColor: colors.amber, borderColor: colors.amber },
  catLabel: { fontSize: 12, color: colors.textDim, fontFamily: mono },
  catLabelActive: { color: colors.amberInkOn },
  modalActions: { flexDirection: 'row', alignItems: 'center', marginTop: sp(1.5) },
  modalActionsRight: {
    flexDirection: 'row',
    gap: sp(4.5),
    marginLeft: 'auto',
    alignItems: 'center',
  },
});
