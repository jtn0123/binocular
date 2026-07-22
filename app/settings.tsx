import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  getApiKey,
  getProviderChoice,
  setApiKey,
  setProviderChoice,
  type ProviderChoice,
} from '@/settings/settings';
import { testClaudeConnection } from '@/vision/claudeProvider';

export default function SettingsScreen() {
  const [keyInput, setKeyInput] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [provider, setProvider] = useState<ProviderChoice>('fixture');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      setHasStoredKey((await getApiKey()) !== null);
      setProvider(await getProviderChoice());
    })();
  }, []);

  async function saveKey() {
    await setApiKey(keyInput);
    setHasStoredKey(keyInput.trim().length > 0);
    setKeyInput('');
    Alert.alert('Saved', 'API key stored in the device secure store.');
  }

  async function pickProvider(choice: ProviderChoice) {
    setProvider(choice);
    await setProviderChoice(choice);
  }

  async function testConnection() {
    const key = keyInput.trim() || (await getApiKey());
    if (!key) {
      Alert.alert('No key', 'Enter or save an API key first.');
      return;
    }
    setTesting(true);
    try {
      await testClaudeConnection(key);
      Alert.alert('Success', 'The API key works.');
    } catch (err) {
      Alert.alert('Connection failed', err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionTitle}>Recognition engine</Text>
      <View style={styles.providerRow}>
        {(['fixture', 'claude'] as const).map((choice) => (
          <Pressable
            key={choice}
            style={[styles.providerButton, provider === choice && styles.providerActive]}
            onPress={() => pickProvider(choice)}
          >
            <Text style={[styles.providerLabel, provider === choice && styles.providerLabelActive]}>
              {choice === 'fixture' ? 'Fixture (demo)' : 'Claude (cloud)'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        Fixture returns canned results and works fully offline — the whole app is demo-able with
        it. Claude does real recognition and needs an API key. A local on-device engine joins in
        Stage 5.
      </Text>

      <Text style={styles.sectionTitle}>Anthropic API key</Text>
      <Text style={styles.hint}>
        {hasStoredKey ? 'A key is stored in the secure store.' : 'No key stored yet.'}
      </Text>
      <TextInput
        style={styles.input}
        placeholder={hasStoredKey ? 'Enter a new key to replace it' : 'sk-ant-…'}
        value={keyInput}
        onChangeText={setKeyInput}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <View style={styles.buttonRow}>
        <Pressable style={styles.primaryButton} onPress={saveKey}>
          <Text style={styles.primaryLabel}>{keyInput.trim() ? 'Save key' : 'Clear key'}</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, testing && styles.disabled]}
          onPress={testConnection}
          disabled={testing}
        >
          <Text style={styles.secondaryLabel}>{testing ? 'Testing…' : 'Test connection'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#666',
    marginTop: 8,
  },
  providerRow: { flexDirection: 'row', gap: 8 },
  providerButton: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  providerActive: { backgroundColor: '#208AEF', borderColor: '#208AEF' },
  providerLabel: { color: '#444', fontWeight: '500' },
  providerLabelActive: { color: '#fff' },
  hint: { color: '#777', fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, fontSize: 15 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  primaryButton: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryLabel: { color: '#fff', fontWeight: '600' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#208AEF',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondaryLabel: { color: '#208AEF', fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
