import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CodeTag } from '@/components/CodeTag';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useDb } from '@/db/DbProvider';
import { countAttentionScans, listRecentBins } from '@/db/queries';
import { quickCreateBin } from '@/db/scaffold';
import { useFocusTick } from '@/lib/useFocusTick';
import { colors, radius, sp, type } from '@/theme';

/**
 * Scan entry point: mode picker (only bin audit in Stage 1 — check-in and
 * find-it arrive in Stage 3), then a manual bin picker. QR is never the
 * only path.
 */
export default function ScanScreen() {
  const db = useDb();
  const router = useRouter();
  useFocusTick();
  // D18 "Next bin" from the camera lands straight in the picker rather than
  // making the user re-tap Audit bin between every bin on a shelf.
  const params = useLocalSearchParams<{ pick?: string }>();
  const [picking, setPicking] = useState(params.pick === '1');
  const bins = listRecentBins(db, 100);

  if (picking) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Scan" />
        <View style={styles.container}>
        <Text style={styles.title}>Which bin are you auditing?</Text>
        <FlatList
          data={bins}
          keyExtractor={(bin) => bin.id}
          contentContainerStyle={{ gap: 2 }}
          ListEmptyComponent={
            <Text style={styles.hint}>No bins yet — create one below and start auditing.</Text>
          }
          ListFooterComponent={
            <Pressable
              style={styles.createRow}
              accessibilityRole="button"
              accessibilityLabel="Create a new bin and audit it"
              onPress={() => {
                const created = quickCreateBin(db);
                setPicking(false);
                router.push({ pathname: '/capture', params: { binId: created.id } });
              }}
            >
              <Ionicons name="add" size={16} color={colors.steel} />
              <Text style={styles.createLabel}>Create a new bin and audit it</Text>
            </Pressable>
          }
          renderItem={({ item: bin }) => (
            <Pressable
              style={styles.binRow}
              onPress={() => {
                setPicking(false);
                router.push({ pathname: '/capture', params: { binId: bin.id } });
              }}
            >
              <CodeTag code={bin.short_code} small />
              <Text style={styles.binName} numberOfLines={1}>
                {bin.name}
              </Text>
            </Pressable>
          )}
        />
        <Pressable style={styles.secondaryButton} onPress={() => setPicking(false)}>
          <Text style={styles.secondaryLabel}>Back</Text>
        </Pressable>
        </View>
      </View>
    );
  }

  const pending = countAttentionScans(db);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Scan" />
      <View style={styles.container}>
      {pending > 0 && (
        <Pressable style={styles.queueBanner} onPress={() => router.push('/queue')}>
          <Ionicons name="albums" size={16} color={colors.amber} />
          <Text style={styles.queueLabel}>
            {pending} scan{pending === 1 ? '' : 's'} in the queue
          </Text>
          <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
        </Pressable>
      )}
      <Text style={styles.title}>What do you want to do?</Text>
      <Pressable
        accessibilityRole="button"
        style={styles.mode}
        onPress={() => router.push({ pathname: '/capture', params: { mode: 'check_in' } })}
      >
        <View style={styles.modeIcon}>
          <Ionicons name="download" size={24} color={colors.amber} />
        </View>
        <View style={styles.modeMain}>
          <Text style={styles.modeTitle}>Check in items</Text>
          <Text style={styles.modeBody}>Photograph new items, then pick their bin</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.mode} onPress={() => setPicking(true)}>
        <View style={styles.modeIcon}>
          <Ionicons name="file-tray" size={24} color={colors.amber} />
        </View>
        <View style={styles.modeMain}>
          <Text style={styles.modeTitle}>Audit bin</Text>
          <Text style={styles.modeBody}>Photograph an open bin and catalog its contents</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.mode}
        onPress={() => router.push({ pathname: '/capture', params: { mode: 'find_it' } })}
      >
        <View style={styles.modeIcon}>
          <Ionicons name="search" size={24} color={colors.amber} />
        </View>
        <View style={styles.modeMain}>
          <Text style={styles.modeTitle}>Find an item</Text>
          <Text style={styles.modeBody}>Photograph it and see which bin it lives in</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.mode} onPress={() => router.push('/scan-code')}>
        <View style={styles.modeIcon}>
          <Ionicons name="qr-code" size={22} color={colors.amber} />
        </View>
        <View style={styles.modeMain}>
          <Text style={styles.modeTitle}>Scan a label</Text>
          <Text style={styles.modeBody}>Point at a bin or shelf label to jump to it</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: sp(4), paddingBottom: sp(4), gap: sp(3) },
  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
    backgroundColor: colors.chipSelectedBg,
    borderWidth: 1,
    borderColor: colors.chipSelectedBorder,
    borderRadius: radius.md,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2.5),
  },
  queueLabel: { color: colors.text, fontWeight: '600', fontSize: 13, flex: 1 },
  title: { ...type.h2, marginBottom: sp(1) },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3.5),
    padding: sp(4),
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeDisabled: { opacity: 0.55 },
  modeIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeMain: { flex: 1 },
  modeTitle: { ...type.h2 },
  modeTitleDisabled: { ...type.h2, color: colors.textDim },
  modeBody: { ...type.dim, marginTop: 2 },
  binRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    paddingVertical: sp(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  binName: { ...type.body, flex: 1 },
  hint: { ...type.dim, paddingVertical: sp(6), textAlign: 'center' },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: sp(3),
  },
  createLabel: { color: colors.steel, fontWeight: '600' },
  secondaryButton: { alignItems: 'center', padding: sp(3) },
  secondaryLabel: { color: colors.steel, fontWeight: '600' },
});
