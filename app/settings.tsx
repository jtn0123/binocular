import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import * as DocumentPicker from 'expo-document-picker';

import { exportBackupZip, exportInventoryCsv, importBackupZip } from '@/backup/backup';
import { useDb } from '@/db/DbProvider';
import { isDatabaseEmpty } from '@/db/backupQueries';
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

  useEffect(() => {
    void (async () => {
      setProvider(await getProviderChoice());
      setHasAnthropicKey((await getApiKey()) !== null);
      setHasOpenAiKey((await getOpenAiApiKey()) !== null);
    })();
  }, []);

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

      <KeySection
        title="Anthropic API key (Claude)"
        placeholder="sk-ant-…"
        hasStoredKey={hasAnthropicKey}
        onSave={async (key) => {
          await setApiKey(key);
          setHasAnthropicKey(key.trim().length > 0);
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
          setHasOpenAiKey(key.trim().length > 0);
          Alert.alert('Saved', 'OpenAI key updated in the secure store.');
        }}
        onTest={async (entered) => {
          const key = entered || (await getOpenAiApiKey());
          if (!key) throw new Error('Enter or save an OpenAI key first.');
          await testOpenAiConnection(key);
        }}
      />

      <Text style={styles.sectionTitle}>Data</Text>
      <Text style={styles.hint}>
        The backup zip holds everything — bins, items, scan history, and photos. CSV is one row
        per item for Excel/Sheets. Import only restores into an empty database.
      </Text>
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
  container: { padding: sp(4), gap: sp(3), backgroundColor: colors.bg, flexGrow: 1 },
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
