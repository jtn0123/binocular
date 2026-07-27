import type { File } from 'expo-file-system';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatBytes } from '@/backup/storage';
import { describeBuild, RELEASES_URL, type BuildInfo } from '@/settings/build';
import { getGithubToken, setGithubToken } from '@/settings/settings';
import { colors, radius, sp, type } from '@/theme';
import {
  checkForUpdate,
  type AvailableBuild,
  type UpdateCheck,
} from '@/update/releases';
import { clearDownloads, downloadBuild, installBuild, installSupport } from '@/update/installer';

/**
 * Update from inside the app (docs/RELEASES.md).
 *
 * The old row here opened the releases page in a browser and said plainly
 * that the app did not check for updates, because it could not: the
 * repository is private and no anonymous check is possible. That is still
 * true of an *anonymous* check — what this adds is the option of a token the
 * user supplies, kept in the secure store beside the vision API keys, so
 * nothing secret is ever inside the APK.
 *
 * The browser path stays. It is the fallback when there is no token, the
 * answer when a download fails on workshop Wi-Fi, and the only path at all
 * on a platform that cannot sideload.
 *
 * Sizes are shown in bytes rather than as a proportion — partly because the
 * download is ~100 MB and "how much of my data is this" is the real question,
 * and partly because `formatBytes` is already how this screen talks about
 * storage.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'checked'; result: UpdateCheck }
  | { kind: 'downloading'; build: AvailableBuild; written: number; total: number }
  | { kind: 'ready'; build: AvailableBuild; file: File };

export function UpdateSection({
  build,
  hasToken,
  onTokenChange,
}: {
  build: BuildInfo;
  hasToken: boolean;
  onTokenChange: (stored: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [cancel, setCancel] = useState<(() => void) | null>(null);
  const support = installSupport();

  /**
   * The build there is a point in downloading, or null. Held as one value
   * because the narrowing is lost inside a press handler, and because
   * "offer a download" is one idea rather than three conditions repeated.
   */
  const offerable =
    phase.kind === 'checked' && phase.result.state === 'newer' && support.supported
      ? phase.result.build
      : null;

  const openReleases = () => {
    void Linking.openURL(RELEASES_URL).catch(() =>
      Alert.alert('Could not open the browser', RELEASES_URL),
    );
  };

  const check = async () => {
    setPhase({ kind: 'checking' });
    const result = await checkForUpdate(build.buildNumber, await getGithubToken());
    if (result.state === 'needs-token' || result.state === 'bad-token') setShowToken(true);
    setPhase({ kind: 'checked', result });
  };

  const download = async (available: AvailableBuild) => {
    setPhase({ kind: 'downloading', build: available, written: 0, total: available.asset.bytes });
    const handle = downloadBuild(available, await getGithubToken(), (written, total) =>
      setPhase((prev) =>
        prev.kind === 'downloading' ? { ...prev, written, total } : prev,
      ),
    );
    setCancel(() => handle.cancel);
    try {
      const file = await handle.done;
      // null means paused rather than finished; treat it as not-downloaded
      // rather than handing a partial file to the installer.
      if (file) setPhase({ kind: 'ready', build: available, file });
      else setPhase({ kind: 'checked', result: { state: 'newer', build: available } });
    } catch (err) {
      clearDownloads();
      setPhase({ kind: 'checked', result: { state: 'newer', build: available } });
      const message = err instanceof Error ? err.message : String(err);
      // A cancel rejects the promise too, and that is not a failure worth an
      // alert — the user is the one who pressed it.
      if (!/abort|cancel/i.test(message)) {
        Alert.alert('The download did not finish', `${message}\n\nThe releases page still works.`);
      }
    } finally {
      setCancel(null);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Updates</Text>
      <Text style={styles.hint} testID="update-build-line">
        {describeState(phase, build, support.supported ? null : support.reason)}
      </Text>

      {phase.kind === 'checked' ? <Detail result={phase.result} /> : null}

      {phase.kind === 'downloading' ? (
        <Progress written={phase.written} total={phase.total} />
      ) : null}

      <View style={styles.buttons}>
        {phase.kind === 'downloading' ? (
          <Pressable
            style={styles.secondary}
            onPress={() => cancel?.()}
            accessibilityRole="button"
            accessibilityLabel="Stop the download"
            testID="update-cancel"
          >
            <Text style={styles.secondaryLabel}>Stop</Text>
          </Pressable>
        ) : phase.kind === 'ready' ? (
          <Pressable
            style={styles.primary}
            onPress={() => {
              void installBuild(phase.file).catch((err: unknown) =>
                Alert.alert(
                  'Android would not open the installer',
                  `${err instanceof Error ? err.message : String(err)}\n\nAllow Binocular to install unknown apps in Android settings, then try again.`,
                ),
              );
            }}
            accessibilityRole="button"
            accessibilityLabel={`Install ${phase.build.title}`}
            testID="update-install"
          >
            <Text style={styles.primaryLabel}>Install {phase.build.tag}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primary, phase.kind === 'checking' && styles.disabled]}
            disabled={phase.kind === 'checking'}
            onPress={() => void check()}
            accessibilityRole="button"
            accessibilityLabel="Check GitHub for a newer build"
            testID="update-check"
          >
            <Text style={styles.primaryLabel}>
              {phase.kind === 'checking' ? 'Checking…' : 'Check for updates'}
            </Text>
          </Pressable>
        )}

        {offerable ? (
          <Pressable
            style={styles.secondary}
            onPress={() => void download(offerable)}
            accessibilityRole="button"
            accessibilityLabel={`Download ${offerable.asset.name}`}
            testID="update-download"
          >
            <Text style={styles.secondaryLabel}>
              Download ({formatBytes(offerable.asset.bytes)})
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          style={styles.secondary}
          onPress={openReleases}
          accessibilityRole="button"
          accessibilityLabel="Open the GitHub releases page in your browser"
          testID="open-releases"
        >
          <Text style={styles.secondaryLabel}>Releases ↗</Text>
        </Pressable>
      </View>

      {showToken || hasToken ? (
        <View style={styles.tokenBox}>
          <Text style={styles.hint}>
            {hasToken
              ? 'A GitHub token is stored. It is only used to read this repository’s releases.'
              : 'This repository is private, so checking needs a GitHub token with read access to it. Create a fine-grained token with Contents: Read-only and paste it here — it stays in this phone’s secure store and never goes into a build.'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder={hasToken ? 'Enter a new token to replace it' : 'github_pat_…'}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            testID="update-token-input"
          />
          <Pressable
            style={styles.secondary}
            accessibilityRole="button"
            accessibilityLabel={token.trim() ? 'Save the GitHub token' : 'Clear the GitHub token'}
            testID="update-token-save"
            onPress={() => {
              const next = token.trim();
              void setGithubToken(next.length > 0 ? next : null).then(() => {
                setToken('');
                onTokenChange(next.length > 0);
                setPhase({ kind: 'idle' });
              });
            }}
          >
            <Text style={styles.secondaryLabel}>{token.trim() ? 'Save token' : 'Clear token'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Progress({ written, total }: { written: number; total: number }) {
  return (
    <Text style={styles.progress} testID="update-progress">
      {formatBytes(written)} of {formatBytes(total)}
    </Text>
  );
}

function Detail({ result }: { result: UpdateCheck }) {
  if (result.state !== 'newer' && result.state !== 'older' && result.state !== 'unknown') {
    return null;
  }
  return (
    <View style={styles.notes} testID="update-notes">
      <Text style={styles.notesTitle}>{result.build.title}</Text>
      {result.build.notes ? (
        <Text style={styles.notesBody} numberOfLines={12}>
          {result.build.notes}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One sentence saying where things stand. Every branch names the running
 * build, because "which one am I on" is the question this screen exists to
 * answer and it stays true whether or not the check succeeded.
 */
function describeState(phase: Phase, build: BuildInfo, unsupported: string | null): string {
  const running = `Running ${describeBuild(build)}`;

  switch (phase.kind) {
    case 'idle':
      return `${running}. ${unsupported ?? 'Builds are published as GitHub Releases; checking asks GitHub which is newest.'}`;
    case 'checking':
      return `${running}. Asking GitHub…`;
    case 'downloading':
      return `${running}. Downloading ${phase.build.tag} — this is a large file, so Wi-Fi is worth having.`;
    case 'ready':
      return `${running}. ${phase.build.tag} is downloaded. Android will ask you to confirm; your bins, items and photos are kept.`;
    case 'checked':
      // The platform note is appended rather than shown instead of the
      // result: knowing a newer build exists is useful even where this app
      // cannot install it, and the browser route below still works.
      return [
        `${running}.`,
        describeResult(phase.result),
        unsupported && phase.result.state === 'newer' ? unsupported : null,
      ]
        .filter(Boolean)
        .join(' ');
  }
}

function describeResult(result: UpdateCheck): string {
  switch (result.state) {
    case 'newer':
      return `${result.build.tag} is newer.`;
    case 'current':
      return 'That is the newest build published.';
    case 'older':
      return `The newest build published is ${result.build.tag}, which is older than this one — you are ahead of the releases.`;
    case 'unknown':
      return `The newest build published is ${result.build.tag}, but this build carries no version code to compare it against, so whether it is newer is not known.`;
    case 'none':
      return 'No release has an APK attached yet.';
    case 'needs-token':
      return 'GitHub would not answer without a token.';
    case 'bad-token':
      return 'GitHub rejected the stored token. It may have expired, or it may not have read access to this repository.';
    case 'offline':
      return 'Could not reach GitHub. Everything else in the app works offline; this is the one thing that does not.';
    case 'failed':
      return `The check failed: ${result.detail}.`;
  }
}

const styles = StyleSheet.create({
  section: { gap: sp(2) },
  sectionTitle: { ...type.stamp, marginTop: sp(2) },
  hint: { ...type.dim, lineHeight: 18 },
  progress: { color: colors.amber, fontSize: 13, fontWeight: '600' },
  notes: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: sp(2.5),
    gap: sp(1),
  },
  notesTitle: { color: colors.text, fontWeight: '700', fontSize: 13 },
  notesBody: { ...type.dim, fontSize: 12, lineHeight: 17 },
  tokenBox: { gap: sp(2), marginTop: sp(1) },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: sp(2.5),
    color: colors.text,
    backgroundColor: colors.surface,
  },
  buttons: { flexDirection: 'row', gap: sp(2), flexWrap: 'wrap' },
  primary: {
    backgroundColor: colors.amber,
    paddingVertical: sp(2.5),
    paddingHorizontal: sp(3),
    borderRadius: radius.sm,
  },
  primaryLabel: { color: colors.amberInkOn, fontWeight: '700' },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: sp(2.5),
    paddingHorizontal: sp(3),
    borderRadius: radius.sm,
  },
  secondaryLabel: { color: colors.steel, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
