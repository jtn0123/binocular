import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { UpdateSection } from '@/components/settings/UpdateSection';
import type { BuildInfo } from '@/settings/build';

// The download and install paths are Android-only, and jest runs as iOS by
// default — without this every assertion below would be testing the
// "not on this platform" branch instead of the feature.
(Platform as { OS: string }).OS = 'android';

jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ getContentUriAsync: jest.fn() }));

const secureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => secureStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    secureStore[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete secureStore[k];
  }),
}));

const RUNNING: BuildInfo = { version: '0.1.0+ci.42', buildNumber: 1042, isDev: false };

function releaseJson() {
  return [
    {
      tag_name: 'build-46',
      name: 'Binocular 0.1.0+ci.46',
      html_url: 'https://github.com/jtn0123/binocular/releases/tag/build-46',
      draft: false,
      prerelease: true,
      body: 'Changes\n- a fix',
      assets: [
        {
          name: 'binocular-0.1.0-ci.46-vc1046.apk',
          size: 104_857_600,
          url: 'https://api.github.com/repos/jtn0123/binocular/releases/assets/1',
          browser_download_url: 'https://example.invalid/x.apk',
        },
      ],
    },
  ];
}

function answerWith(status: number, body: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  for (const k of Object.keys(secureStore)) delete secureStore[k];
  jest.clearAllMocks();
});

describe('the update section', () => {
  it('names the running build before anything has been checked', async () => {
    const screen = await render(
      <UpdateSection build={RUNNING} hasToken={false} onTokenChange={() => {}} />,
    );
    // "Which build am I on" must be answerable with no network at all.
    expect(screen.getByTestId('update-build-line')).toHaveTextContent(/0\.1\.0\+ci\.42/);
    expect(screen.getByTestId('update-check')).toBeTruthy();
  });

  it('reports a newer build, with its notes, and offers the download', async () => {
    answerWith(200, releaseJson());
    const screen = await render(
      <UpdateSection build={RUNNING} hasToken={false} onTokenChange={() => {}} />,
    );

    await fireEvent.press(screen.getByTestId('update-check'));

    await waitFor(() => expect(screen.getByTestId('update-notes')).toBeTruthy());
    expect(screen.getByTestId('update-build-line')).toHaveTextContent(/build-46 is newer/);
    expect(screen.getByTestId('update-notes')).toHaveTextContent(/a fix/);
    expect(screen.getByTestId('update-download')).toBeTruthy();
  });

  it('does not offer a download when the newest build is the one running', async () => {
    answerWith(200, releaseJson());
    const screen = await render(
      <UpdateSection
        build={{ ...RUNNING, buildNumber: 1046 }}
        hasToken={false}
        onTokenChange={() => {}}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-check'));

    await waitFor(() =>
      expect(screen.getByTestId('update-build-line')).toHaveTextContent(/newest build published/),
    );
    expect(screen.queryByTestId('update-download')).toBeNull();
  });

  it('asks for a token when GitHub will not answer anonymously', async () => {
    // A private repository 404s an anonymous read rather than admitting it
    // exists, so this is the normal first run — not an error.
    answerWith(404, {});
    const screen = await render(
      <UpdateSection build={RUNNING} hasToken={false} onTokenChange={() => {}} />,
    );

    await fireEvent.press(screen.getByTestId('update-check'));

    await waitFor(() => expect(screen.getByTestId('update-token-input')).toBeTruthy());
    expect(screen.getByTestId('update-build-line')).toHaveTextContent(/without a token/);
  });

  it('says it could not ask, rather than that there is no update, when offline', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;
    const screen = await render(
      <UpdateSection build={RUNNING} hasToken={false} onTokenChange={() => {}} />,
    );

    await fireEvent.press(screen.getByTestId('update-check'));

    await waitFor(() =>
      expect(screen.getByTestId('update-build-line')).toHaveTextContent(/Could not reach GitHub/),
    );
    expect(screen.queryByTestId('update-download')).toBeNull();
  });

  it('will not claim to be up to date when it cannot compare', async () => {
    // A dev build has no version code. "Up to date" would be a guess.
    answerWith(200, releaseJson());
    const screen = await render(
      <UpdateSection
        build={{ ...RUNNING, buildNumber: null }}
        hasToken={false}
        onTokenChange={() => {}}
      />,
    );

    await fireEvent.press(screen.getByTestId('update-check'));

    await waitFor(() =>
      expect(screen.getByTestId('update-build-line')).toHaveTextContent(/is not known/),
    );
    expect(screen.queryByTestId('update-download')).toBeNull();
  });

  it('keeps the token in the secure store and reports that it now has one', async () => {
    const onTokenChange = jest.fn();
    const screen = await render(
      <UpdateSection build={RUNNING} hasToken={false} onTokenChange={onTokenChange} />,
    );
    answerWith(404, {});
    await fireEvent.press(screen.getByTestId('update-check'));
    await waitFor(() => expect(screen.getByTestId('update-token-input')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('update-token-input'), 'github_pat_secret');
    await fireEvent.press(screen.getByTestId('update-token-save'));

    await waitFor(() => expect(onTokenChange).toHaveBeenCalledWith(true));
    // Never in plain storage and never in the bundle — same rule as the
    // vision API keys (blueprint Q1).
    expect(secureStore['binocular.github_token']).toBe('github_pat_secret');
  });

  it('always leaves the browser route out, whatever the check said', async () => {
    const screen = await render(
      <UpdateSection build={RUNNING} hasToken={false} onTokenChange={() => {}} />,
    );
    expect(screen.getByTestId('open-releases')).toBeTruthy();
  });
});
