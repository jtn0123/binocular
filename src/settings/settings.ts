import * as SecureStore from 'expo-secure-store';

/**
 * Blueprint Q1 default: personal-use app, API key entered in Settings and
 * kept in the platform secure store — never in plain storage or the bundle.
 */
const API_KEY = 'binocular.anthropic_api_key';
const PROVIDER = 'binocular.vision_provider';

export type ProviderChoice = 'fixture' | 'claude';

function defaultProvider(): ProviderChoice {
  return process.env.EXPO_PUBLIC_VISION_PROVIDER === 'claude' ? 'claude' : 'fixture';
}

export async function getApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY);
}

export async function setApiKey(key: string | null): Promise<void> {
  if (key && key.trim().length > 0) {
    await SecureStore.setItemAsync(API_KEY, key.trim());
  } else {
    await SecureStore.deleteItemAsync(API_KEY);
  }
}

export async function getProviderChoice(): Promise<ProviderChoice> {
  const stored = await SecureStore.getItemAsync(PROVIDER);
  return stored === 'claude' || stored === 'fixture' ? stored : defaultProvider();
}

export async function setProviderChoice(choice: ProviderChoice): Promise<void> {
  await SecureStore.setItemAsync(PROVIDER, choice);
}
