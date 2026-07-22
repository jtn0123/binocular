import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CodeTag } from '@/components/CodeTag';
import { useDb } from '@/db/DbProvider';
import { getBin, listAttentionScans, updateScanStatus, type ScanRow } from '@/db/queries';
import { nowIso } from '@/lib/time';
import { useFocusTick } from '@/lib/useFocusTick';
import { getScanQueue } from '@/queue/scanQueue';
import { colors, mono, radius, sp, type } from '@/theme';

const STATUS_LABEL: Record<ScanRow['status'], string> = {
  queued: 'Waiting for connection',
  processing: 'Recognizing…',
  review: 'Ready to review',
  confirmed: 'Confirmed',
  discarded: 'Discarded',
  failed: 'Failed',
};

function waitLabel(scanId: string): string | null {
  const queue = getScanQueue();
  if (!queue) return null;
  const wait = queue.waitMsFor(scanId);
  if (wait === null) return 'retry manually';
  if (wait <= 0) return null;
  const mins = Math.round(wait / 60_000);
  return mins >= 1 ? `retrying in ~${mins}m` : `retrying in ${Math.round(wait / 1000)}s`;
}

export default function QueueScreen() {
  const db = useDb();
  const router = useRouter();
  useFocusTick();
  const [tick, setTick] = useState(0);
  void tick;

  const scans = listAttentionScans(db);

  async function retry(scan: ScanRow) {
    const queue = getScanQueue();
    if (queue) await queue.retryNow(scan.id);
    setTick((t) => t + 1);
  }

  function discard(scan: ScanRow) {
    updateScanStatus(db, scan.id, 'discarded', { resolvedAt: nowIso() });
    setTick((t) => t + 1);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Scan queue' }} />
      <FlatList
        data={scans}
        keyExtractor={(scan) => scan.id}
        contentContainerStyle={{ gap: sp(2.5), padding: sp(4) }}
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing pending — every scan is settled.</Text>
        }
        renderItem={({ item: scan }) => {
          const bin = scan.bin_id ? getBin(db, scan.bin_id) : null;
          const wait = scan.status === 'queued' ? waitLabel(scan.id) : null;
          const isAuthError = scan.status === 'failed' && /key|auth/i.test(scan.error ?? '');
          return (
            <View style={styles.card}>
              {scan.photo_uri ? (
                <Image source={{ uri: scan.photo_uri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Ionicons name="image" size={18} color={colors.textFaint} />
                </View>
              )}
              <View style={styles.main}>
                <View style={styles.headerRow}>
                  {bin ? <CodeTag code={bin.short_code} small /> : null}
                  <Text style={styles.mode}>{scan.mode.replace('_', ' ')}</Text>
                </View>
                <Text style={styles.status}>
                  {STATUS_LABEL[scan.status]}
                  {wait ? ` · ${wait}` : ''}
                </Text>
                {scan.error ? (
                  <Text style={styles.error} numberOfLines={2}>
                    {scan.error}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  {scan.status === 'review' ? (
                    <Pressable
                      style={styles.actionPrimary}
                      onPress={() =>
                        router.push({
                          pathname: scan.mode === 'find_it' ? '/find/[scanId]' : '/review/[scanId]',
                          params: { scanId: scan.id },
                        })
                      }
                    >
                      <Text style={styles.actionPrimaryLabel}>Review</Text>
                    </Pressable>
                  ) : null}
                  {(scan.status === 'queued' || scan.status === 'failed') && (
                    <Pressable style={styles.action} onPress={() => retry(scan)}>
                      <Text style={styles.actionLabel}>Retry now</Text>
                    </Pressable>
                  )}
                  {isAuthError && (
                    <Link href="/settings" asChild>
                      <Pressable style={styles.action}>
                        <Text style={styles.actionLabel}>Open Settings</Text>
                      </Pressable>
                    </Link>
                  )}
                  {scan.status !== 'processing' && (
                    <Pressable style={styles.actionDanger} onPress={() => discard(scan)}>
                      <Text style={styles.actionDangerLabel}>Discard</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: {
    flexDirection: 'row',
    gap: sp(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: sp(3),
  },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceSunken },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  mode: { fontFamily: mono, fontSize: 12, color: colors.textDim },
  status: { ...type.body, fontWeight: '600' },
  error: { fontSize: 12, color: colors.danger },
  actions: { flexDirection: 'row', gap: sp(2), marginTop: sp(1), flexWrap: 'wrap' },
  actionPrimary: {
    backgroundColor: colors.amber,
    paddingHorizontal: sp(3),
    paddingVertical: sp(1.5),
    borderRadius: radius.pill,
  },
  actionPrimaryLabel: { color: colors.amberInkOn, fontWeight: '700', fontSize: 13 },
  action: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: sp(3),
    paddingVertical: sp(1.5),
    borderRadius: radius.pill,
  },
  actionLabel: { color: colors.steel, fontWeight: '600', fontSize: 13 },
  actionDanger: {
    borderWidth: 1,
    borderColor: '#5A2F2A',
    paddingHorizontal: sp(3),
    paddingVertical: sp(1.5),
    borderRadius: radius.pill,
  },
  actionDangerLabel: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  empty: { ...type.dim, paddingVertical: sp(10), textAlign: 'center' },
});
