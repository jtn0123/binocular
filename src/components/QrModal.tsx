import qrcodegen from 'qrcode-generator';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BinRow } from '../db/queries';
import { encodeQrPayload } from '../qr/payload';
import { printLabelSheet } from '../qr/print';
import { colors, radius, sp, type } from '../theme';

/**
 * On-screen QR for a bin (field-test ask: tap a bin's thumbnail to see its
 * code). Rendered dependency-free: dark modules become per-row run Views.
 * Another phone can scan it straight off the screen; Print uses the normal
 * label sheet.
 */
function QrView({ data, size }: { data: string; size: number }) {
  const qr = qrcodegen(0, 'M');
  qr.addData(data);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / n;
  const rows: { y: number; runs: { x: number; len: number }[] }[] = [];
  for (let r = 0; r < n; r++) {
    const runs: { x: number; len: number }[] = [];
    let start = -1;
    for (let c = 0; c <= n; c++) {
      const dark = c < n && qr.isDark(r, c);
      if (dark && start < 0) start = c;
      if (!dark && start >= 0) {
        runs.push({ x: start, len: c - start });
        start = -1;
      }
    }
    if (runs.length > 0) rows.push({ y: r, runs });
  }
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff', padding: 0 }}>
      {rows.map((row) =>
        row.runs.map((run, i) => (
          <View
            key={`${row.y}-${i}`}
            style={{
              position: 'absolute',
              left: run.x * cell,
              top: row.y * cell,
              width: run.len * cell,
              height: cell + 0.5,
              backgroundColor: '#000',
            }}
          />
        )),
      )}
    </View>
  );
}

export function QrModal({ bin, onClose }: { bin: BinRow | null; onClose: () => void }) {
  return (
    <Modal visible={bin !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {bin && (
            <>
              <View style={styles.qrWrap}>
                <QrView data={encodeQrPayload({ type: 'bin', id: bin.id })} size={220} />
              </View>
              <Text style={styles.code}>{bin.short_code}</Text>
              <Text style={styles.name}>{bin.name}</Text>
              <View style={styles.actions}>
                <Pressable
                  onPress={async () => {
                    try {
                      await printLabelSheet([
                        {
                          payload: { type: 'bin', id: bin.id },
                          code: bin.short_code,
                          name: bin.name,
                        },
                      ]);
                    } catch (err) {
                      Alert.alert('Print failed', err instanceof Error ? err.message : String(err));
                    }
                  }}
                >
                  <Text style={styles.link}>Print label</Text>
                </Pressable>
                <Pressable onPress={onClose}>
                  <Text style={styles.link}>Close</Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: sp(5),
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    padding: sp(5),
    alignItems: 'center',
    gap: sp(2),
  },
  qrWrap: { padding: sp(3), backgroundColor: '#fff', borderRadius: radius.md },
  code: { ...type.h2, marginTop: sp(1) },
  name: { ...type.dim },
  actions: { flexDirection: 'row', gap: sp(6), marginTop: sp(2) },
  link: { color: colors.steel, fontWeight: '700' },
});
