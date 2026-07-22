import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CodeTag } from '@/components/CodeTag';
import { useDb } from '@/db/DbProvider';
import { getScan, updateScanStatus } from '@/db/queries';
import { nowIso } from '@/lib/time';
import { searchItems } from '@/search/fts';
import { colors, radius, sp, type } from '@/theme';
import { RecognitionResult } from '@/vision/types';

/**
 * Find-it photo path (blueprint §8.3): the model's best identification is
 * fed straight into the same FTS search, and matching bins are listed.
 */
export default function FindResultScreen() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  const db = useDb();
  const router = useRouter();

  const scan = scanId ? getScan(db, scanId) : null;

  function bestIdentification() {
    if (!scan?.raw_response) return null;
    try {
      const parsed = RecognitionResult.safeParse(JSON.parse(scan.raw_response));
      return parsed.success ? (parsed.data.items[0] ?? null) : null;
    } catch {
      return null;
    }
  }
  const best = bestIdentification();

  // The find scan is an audit-trail record, not a review queue entry —
  // settle it as soon as we have shown (or failed to show) a result.
  const scanRef = scan?.id ?? null;
  const scanStatus = scan?.status ?? null;
  useEffect(() => {
    if (scanRef && scanStatus === 'review') {
      updateScanStatus(db, scanRef, 'confirmed', { resolvedAt: nowIso() });
    }
  }, [db, scanRef, scanStatus]);

  const byName = best ? searchItems(db, best.name) : [];
  const results =
    byName.length > 0 ? byName : best?.label_text ? searchItems(db, best.label_text) : [];

  if (!scan || (scan.status !== 'review' && scan.status !== 'confirmed')) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Find it' }} />
        <Text style={styles.dim}>
          {scan
            ? 'This photo has not been recognized — photo lookup needs a connection.'
            : 'Scan not found.'}
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => router.back()}>
          <Text style={styles.primaryLabel}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Find it' }} />
      {best ? (
        <>
          <Text style={styles.stamp}>Looks like</Text>
          <Text style={styles.bestName}>
            {best.brand ? `${best.brand} ` : ''}
            {best.name}
          </Text>
          <Text style={styles.stamp}>
            {results.length > 0 ? 'Found in your workshop' : 'No matches in your bins'}
          </Text>
          {results.map((r) => (
            <Pressable
              key={r.itemId}
              style={styles.resultRow}
              onPress={() =>
                r.binId && router.push({ pathname: '/bin/[id]', params: { id: r.binId } })
              }
            >
              {r.binCoverUri ? (
                <Image source={{ uri: r.binCoverUri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Ionicons name="file-tray" size={18} color={colors.textFaint} />
                </View>
              )}
              <View style={styles.resultMain}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {r.quantity > 1 ? `${r.quantity}× ` : ''}
                  {r.name}
                </Text>
                <View style={styles.crumbRow}>
                  {r.binCode ? <CodeTag code={r.binCode} small /> : null}
                  <Text style={styles.crumb} numberOfLines={1}>
                    {[r.binName, r.shelfName, r.locationName].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          ))}
        </>
      ) : (
        <Text style={styles.dim}>The photo could not be identified.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: sp(4), gap: sp(3), backgroundColor: colors.bg, flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(4),
    padding: sp(6),
    backgroundColor: colors.bg,
  },
  stamp: { ...type.stamp, marginTop: sp(1) },
  bestName: { ...type.title },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: sp(2.5),
  },
  thumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceSunken },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  resultMain: { flex: 1, gap: 4 },
  resultName: { ...type.body, fontWeight: '600' },
  crumbRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  crumb: { ...type.dim, fontSize: 12, flexShrink: 1 },
  dim: { ...type.dim, textAlign: 'center' },
  primaryButton: {
    backgroundColor: colors.amber,
    paddingHorizontal: sp(5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  primaryLabel: { color: colors.amberInkOn, fontWeight: '700' },
});
