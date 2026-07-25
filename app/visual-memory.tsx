import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { listCandidates, listEmbeddedItems } from '@/db/embeddingQueries';
import {
  BUCKET,
  calibrate,
  FLOOR,
  pairsNear,
  summarise,
  type CalibrationItem,
} from '@/diagnostics/memoryCalibration';
import { colors, radius, sp, type } from '@/theme';
import { DEFAULT_MIN_SCORE, getEmbedder } from '@/vision/visualMemory';

/**
 * Match strength (blueprint D20 + D16).
 *
 * Two questions on one screen: is visual memory working at all, and where
 * should its cutoff sit. Both are answered from vectors already stored — no
 * camera, no network, nothing to photograph.
 *
 * Its own route rather than another card on Diagnostics: the work is O(N²)
 * and should run when asked for, not every time that screen is opened.
 *
 * This is the surface §11 invariant 2 exempts, so raw scores are shown here.
 * Nowhere that describes inventory does the same.
 */
const PLOT_HEIGHT = 168;
const THUMB = 34;

export default function VisualMemoryScreen() {
  const db = useDb();
  const model = getEmbedder()?.model ?? null;

  // Computed once per mount. Deliberately not recomputed as the line moves —
  // dragging must stay smooth, and only the summary depends on the threshold.
  const { calibration, byId } = useMemo(() => {
    if (!model) return { calibration: null, byId: new Map<string, ReturnType<typeof listEmbeddedItems>[number]>() };
    const meta = listEmbeddedItems(db, model);
    const bins = new Map(meta.map((m) => [m.id, m.bin_id]));
    const items: CalibrationItem[] = listCandidates(db, model).map((c) => ({
      ...c,
      binId: bins.get(c.itemId) ?? null,
    }));
    return { calibration: calibrate(items), byId: new Map(meta.map((m) => [m.id, m])) };
  }, [db, model]);

  const [threshold, setThreshold] = useState(DEFAULT_MIN_SCORE);
  const [plotWidth, setPlotWidth] = useState(0);

  const onPlotLayout = (e: LayoutChangeEvent) => setPlotWidth(e.nativeEvent.layout.width);

  // PanResponder is core React Native — a drag handle here needs no new
  // dependency, and the gesture is one axis with no competing scroll.
  // Rebuilt when the plot is measured, so the closure never maps a touch
  // against a stale width; plain state rather than a ref keeps it out of
  // render-time reads.
  const pan = useMemo(() => {
    const moveTo = (x: number) => {
      if (plotWidth <= 0) return;
      const ratio = Math.max(0, Math.min(1, x / plotWidth));
      // Snapped to the bucket grid: a threshold finer than the histogram
      // would imply a precision the data does not have.
      const raw = FLOOR + ratio * (1 - FLOOR);
      setThreshold(Math.round(raw / BUCKET) * BUCKET);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => moveTo(e.nativeEvent.locationX),
      onPanResponderMove: (e) => moveTo(e.nativeEvent.locationX),
    });
  }, [plotWidth]);

  if (!model || !calibration) {
    return (
      <ScrollView contentContainerStyle={styles.center}>
        <Text style={styles.dim}>
          No recognizer loaded, so there is nothing to measure. Download it in Settings → Visual
          memory, let it work through your items, then come back.
        </Text>
      </ScrollView>
    );
  }

  const { buckets, pairs, best, compared, total, comparisons } = calibration;
  const judged = buckets.reduce((n, b) => n + b.same + b.other, 0);
  const summary = summarise(buckets, threshold);
  const near = pairsNear(pairs, threshold);
  const peak = Math.max(1, ...buckets.map((b) => b.same + b.other));
  const at = (score: number) => ((score - FLOOR) / (1 - FLOOR)) * plotWidth;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.stamp}>Match strength</Text>
      <Text style={styles.hint}>
        Every pair of your remembered items, scored against each other. Drag the line to see what
        each cutoff would keep.
      </Text>

      {judged === 0 ? (
        <View style={styles.card}>
          <Text style={styles.dim}>
            {compared < 2
              ? 'Only one item is remembered so far — there are no pairs to compare yet.'
              : 'Nothing scored high enough to be worth comparing. Either the photos are very different from each other, or the encoder is not earning its keep here.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.plot} onLayout={onPlotLayout} {...pan.panHandlers}>
              {buckets.map((b) => (
                <View key={b.from} style={styles.column}>
                  <View
                    style={[styles.seg, { height: (b.other / peak) * PLOT_HEIGHT, backgroundColor: colors.steel, opacity: 0.72 }]}
                  />
                  <View
                    style={[styles.seg, { height: (b.same / peak) * PLOT_HEIGHT, backgroundColor: colors.ok }]}
                  />
                </View>
              ))}
              {best !== null && plotWidth > 0 ? (
                <View style={[styles.best, { left: at(best) }]} pointerEvents="none" />
              ) : null}
              {plotWidth > 0 ? (
                <View style={[styles.line, { left: at(threshold) }]} pointerEvents="none" />
              ) : null}
            </View>
            <View style={styles.axis}>
              <Text style={styles.tick}>{FLOOR.toFixed(2)}</Text>
              <Text style={styles.tick}>1.00</Text>
            </View>

            <Text style={styles.big}>
              {summary.percent === null ? '—' : `${summary.percent}%`}
              <Text style={styles.bigUnit}>{summary.percent === null ? ' nothing shown' : ' right'}</Text>
            </Text>
            <Text style={styles.readout} testID="calibration-readout">
              at {threshold.toFixed(2)} · {summary.shown} shown · {summary.missed} good ones missed
            </Text>
            {best !== null ? (
              <Text style={styles.readout}>
                best cutoff for your photos: <Text style={styles.bestText}>{best.toFixed(2)}</Text>
                {'  '}(now {DEFAULT_MIN_SCORE.toFixed(2)})
              </Text>
            ) : null}

            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: colors.ok }]} />
                <Text style={styles.tick}>same bin</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: colors.steel, opacity: 0.72 }]} />
                <Text style={styles.tick}>different bin</Text>
              </View>
            </View>
          </View>

          <Text style={styles.stamp}>At this line</Text>
          {near.map((pair) => {
            const a = byId.get(pair.a);
            const b = byId.get(pair.b);
            const kept = pair.score >= threshold;
            const edge = !kept ? colors.border : pair.sameBin ? colors.ok : colors.danger;
            return (
              <View key={`${pair.a}-${pair.b}`} style={[styles.pair, { borderLeftColor: edge }, !kept && styles.dropped]}>
                <View style={styles.thumbs}>
                  <Thumb uri={a?.photo_uri ?? null} />
                  <Thumb uri={b?.photo_uri ?? null} />
                </View>
                <View style={styles.pairMain}>
                  <Text style={styles.pairName} numberOfLines={1}>
                    {a?.name ?? 'Unknown'}
                  </Text>
                  <Text style={styles.pairSub} numberOfLines={1}>
                    {b?.name ?? 'Unknown'}
                    {a?.bin_code ? ` · ${a.bin_code}` : ''}
                    {b?.bin_code && b.bin_code !== a?.bin_code ? ` / ${b.bin_code}` : ''}
                  </Text>
                </View>
                <View>
                  <Text style={[styles.score, { color: edge === colors.border ? colors.textFaint : edge }]}>
                    {pair.score.toFixed(2)}
                  </Text>
                  <Text style={styles.verdict}>
                    {!kept ? 'DROPPED' : pair.sameBin ? 'SAME BIN' : 'WRONG BIN'}
                  </Text>
                </View>
              </View>
            );
          })}
        </>
      )}

      <Text style={styles.foot}>
        {compared} of {total} remembered items compared
        {compared < total ? ' (sampled — a big workshop is not compared exhaustively)' : ''} ·{' '}
        {comparisons.toLocaleString('en-US')} comparisons · {judged} pairs scored above{' '}
        {FLOOR.toFixed(2)}.
      </Text>
      <Text style={styles.foot}>
        Pairs in the same bin are treated as the ones that should match. That is a stand-in for
        correct, not proof of it — two unrelated things can share a bin.
      </Text>
    </ScrollView>
  );
}

