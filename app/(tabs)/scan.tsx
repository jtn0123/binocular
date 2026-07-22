import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { listRecentBins } from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';

/**
 * Scan entry point: mode picker (only bin audit in Stage 1 — check-in and
 * find-it arrive in Stage 3), then a manual bin picker. QR is Stage 2 and
 * must never be the only path anyway.
 */
export default function ScanScreen() {
  const db = useDb();
  const router = useRouter();
  useFocusTick();
  const [picking, setPicking] = useState(false);
  const bins = listRecentBins(db, 100);

  if (picking) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Which bin are you auditing?</Text>
        <FlatList
          data={bins}
          keyExtractor={(bin) => bin.id}
          ListEmptyComponent={
            <Text style={styles.hint}>No bins yet — create one in Browse (Stage 2).</Text>
          }
          renderItem={({ item: bin }) => (
            <Pressable
              style={styles.binRow}
              onPress={() => {
                setPicking(false);
                router.push({ pathname: '/capture', params: { binId: bin.id } });
              }}
            >
              <Text style={styles.binCode}>{bin.short_code}</Text>
              <Text style={styles.binName}>{bin.name}</Text>
            </Pressable>
          )}
        />
        <Pressable style={styles.secondaryButton} onPress={() => setPicking(false)}>
          <Text style={styles.secondaryLabel}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What do you want to do?</Text>
      <Pressable style={styles.mode} onPress={() => setPicking(true)}>
        <Ionicons name="file-tray" size={28} color="#208AEF" />
        <View style={styles.modeMain}>
          <Text style={styles.modeTitle}>Audit bin</Text>
          <Text style={styles.modeBody}>Photograph an open bin and catalog its contents</Text>
        </View>
      </Pressable>
      <View style={[styles.mode, styles.modeDisabled]}>
        <Ionicons name="download" size={28} color="#999" />
        <View style={styles.modeMain}>
          <Text style={styles.modeTitleDisabled}>Check in items</Text>
          <Text style={styles.modeBody}>Arrives in Stage 3</Text>
        </View>
      </View>
      <View style={[styles.mode, styles.modeDisabled]}>
        <Ionicons name="search" size={28} color="#999" />
        <View style={styles.modeMain}>
          <Text style={styles.modeTitleDisabled}>Find an item</Text>
          <Text style={styles.modeBody}>Arrives in Stage 3</Text>
        </View>
      </View>
      <Pressable style={styles.mode} onPress={() => router.push('/scan-code')}>
        <Ionicons name="qr-code" size={28} color="#208AEF" />
        <View style={styles.modeMain}>
          <Text style={styles.modeTitle}>Scan a label</Text>
          <Text style={styles.modeBody}>Point at a bin or shelf label to jump to it</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#f2f7fd',
  },
  modeDisabled: { backgroundColor: '#f4f4f4' },
  modeMain: { flex: 1 },
  modeTitle: { fontSize: 17, fontWeight: '600' },
  modeTitleDisabled: { fontSize: 17, fontWeight: '600', color: '#999' },
  modeBody: { color: '#777', marginTop: 2 },
  binRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  binCode: { fontVariant: ['tabular-nums'], fontWeight: '600', color: '#208AEF' },
  binName: { fontSize: 16, flexShrink: 1 },
  hint: { color: '#888', paddingVertical: 24, textAlign: 'center' },
  secondaryButton: { alignItems: 'center', padding: 12 },
  secondaryLabel: { color: '#208AEF', fontWeight: '600' },
});
