import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { countAttentionScans } from '@/db/queries';
import { deviceContext } from '@/diagnostics/context';
import { exportDiagnosticsZip } from '@/diagnostics/bundle';
import { loadDiagnosticsEnabled, setDiagnosticsEnabled } from '@/diagnostics/enabled';
import {
  clearEvents,
  countEvents,
  countEventsOfKind,
  listEvents,
  MAX_AGE_DAYS,
  MAX_EVENTS,
  type EventRow,
} from '@/diagnostics/events';
import { colors, radius, sp, type } from '@/theme';

/**
 * On-device diagnostics (blueprint D16) — so a problem in the workshop can be
 * spotted without exporting anything, and shared in one tap when it can't.
 */
const KIND_COLOR: Record<string, string> = {
  crash: colors.danger,
  scan: colors.amber,
  queue: colors.steel,
};

function EventLine({ event }: { event: EventRow }) {
  const time = event.created_at.slice(11, 19);
  const color = KIND_COLOR[event.kind] ?? colors.textFaint;
  return (
    <View style={styles.eventRow}>
      <Text style={styles.eventTime}>{time}</Text>
      <Text style={[styles.eventKind, { color }]} numberOfLines={1}>
        {event.kind}
      </Text>
      <View style={styles.eventMain}>
        <Text style={styles.eventName} numberOfLines={1}>
          {event.name}
          {event.duration_ms != null ? `  ${event.duration_ms}ms` : ''}
        </Text>
        {event.detail ? (
          <Text style={styles.eventDetail} numberOfLines={2}>
            {event.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function DiagnosticsScreen() {
  const db = useDb();
  const [enabled, setEnabled] = useState(true);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadDiagnosticsEnabled().then(setEnabled);
  }, []);

  const ctx = deviceContext();
  const events = listEvents(db, 200);
  const total = countEvents(db);
  const crashes = countEventsOfKind(db, 'crash');
  const attention = countAttentionScans(db);
  void tick;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, crashes > 0 && { color: colors.danger }]}>{crashes}</Text>
          <Text style={styles.statLabel}>crashes</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{total}</Text>
          <Text style={styles.statLabel}>events</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{attention}</Text>
          <Text style={styles.statLabel}>scans need attention</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Build</Text>
      <View style={styles.card}>
        <Text style={styles.mono}>
          {ctx.appName} {ctx.appVersion} · {ctx.isDev ? 'dev' : 'release'}
        </Text>
        <Text style={styles.mono}>
          {ctx.platform} {ctx.osVersion}
        </Text>
        <Text style={styles.mono}>
          network: {ctx.networkType}
          {ctx.networkConnected === false ? ' (offline)' : ''}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Recording</Text>
      <View style={styles.toggleRow}>
        <View style={styles.toggleMain}>
          <Text style={styles.toggleLabel}>Log events on this device</Text>
          <Text style={styles.hint}>
            Kept local, capped at {MAX_EVENTS.toLocaleString('en-US')} events / {MAX_AGE_DAYS} days.
            Nothing is uploaded.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={async (next) => {
            setEnabled(next);
            await setDiagnosticsEnabled(next);
            setTick((t) => t + 1);
          }}
          trackColor={{ true: colors.amber, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.primaryButton, busy && styles.disabled]}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Share diagnostics"
          onPress={async () => {
            setBusy(true);
            try {
              await exportDiagnosticsZip(db);
            } catch (err) {
              Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Text style={styles.primaryLabel}>Share diagnostics</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Clear event log"
          onPress={() =>
            Alert.alert('Clear the event log?', 'Scans and inventory are not affected.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear',
                style: 'destructive',
                onPress: () => {
                  clearEvents(db);
                  setTick((t) => t + 1);
                },
              },
            ])
          }
        >
          <Text style={styles.secondaryLabel}>Clear log</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Recent events</Text>
      {events.length === 0 ? (
        <Text style={styles.hint}>
          Nothing recorded yet. Use the app for a moment and come back.
        </Text>
      ) : (
        <View style={styles.card}>
          {events.map((e) => (
            <EventLine key={e.id} event={e} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: sp(4), paddingBottom: sp(12), gap: sp(3), backgroundColor: colors.bg, flexGrow: 1 },
  sectionTitle: { ...type.stamp, marginTop: sp(2) },
  hint: { ...type.dim, lineHeight: 18 },
  statRow: { flexDirection: 'row', gap: sp(2.5) },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: sp(3),
    gap: 2,
  },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { ...type.dim, fontSize: 11 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: sp(3),
    gap: sp(1.5),
  },
  mono: { color: colors.steel, fontFamily: 'monospace', fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  toggleMain: { flex: 1, gap: 2 },
  toggleLabel: { color: colors.text, fontWeight: '600', fontSize: 15 },
  buttonRow: { flexDirection: 'row', gap: sp(2.5) },
  primaryButton: {
    backgroundColor: colors.amber,
    paddingHorizontal: sp(4.5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  primaryLabel: { color: colors.amberInkOn, fontWeight: '700' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: sp(4.5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  secondaryLabel: { color: colors.steel, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  eventRow: { flexDirection: 'row', gap: sp(2), alignItems: 'flex-start' },
  eventTime: { fontFamily: 'monospace', fontSize: 11, color: colors.textFaint, width: 58 },
  eventKind: { fontFamily: 'monospace', fontSize: 11, width: 56 },
  eventMain: { flex: 1 },
  eventName: { color: colors.text, fontSize: 13 },
  eventDetail: { ...type.dim, fontSize: 11 },
});
