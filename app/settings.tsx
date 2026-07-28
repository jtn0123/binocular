import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import * as DocumentPicker from 'expo-document-picker';
import { Link } from 'expo-router';

import { exportBackupZip, exportInventoryCsv, importBackupZip } from '@/backup/backup';
import { MapSettings } from '@/components/map/MapSettings';
import {
  formatBytes,
  readStorageReport,
  reclaimOrphanPhotos,
  type StorageReport,
} from '@/backup/storage';
import { logEvent } from '@/diagnostics/events';
import { useDb } from '@/db/DbProvider';
import { isDatabaseEmpty } from '@/db/backupQueries';
import { countEmbeddings, countItemsWithPhotos } from '@/db/embeddingQueries';
import { listSpendTotals, type SpendTotals } from '@/db/queries';
import { UpdateSection } from '@/components/settings/UpdateSection';
import { buildInfo } from '@/settings/build';
import { DEFAULT_MAP_PREFS, loadMapPrefs, saveMapPrefs, type MapPrefs } from '@/settings/mapPrefs';
import {
  getApiKey,
  getGithubToken,
  getOpenAiApiKey,
  getProviderChoice,
  setApiKey,
  setOpenAiApiKey,
  setProviderChoice,
  type ProviderChoice,
} from '@/settings/settings';
import { colors, radius, sp, type } from '@/theme';
import { testClaudeConnection } from '@/vision/claudeProvider';
import { estimateScanCost, formatTokens, formatUsd, PRICES_AS_OF } from '@/vision/cost';
import { testOpenAiConnection } from '@/vision/openaiProvider';
import {
  encoderDownloadBytes,
  ENCODER_MODEL,
  isEncoderSupported,
  loadEncoder,
  removeEncoder,
} from '@/vision/executorchEmbedder';
import { getEmbedder } from '@/vision/visualMemory';

const ENGINE_LABELS: Record<ProviderChoice, string> = {
  fixture: 'Fixture',
  local: 'Local',
  claude: 'Claude',
  openai: 'OpenAI',
};

