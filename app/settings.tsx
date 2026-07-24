import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import * as DocumentPicker from 'expo-document-picker';
import { Link } from 'expo-router';

import { exportBackupZip, exportInventoryCsv, importBackupZip } from '@/backup/backup';
import {
  formatBytes,
  readStorageReport,
  reclaimOrphanPhotos,
  type StorageReport,
} from '@/backup/storage';
import { logEvent } from '@/diagnostics/events';
import { useDb } from '@/db/DbProvider';
import { isDatabaseEmpty } from '@/db/backupQueries';
import { listSpendTotals, type SpendTotals } from '@/db/queries';
import { buildInfo, describeBuild, RELEASES_URL } from '@/settings/build';
import {
  getApiKey,
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
  onSave,
  onTest,
}: {
  title: string;
  placeholder: string;
  hasStoredKey: boolean;
  onSave: (key: string) => Promise<void>;
  onTest: (enteredKey: string) => Promise<void>;
}) {
  const [keyInput, setKeyInput] = useState('');
  const [testing, setTesting] = useState(false);

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
        <Pressable
          style={styles.primaryButton}
          onPress={async () => {
            await onSave(keyInput);
            setKeyInput('');
          }}
        >
          <Text style={styles.primaryLabel}>{keyInput.trim() ? 'Save key' : 'Clear key'}</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, testing && styles.disabled]}
          disabled={testing}
          onPress={async () => {
            setTesting(true);
            try {
              await onTest(keyInput.trim());
              Alert.alert('Success', 'The API key works.');
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
  // Touches the filesystem, so unlike the SQLite-derived numbers below it is
  // read once on mount rather than on every render — and re-read after a
  // cleanup, which is the only thing that changes it from here.
  const [storage, setStorage] = useState<StorageReport>(() => readStorageReport(db));
  const build = buildInfo();

  useEffect(() => {
    void (async () => {
      setProvider(await getProviderChoice());
      setHasAnthropicKey((await getApiKey()) !== null);
      setHasOpenAiKey((await getOpenAiApiKey()) !== null);
    })();
  }, []);

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
        Fixture returns canned results and works fully offline. Local runs ML Kit on-device
        (dev build only) — generic names, no brands or labels, works with no connection and no
        key. Claude and OpenAI do full recognition and each needs its own API key below.
      </Text>
      {(provider === 'claude' || provider === 'openai') && (
        <Text style={styles.estimate} testID="scan-estimate">
          ≈ {formatUsd(estimateScanCost(provider).usd)} per scan (estimate at bundled{' '}
          {PRICES_AS_OF} prices — actual spend below is measured)
        </Text>
      )}

      <KeySection
        title="Anthropic API key (Claude)"
        placeholder="sk-ant-…"
        hasStoredKey={hasAnthropicKey}
        onSave={async (key) => {
          await setApiKey(key);
          const present = key.trim().length > 0;
          setHasAnthropicKey(present);
          // Boolean only — key material never touches the log.
          logEvent(db, { kind: 'settings', name: 'key_changed', detail: { engine: 'claude', present } });
          Alert.alert('Saved', 'Anthropic key updated in the secure store.');
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
        onSave={async (key) => {
          await setOpenAiApiKey(key);
          const present = key.trim().length > 0;
          setHasOpenAiKey(present);
          // Boolean only — key material never touches the log.
          logEvent(db, { kind: 'settings', name: 'key_changed', detail: { engine: 'openai', present } });
          Alert.alert('Saved', 'OpenAI key updated in the secure store.');
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
          No cloud scans yet. Once a cloud engine runs, its real cost shows here — measured
          from each API&apos;s own usage numbers, never guessed.
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
            Measured from API usage fields (D15). Dollar amounts use prices bundled{' '}
            {PRICES_AS_OF}.
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Diagnostics</Text>
      <Text style={styles.hint}>
        A local event log records app lifecycle, scan timings, queue retries and crashes so a
        problem in the field can be diagnosed afterwards. Nothing is ever uploaded — you share
        it only when you choose to.
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

      <Text style={styles.sectionTitle}>This build</Text>
      <Text style={styles.hint} testID="build-line">
        {describeBuild(build)}. Updates are published as GitHub Releases — open the page on this
        phone and install the APK over the top; your bins, items and photos are kept.
      </Text>
      <Pressable
        style={styles.secondaryButton}
        accessibilityRole="button"
        accessibilityLabel="Open the releases page to check for a newer build"
        testID="open-releases"
        onPress={() => {
          void Linking.openURL(RELEASES_URL).catch(() =>
            Alert.alert('Could not open the browser', RELEASES_URL),
          );
        }}
      >
        <Text style={styles.secondaryLabel}>Check for updates</Text>
      </Pressable>

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
        The backup zip holds everything — bins, items, scan history, and photos. CSV is one row
        per item for Excel/Sheets. Import only restores into an empty database.
      </Text>
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
  container: { padding: sp(4), paddingBottom: sp(12), gap: sp(3), backgroundColor: colors.bg, flexGrow: 1 },
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
  buttonRow: { flexDirection: 'row', gap: sp(2.5) },
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
