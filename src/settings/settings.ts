import * as SecureStore from 'expo-secure-store';

/**
 * Blueprint Q1 default: personal-use app, API keys entered in Settings and
 * kept in the platform secure store — never in plain storage or the bundle.
 * One key per cloud engine (D14).
 */
const ANTHROPIC_KEY = 'binocular.anthropic_api_key';
const OPENAI_KEY = 'binocular.openai_api_key';
const PROVIDER = 'binocular.vision_provider';

export type ProviderChoice = 'fixture' | 'local' | 'claude' | 'openai';

const PROVIDER_CHOICES: readonly ProviderChoice[] = ['fixture', 'local', 'claude', 'openai'];

function defaultProvider(): ProviderChoice {
  const env = process.env.EXPO_PUBLIC_VISION_PROVIDER;
  return PROVIDER_CHOICES.includes(env as ProviderChoice) ? (env as ProviderChoice) : 'fixture';
}

async function getStoredKey(storageKey: string): Promise<string | null> {
  return SecureStore.getItemAsync(storageKey);
}

async function setStoredKey(storageKey: string, value: string | null): Promise<void> {
  if (value && value.trim().length > 0) {
    await SecureStore.setItemAsync(storageKey, value.trim());
  } else {
    await SecureStore.deleteItemAsync(storageKey);
  }
}

export const getApiKey = () => getStoredKey(ANTHROPIC_KEY);
export const setApiKey = (key: string | null) => setStoredKey(ANTHROPIC_KEY, key);
export const getOpenAiApiKey = () => getStoredKey(OPENAI_KEY);
export const setOpenAiApiKey = (key: string | null) => setStoredKey(OPENAI_KEY, key);

export async function getProviderChoice(): Promise<ProviderChoice> {
  const stored = await SecureStore.getItemAsync(PROVIDER);
  return PROVIDER_CHOICES.includes(stored as ProviderChoice)
    ? (stored as ProviderChoice)
    : defaultProvider();
}

export async function setProviderChoice(choice: ProviderChoice): Promise<void> {
  await SecureStore.setItemAsync(PROVIDER, choice);
}