function KeySection({
  title,
  placeholder,
  hasStoredKey,
  idPrefix,
  onSave,
  onTest,
}: {
  title: string;
  placeholder: string;
  hasStoredKey: boolean;
  /**
   * Scopes this section's testIDs. Both providers render a KeySection, so
   * fixed ids would appear twice in one tree — `getByTestId` throws on that,
   * and anything selecting by id would be picking a provider at random.
   */
  idPrefix: string;
  onSave: (key: string) => Promise<void>;
  onTest: (enteredKey: string) => Promise<void>;
}) {
  const [keyInput, setKeyInput] = useState('');
  const [testing, setTesting] = useState(false);

  /**
   * Persist, then clear the box — in that order, and only on success.
   *
   * Trimmed because `onTest` already trims: without this you could test a
   * pasted key, be told it works, and save a *different* string with the
   * newline still on the end. A secure-store write can also reject, and an
   * unhandled rejection would leave the box cleared as though it had worked.
   */
  const save = async (raw: string) => {
    try {
      await onSave(raw.trim());
      setKeyInput('');
    } catch (err) {
      Alert.alert('Could not save the key', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <View style={styles.keySection}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.hint}>
        {hasStoredKey ? 'A key is stored in the secure store.' : 'No key stored yet.'}
      </Text>
      <TextInput
        style={styles.input}
        placeholder={hasStoredKey ? 'Enter a new key to replace it' : placeholder}
        value={keyInput}
        onChangeText={setKeyInput}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <View style={styles.buttonRow}>
        {/*
          This button used to relabel itself "Clear key" whenever the input
          was empty — which is its state on every single open. The largest,
          amber, primary control on the screen therefore defaulted to deleting
          a write-only secret, with no confirmation, and then reported "Saved".
          Saving and clearing are now separate: this one only ever saves, and
          is inert with nothing to save.
        */}
        <Pressable
          style={[styles.primaryButton, !keyInput.trim() && styles.disabled]}
          disabled={!keyInput.trim()}
          accessibilityRole="button"
          accessibilityState={{ disabled: !keyInput.trim() }}
          accessibilityLabel={`Save the ${title}`}
          testID={`${idPrefix}-key-save`}
          onPress={() => void save(keyInput)}
        >
          <Text style={styles.primaryLabel}>Save key</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, testing && styles.disabled]}
          disabled={testing}
          accessibilityRole="button"
          accessibilityLabel={`Test the ${title}`}
          testID={`${idPrefix}-key-test`}
          onPress={async () => {
            setTesting(true);
            try {
              await onTest(keyInput.trim());
              // "It works" and "it is saved" are different facts, and this
              // used to report the first as though it were both.
              if (keyInput.trim()) {
                Alert.alert('The key works', 'It has not been saved yet.', [
                  { text: 'Not now', style: 'cancel' },
                  {
                    text: 'Save key',
                    onPress: () => void save(keyInput),
                  },
                ]);
              } else {
                Alert.alert('Success', 'The stored key works.');
              }
            } catch (err) {
              Alert.alert('Connection failed', err instanceof Error ? err.message : String(err));
            } finally {
              setTesting(false);
            }
          }}
        >
          <Text style={styles.secondaryLabel}>{testing ? 'Testing…' : 'Test connection'}</Text>
        </Pressable>
      </View>
      {hasStoredKey ? (
        <Pressable
          style={styles.dangerButton}
          accessibilityRole="button"
          accessibilityLabel={`Clear the stored ${title}`}
          testID={`${idPrefix}-key-clear`}
          onPress={() =>
            Alert.alert(
              'Clear the stored key?',
              'Cloud recognition stops working until you enter a new one. A stored key cannot be read back, so you would have to paste it in again.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear key',
                  style: 'destructive',
                  onPress: () => void save(''),
                },
              ],
            )
          }
        >
          <Text style={styles.dangerLabel}>Clear key</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function SettingsScreen() {
  const db = useDb();
  const [provider, setProvider] = useState<ProviderChoice>('fixture');
  const [busyData, setBusyData] = useState(false);

  async function runDataAction(action: () => Promise<void>) {
    setBusyData(true);
    try {
      await action();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyData(false);
    }
  }

  async function pickAndImport() {
    if (!isDatabaseEmpty(db)) {
      Alert.alert(
        'Import needs an empty database',
        'Imports never merge. Clear the app data first (or reinstall) and import into a fresh start.',
      );
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/octet-stream'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    await runDataAction(async () => {
      const summary = await importBackupZip(db, picked.assets[0].uri);
      Alert.alert(
        'Import complete',
        `Restored ${summary.bins} bins, ${summary.items} items, ${summary.photos} photos.`,
      );
    });
  }
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [hasGithubToken, setHasGithubToken] = useState(false);
  // Touches the filesystem, so unlike the SQLite-derived numbers below it is
  // read once on mount rather than on every render — and re-read after a
  // cleanup, which is the only thing that changes it from here.
  const [storage, setStorage] = useState<StorageReport>(() => readStorageReport(db));
  const build = buildInfo();
  // D20: the encoder is downloaded on demand, so "not set up" is the normal
  // resting state and has to read as a capability rather than a fault.
  // `tick` exists to re-derive the counts below after a download or removal,
  // which are the only things here that change them.
  const [encoder, setEncoder] = useState({
    supported: isEncoderSupported(),
    bytes: null as number | null,
    busy: false,
    progress: 0,
    tick: 0,
  });
  const embedder = getEmbedder();
  const visualMemory = {
    available: embedder !== null,
    remembered: embedder ? countEmbeddings(db, embedder.model) : 0,
    withPhotos: countItemsWithPhotos(db),
  };

  async function downloadEncoder() {
    setEncoder((e) => ({ ...e, busy: true, progress: 0 }));
    const startedAt = Date.now();
    try {
      await loadEncoder((progress) => setEncoder((e) => ({ ...e, progress })));
      logEvent(db, {
        kind: 'memory',
        name: 'encoder_downloaded',
        durationMs: Date.now() - startedAt,
        detail: { model: ENCODER_MODEL },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent(db, { kind: 'memory', name: 'encoder_download_failed', detail: { message } });
      Alert.alert(
        'Download failed',
        `${message}\n\nNothing else has changed — try again when you have a steadier connection.`,
      );
    } finally {
      setEncoder((e) => ({ ...e, busy: false, tick: e.tick + 1 }));
    }
  }

  const [mapPrefs, setMapPrefs] = useState<MapPrefs>(DEFAULT_MAP_PREFS);
  const setMapPref = <K extends keyof MapPrefs>(key: K, value: MapPrefs[K]) => {
    // Derived from the committed state rather than this render's copy: two
    // switches flipped before a re-render would otherwise have the second
    // write drop the first, in memory and in what gets persisted.
    setMapPrefs((prev) => {
      const next = { ...prev, [key]: value };
      void saveMapPrefs(next);
      return next;
    });
    logEvent(db, { kind: 'settings', name: 'map_pref_changed', detail: { [key]: value } });
  };

  useEffect(() => {
    void (async () => {
      setProvider(await getProviderChoice());
      setHasAnthropicKey((await getApiKey()) !== null);
      setHasOpenAiKey((await getOpenAiApiKey()) !== null);
      setHasGithubToken((await getGithubToken()) !== null);
      setMapPrefs(await loadMapPrefs());
    })();
  }, []);

  // Asks the network how big the download is, so the offer can state its cost
  // before the user commits to it. Best-effort: the offer stands without it.
  const encoderSupported = encoder.supported;
  const encoderKnown = encoder.bytes !== null;
  useEffect(() => {
    if (!encoderSupported || encoderKnown) return;
    let cancelled = false;
    void encoderDownloadBytes().then((bytes) => {
      if (!cancelled && bytes !== null) setEncoder((e) => ({ ...e, bytes }));
    });
    return () => {
      cancelled = true;
    };
  }, [encoderSupported, encoderKnown]);

  // Synchronous SQLite: derive spend on render, no effect/state dance.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const spend: SpendTotals[] = listSpendTotals(db);
  const monthSpend: SpendTotals[] = listSpendTotals(db, monthStart);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionTitle}>Recognition engine</Text>
      <View style={styles.providerRow}>
        {(Object.keys(ENGINE_LABELS) as ProviderChoice[]).map((choice) => (
          <Pressable
            key={choice}
            style={[styles.providerButton, provider === choice && styles.providerActive]}
            onPress={async () => {
              setProvider(choice);
              await setProviderChoice(choice);
              logEvent(db, { kind: 'settings', name: 'engine_changed', detail: { to: choice } });
            }}
          >
            <Text style={[styles.providerLabel, provider === choice && styles.providerLabelActive]}>
              {ENGINE_LABELS[choice]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        Fixture returns canned results and works fully offline. Local runs ML Kit on-device (dev
        build only) — generic names, no brands or labels, works with no connection and no key.
        Claude and OpenAI do full recognition and each needs its own API key below.
      </Text>
      {(provider === 'claude' || provider === 'openai') && (
        <Text style={styles.estimate} testID="scan-estimate">
          ≈ {formatUsd(estimateScanCost(provider).usd)} per scan (estimate at bundled {PRICES_AS_OF}{' '}
          prices — actual spend below is measured)
        </Text>
      )}

      <KeySection
        title="Anthropic API key (Claude)"
        placeholder="sk-ant-…"
        hasStoredKey={hasAnthropicKey}
        idPrefix="anthropic"
        onSave={async (key) => {
          await setApiKey(key);
          const present = key.trim().length > 0;
          setHasAnthropicKey(present);
          // Boolean only — key material never touches the log.
          logEvent(db, {
            kind: 'settings',
            name: 'key_changed',
            detail: { engine: 'claude', present },
          });
          Alert.alert(
            present ? 'Saved' : 'Cleared',
            present
              ? 'Anthropic key updated in the secure store.'
              : 'The Anthropic key has been removed from the secure store.',
          );
        }}
        onTest={async (entered) => {
          const key = entered || (await getApiKey());
          if (!key) throw new Error('Enter or save an Anthropic key first.');
          await testClaudeConnection(key);
        }}
      />

      <KeySection
        title="OpenAI API key"
        placeholder="sk-…"
        hasStoredKey={hasOpenAiKey}
        idPrefix="openai"
        onSave={async (key) => {
          await setOpenAiApiKey(key);
          const present = key.trim().length > 0;
          setHasOpenAiKey(present);
          // Boolean only — key material never touches the log.
          logEvent(db, {
            kind: 'settings',
            name: 'key_changed',
            detail: { engine: 'openai', present },
          });
          Alert.alert(
            present ? 'Saved' : 'Cleared',
            present
              ? 'OpenAI key updated in the secure store.'
              : 'The OpenAI key has been removed from the secure store.',
          );
        }}
        onTest={async (entered) => {
          const key = entered || (await getOpenAiApiKey());
          if (!key) throw new Error('Enter or save an OpenAI key first.');
          await testOpenAiConnection(key);
        }}
      />

      <Text style={styles.sectionTitle}>Cloud spend</Text>
      {spend.length === 0 ? (
        <Text style={styles.hint}>
          No cloud scans yet. Once a cloud engine runs, its real cost shows here — measured from
          each API&apos;s own usage numbers, never guessed.
        </Text>
      ) : (
        <View style={styles.spendCard} testID="spend-card">
          {spend.map((row) => {
            const month = monthSpend.find((m) => m.engine === row.engine);
            return (
              <View key={row.engine} style={styles.spendRow}>
                <Text style={styles.spendEngine}>
                  {ENGINE_LABELS[row.engine as ProviderChoice] ?? row.engine}
                </Text>
                <View style={styles.spendBody}>
                  <Text style={styles.spendMain}>
                    {formatUsd(row.cost_usd)} all time · {row.scans} scan
                    {row.scans === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.spendDetail}>
                    {formatTokens(row.input_tokens)} tokens in · {formatTokens(row.output_tokens)}{' '}
                    out · {month ? `${formatUsd(month.cost_usd)} this month` : 'none this month'}
                  </Text>
                </View>
              </View>
            );
          })}
          <Text style={styles.hint}>
            Measured from API usage fields (D15). Dollar amounts use prices bundled {PRICES_AS_OF}.
          </Text>
        </View>
      )}

      <MapSettings prefs={mapPrefs} onChange={setMapPref} />

      <Text style={styles.sectionTitle}>Diagnostics</Text>
      <Text style={styles.hint}>
        A local event log records app lifecycle, scan timings, queue retries and crashes so a
        problem in the field can be diagnosed afterwards. Nothing is ever uploaded — you share it
        only when you choose to.
      </Text>
      <Link href="/diagnostics" asChild>
        <Pressable
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Open diagnostics"
        >
          <Text style={styles.secondaryLabel}>Open diagnostics</Text>
        </Pressable>
      </Link>

      <UpdateSection build={build} hasToken={hasGithubToken} onTokenChange={setHasGithubToken} />

      <Text style={styles.sectionTitle}>Visual memory</Text>
      <Text style={styles.hint} testID="visual-memory-line">
        {visualMemory.available
          ? `Remembering ${visualMemory.remembered} of ${visualMemory.withPhotos} item${
              visualMemory.withPhotos === 1 ? '' : 's'
            } that have a photo. Photograph something and Binocular can tell you which of your own items it resembles — on this phone, with no connection.`
          : encoder.supported
            ? `Not set up. Binocular can learn what your items look like and match new photos against them offline, once the recognizer has been downloaded${
                encoder.bytes ? ` (${formatBytes(encoder.bytes)}, one time)` : ''
              }. Nothing else changes until then.`
            : 'Not available in this build. Visual memory needs the on-device recognizer, which ships in the standalone app rather than Expo Go.'}
      </Text>
      {encoder.supported && !visualMemory.available && (
        <Pressable
          style={[styles.secondaryButton, encoder.busy && styles.disabled]}
          disabled={encoder.busy}
          accessibilityRole="button"
          accessibilityLabel="Download the recognizer"
          testID="download-encoder"
          onPress={downloadEncoder}
        >
          <Text style={styles.secondaryLabel}>
            {encoder.busy
              ? // A percentage of a download is a measured fact, not a
                // confidence — D5 has nothing to say about it.
                `Downloading… ${Math.round(encoder.progress * 100)}%`
              : 'Download recognizer'}
          </Text>
        </Pressable>
      )}
      {visualMemory.available && (
        <Pressable
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Remove the recognizer"
          testID="remove-encoder"
          onPress={() =>
            Alert.alert(
              'Remove the recognizer?',
              'Frees the downloaded model and turns visual memory off. Your bins, items and photos are untouched, and what it has already learned is kept — downloading it again restores the memory without re-reading every photo.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await removeEncoder();
                      logEvent(db, { kind: 'memory', name: 'encoder_removed' });
                    } catch (err) {
                      Alert.alert(
                        'Could not remove it',
                        err instanceof Error ? err.message : String(err),
                      );
                    }
                    setEncoder((e) => ({ ...e, tick: e.tick + 1 }));
                  },
                },
              ],
            )
          }
        >
          <Text style={styles.secondaryLabel}>Remove recognizer</Text>
        </Pressable>
      )}

      <Text style={styles.sectionTitle}>Storage</Text>
      <Text style={styles.hint}>
        {storage.files === 0
          ? 'No photos stored yet.'
          : `${storage.files} photo${storage.files === 1 ? '' : 's'} · ${formatBytes(storage.bytes)}.`}
        {storage.orphanFiles > 0
          ? ` ${formatBytes(storage.orphanBytes)} belongs to ${storage.orphanFiles} file${
              storage.orphanFiles === 1 ? '' : 's'
            } nothing points at any more — usually retakes and discarded scans.`
          : ' Every file is still referenced by a bin, item or scan.'}
      </Text>
      {storage.orphanFiles > 0 && (
        <Pressable
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel={`Reclaim ${formatBytes(storage.orphanBytes)} of unused photos`}
          testID="reclaim-photos"
          onPress={() =>
            Alert.alert(
              'Delete unused photos?',
              `${storage.orphanFiles} file${storage.orphanFiles === 1 ? '' : 's'} (${formatBytes(
                storage.orphanBytes,
              )}) that nothing in your inventory points at. Photos still attached to a bin, an item, a scan, or a recently deleted item are never touched.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => {
                    const freed = reclaimOrphanPhotos(db);
                    setStorage(readStorageReport(db));
                    Alert.alert(
                      'Cleaned up',
                      `Freed ${formatBytes(freed.bytes)} across ${freed.files} file${
                        freed.files === 1 ? '' : 's'
                      }.`,
                    );
                  },
                },
              ],
            )
          }
        >
          <Text style={styles.secondaryLabel}>Reclaim {formatBytes(storage.orphanBytes)}</Text>
        </Pressable>
      )}

      <Text style={styles.sectionTitle}>Data</Text>
      <Text style={styles.hint}>
        The backup zip holds everything — bins, items, scan history, and photos. CSV is one row per
        item for Excel/Sheets. Import only restores into an empty database.
      </Text>
      <Link href="/tags" asChild>
        <Pressable
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Manage item tags"
        >
          <Text style={styles.secondaryLabel}>Manage tags</Text>
        </Pressable>
      </Link>
      <Link href="/trash" asChild>
        <Pressable
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Open recently deleted items"
        >
          <Text style={styles.secondaryLabel}>Recently deleted items</Text>
        </Pressable>
      </Link>
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.primaryButton, busyData && styles.disabled]}
          disabled={busyData}
          onPress={() => runDataAction(() => exportBackupZip(db))}
        >
          <Text style={styles.primaryLabel}>Export backup</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, busyData && styles.disabled]}
          disabled={busyData}
          onPress={() => runDataAction(() => exportInventoryCsv(db))}
        >
          <Text style={styles.secondaryLabel}>Export CSV</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, busyData && styles.disabled]}
          disabled={busyData}
          onPress={pickAndImport}
        >
          <Text style={styles.secondaryLabel}>Import backup</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Extra bottom padding keeps the last section above the gesture bar.
  container: {
    padding: sp(4),
    paddingBottom: sp(12),
    gap: sp(3),
    backgroundColor: colors.bg,
    flexGrow: 1,
  },
  sectionTitle: { ...type.stamp, marginTop: sp(2) },
  keySection: { gap: sp(2.5) },
  providerRow: { flexDirection: 'row', gap: sp(2) },
  providerButton: {
    flex: 1,
    padding: sp(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
  },
  providerActive: { backgroundColor: colors.amber, borderColor: colors.amber },
  providerLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  providerLabelActive: { color: colors.amberInkOn },
  hint: { ...type.dim, lineHeight: 18 },
  estimate: { color: colors.amber, fontSize: 13, fontWeight: '600' },
  spendCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: sp(3),
    gap: sp(3),
  },
  spendRow: { flexDirection: 'row', gap: sp(3), alignItems: 'flex-start' },
  spendEngine: { color: colors.steel, fontWeight: '700', fontSize: 13, minWidth: 64 },
  spendBody: { flex: 1, gap: 2 },
  spendMain: { color: colors.text, fontSize: 14, fontWeight: '600' },
  spendDetail: { ...type.dim, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    padding: sp(3),
    fontSize: 15,
  },
  // Wraps because Android font scale can push a two-button row off the right
  // edge, and a button you cannot see is a button you cannot press.
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2.5) },
  dangerButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.dangerDim,
    paddingHorizontal: sp(4.5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  dangerLabel: { color: colors.danger, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.amber,
    paddingHorizontal: sp(4.5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  primaryLabel: { color: colors.amberInkOn, fontWeight: '700' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: sp(4.5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  secondaryLabel: { color: colors.steel, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
