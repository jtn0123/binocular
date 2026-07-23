import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin, type ScanMode } from '@/db/queries';
import { hapticShutter } from '@/lib/haptics';
import { enqueueScan, processScan } from '@/scan/scanFlow';
import { getProviderChoice, type ProviderChoice } from '@/settings/settings';
import { colors } from '@/theme';
import { estimateScanCost, formatUsd } from '@/vision/cost';

const HINTS: Record<ScanMode, string> = {
  bin_audit: 'Fill the frame with the open bin',
  check_in: 'Lay items on the bench — a cleaner background gives better results',
  find_it: 'Center the item you are looking for',
};

export default function CaptureScreen() {
  const params = useLocalSearchParams<{ binId?: string; mode?: string }>();
  const mode: ScanMode =
    params.mode === 'check_in' || params.mode === 'find_it' ? params.mode : 'bin_audit';
  const db = useDb();
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState<'idle' | 'capturing' | 'recognizing'>('idle');
  const [engine, setEngine] = useState<ProviderChoice | null>(null);

  useEffect(() => {
    getProviderChoice().then(setEngine, () => setEngine(null));
  }, []);
  // Pre-scan estimate (D15): cloud engines only — fixture/local are free.
  const estimate = engine === 'claude' || engine === 'openai' ? estimateScanCost(engine) : null;

  const bin = params.binId ? getBin(db, params.binId) : null;

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Camera' }} />
        <Text style={styles.permissionText}>Binocular needs the camera to photograph bins.</Text>
        <Pressable style={styles.shutterAlt} onPress={requestPermission}>
          <Text style={styles.shutterAltLabel}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  async function capture() {
    if (!cameraRef.current || busy !== 'idle') return;
    if (mode === 'bin_audit' && !params.binId) return;
    setBusy('capturing');
    hapticShutter();
    try {
      const photo = await cameraRef.current.takePictureAsync();
      // Photo persisted + scan row queued first — a kill or network loss
      // after this point can never lose the capture (blueprint §8.1 AC).
      const scanId = enqueueScan(db, {
        mode,
        binId: params.binId ?? null,
        tempPhotoUri: photo.uri,
      });
      setBusy('recognizing');
      const result = await processScan(db, scanId);
      const target =
        mode === 'find_it'
          ? ({ pathname: '/find/[scanId]', params: { scanId } } as const)
          : ({ pathname: '/review/[scanId]', params: { scanId } } as const);
      if (result.outcome === 'review') {
        router.replace(target);
        return;
      }
      if (result.outcome === 'queued') {
        if (mode === 'find_it') {
          Alert.alert(
            'Search needs a connection',
            'Photo lookup requires the cloud engine — try text search instead.',
            [{ text: 'OK', onPress: () => router.back() }],
          );
          return;
        }
        Alert.alert(
          'Saved to queue',
          'No connection right now — the photo is saved and will be recognized when you are back online.',
          [{ text: 'OK', onPress: () => router.replace(target) }],
        );
        return;
      }
      Alert.alert('Recognition failed', result.error ?? 'Unknown error', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert('Capture failed', err instanceof Error ? err.message : String(err), [
        { text: 'OK', onPress: () => setBusy('idle') },
      ]);
      return;
    } finally {
      setBusy((b) => (b === 'capturing' ? 'idle' : b));
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={styles.overlayTop}>
        <Text style={styles.hint}>{HINTS[mode]}</Text>
        {bin ? (
          <Text style={styles.binLabel}>
            {bin.short_code} · {bin.name}
          </Text>
        ) : null}
        {estimate ? (
          <Text style={styles.costPill} testID="capture-estimate">
            ≈ {formatUsd(estimate.usd)} per scan · {engine === 'openai' ? 'OpenAI' : 'Claude'}
          </Text>
        ) : null}
      </View>
      <View style={styles.overlayBottom}>
        {busy === 'recognizing' ? (
          <View style={styles.recognizing}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.recognizingLabel}>Recognizing…</Text>
          </View>
        ) : (
          <Pressable
            style={[styles.shutter, busy !== 'idle' && styles.shutterDisabled]}
            onPress={capture}
            accessibilityLabel="Take photo"
          />
        )}
        <Pressable style={styles.cancel} onPress={() => router.back()}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: colors.bg,
  },
  camera: { flex: 1 },
  overlayTop: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
  },
  hint: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
    fontSize: 15,
    textAlign: 'center',
    marginHorizontal: 24,
  },
  binLabel: {
    color: '#1A1500',
    fontWeight: '700',
    backgroundColor: 'rgba(255,196,0,0.85)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    overflow: 'hidden',
    fontSize: 13,
  },
  costPill: {
    color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
    fontSize: 12,
  },
  overlayBottom: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 16,
  },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#fff',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  shutterDisabled: { opacity: 0.4 },
  recognizing: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  recognizingLabel: { color: '#fff', fontSize: 16 },
  cancel: { padding: 8 },
  cancelLabel: { color: '#fff', fontSize: 15 },
  permissionText: { fontSize: 16, textAlign: 'center', color: colors.textDim },
  shutterAlt: {
    backgroundColor: colors.amber,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  shutterAltLabel: { color: colors.amberInkOn, fontWeight: '700' },
});
