import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CodeTag } from '@/components/CodeTag';
import { useDb } from '@/db/DbProvider';
import { getScan, updateScanStatus } from '@/db/queries';
import { nowIso } from '@/lib/time';
import { searchItems } from '@/search/fts';
import { colors, radius, sp, type } from '@/theme';
import { RecognitionResult } from '@/vision/types';
import { isVisualMemoryAvailable, recall, type Recollection } from '@/vision/visualMemory';

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

  // D20: visual memory answers "which of mine looks like this?" without a
  // network, which is what lets this screen mean something in airplane mode.
  const photoUri = scan?.photo_uri ?? null;
  const [recalled, setRecalled] = useState<Recollection[] | null>(null);
  useEffect(() => {
    // No encoder or no photo means nothing to recall; leaving the state
    // untouched (rather than clearing it here) keeps this effect free of a
    // synchronous setState, which is both a lint rule and a re-render.
    if (!photoUri || !isVisualMemoryAvailable()) return;
    let cancelled = false;
    void recall(db, photoUri).then(
      (hits) => {
        if (!cancelled) setRecalled(hits);
      },
      () => {
        if (!cancelled) setRecalled([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, photoUri]);

  const openBin = (binId: string | null) => {
    if (binId) router.push({ pathname: '/bin/[id]', params: { id: binId } });
  };

  /** Ranked by resemblance; deliberately no score shown (D5/D20). */
  const recalledRows = (
    <>
      {(recalled ?? []).map((hit) => (
        <Pressable key={hit.itemId} style={styles.resultRow} onPress={() => openBin(hit.binId)}>
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="sparkles-outline" size={18} color={colors.textFaint} />
          </View>
          <View style={styles.resultMain}>
            <Text style={styles.resultName} numberOfLines={1}>
              {hit.quantity > 1 ? `${hit.quantity}× ` : ''}
              {hit.name}
            </Text>
            <View style={styles.crumbRow}>
              {hit.binCode ? <CodeTag code={hit.binCode} small /> : null}
              <Text style={styles.crumb} numberOfLines={1}>
                {[hit.binName, hit.shelfName, hit.locationName].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Pressable>
      ))}
    </>
  );

  if (!scan || (scan.status !== 'review' && scan.status !== 'confirmed')) {
    // Not recognized — but visual memory may still know what this resembles,
    // which is the difference between a useful screen and a dead end offline.
    const hasRecall = (recalled?.length ?? 0) > 0;
    return (
      <ScrollView contentContainerStyle={hasRecall ? styles.container : styles.center}>
        <Stack.Screen options={{ title: 'Find it' }} />
        {hasRecall ? (
          <>
            <Text style={styles.stamp}>Not recognized — but this looks like</Text>
            {recalledRows}
            <Text style={styles.dim}>
              Matched against your own items on this phone. Recognition itself needs a connection.
            </Text>
          </>
        ) : (
          <Text style={styles.dim}>
            {!scan
              ? 'Scan not found.'
              : isVisualMemoryAvailable()
                ? 'Not recognized, and nothing you have catalogued looks like it — try text search.'
                : 'This photo has not been recognized — photo lookup needs a connection.'}
          </Text>
        )}
        <Pressable style={styles.primaryButton} onPress={() => router.back()}>
          <Text style={styles.primaryLabel}>Back</Text>
        </Pressable>
      </ScrollView>
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
          {results.length === 0 && (recalled?.length ?? 0) > 0 ? (
            <>
              <Text style={styles.stamp}>…but it looks like</Text>
              {recalledRows}
            </>
          ) : null}
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
