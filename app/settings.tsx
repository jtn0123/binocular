import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  getApiKey,
  getOpenAiApiKey,
  getProviderChoice,
  setApiKey,
  setOpenAiApiKey,
  setProviderChoice,
  type ProviderChoice,
} from '@/settings/settings';
import { testClaudeConnection } from '@/vision/claudeProvider';
import { testOpenAiConnection } from '@/vision/openaiProvider';

const ENGINE_LABELS: Record<ProviderChoice, string> = {
  fixture: 'Fixture (demo)',
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
  const [provider, setProvider] = useState<ProviderChoice>('fixture');
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
        Fixture returns canned results and works fully offline — the whole app is demo-able with
        it. Claude and OpenAI do real recognition and each needs its own API key below. A local
        on-device engine joins in Stage 5.
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
  keySection: { gap: 10 },
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
  providerLabel: { color: '#444', fontWeight: '500', fontSize: 13 },
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
