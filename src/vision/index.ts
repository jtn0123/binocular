import { getApiKey, getOpenAiApiKey, getProviderChoice } from '../settings/settings';

import { createClaudeProvider } from './claudeProvider';
import { createFixtureProvider } from './fixtureProvider';
import { createOpenAiProvider } from './openaiProvider';
import type { VisionProvider } from './provider';

/** Screens never touch providers directly — the scan flow resolves one here. */
export async function resolveVisionProvider(): Promise<VisionProvider> {
  const choice = await getProviderChoice();
  if (choice === 'claude') return createClaudeProvider(getApiKey);
  if (choice === 'openai') return createOpenAiProvider(getOpenAiApiKey);
  return createFixtureProvider();
}