function Thumb({ uri }: { uri: string | null }) {
  if (!uri) return <View style={[styles.thumb, styles.thumbEmpty]} />;
  return <Image source={{ uri }} style={styles.thumb} contentFit="cover" />;
}

const styles = StyleSheet.create({
  container: { padding: sp(4), paddingBottom: sp(12), gap: sp(2.5), backgroundColor: colors.bg, flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', padding: sp(6), backgroundColor: colors.bg },
  stamp: { ...type.stamp, marginTop: sp(2) },
  hint: { ...type.dim, lineHeight: 19 },
  dim: { ...type.dim, lineHeight: 20, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: sp(3),
  },
  plot: { height: PLOT_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  column: { flex: 1, justifyContent: 'flex-end' },
  seg: { borderRadius: 1 },
  line: { position: 'absolute', top: -4, bottom: 0, width: 2, backgroundColor: colors.amber },
  best: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.ok, opacity: 0.55 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: sp(1) },
  tick: { color: colors.textFaint, fontFamily: 'monospace', fontSize: 10 },
  big: { color: colors.text, fontSize: 30, fontWeight: '700', marginTop: sp(2.5), fontVariant: ['tabular-nums'] },
  bigUnit: { color: colors.textFaint, fontSize: 13, fontWeight: '400' },
  readout: { color: colors.textDim, fontFamily: 'monospace', fontSize: 12, marginTop: 3 },
  bestText: { color: colors.ok },
  legend: { flexDirection: 'row', gap: sp(4), marginTop: sp(2.5) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  pair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: sp(2),
  },
  dropped: { opacity: 0.45 },
  thumbs: { flexDirection: 'row', gap: 3 },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  thumbEmpty: { borderWidth: 1, borderColor: colors.border },
  pairMain: { flex: 1, minWidth: 0 },
  pairName: { color: colors.text, fontSize: 13 },
  pairSub: { color: colors.textFaint, fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  score: { fontFamily: 'monospace', fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] },
  verdict: { color: colors.textFaint, fontFamily: 'monospace', fontSize: 8, textAlign: 'right', marginTop: 1 },
  foot: { ...type.dim, fontSize: 11, lineHeight: 16, marginTop: sp(1) },
});
