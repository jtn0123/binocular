import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin } from '@/db/queries';
import { enqueueBinAuditScan, processScan } from '@/scan/scanFlow';

export default function CaptureScreen() {
  const { binId } = useLocalSearchParams<{ binId: string }>();
  const db = useDb();
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState<'idle' | 'capturing' | 'recognizing'>('idle');

  const bin = binId ? getBin(db, binId) : null;

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
    if (!cameraRef.current || !binId || busy !== 'idle') return;
    setBusy('capturing');
    try {
      const photo = await cameraRef.current.takePictureAsync();
      // Photo persisted + scan row queued first — a kill or network loss
      // after this point can never lose the capture (blueprint §8.1 AC).
      const scanId = enqueueBinAuditScan(db, { binId, tempPhotoUri: photo.uri });
      setBusy('recognizing');
      const result = await processScan(db, scanId);
      if (result.outcome === 'review') {
        router.replace({ pathname: '/review/[scanId]', params: { scanId } });
        return;
      }
      if (result.outcome === 'queued') {
        Alert.alert(
          'Saved to queue',
          'No connection right now — the photo is saved and will be recognized when you retry from the review screen.',
          [{ text: 'OK', onPress: () => router.replace({ pathname: '/review/[scanId]', params: { scanId } }) }],
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
        <Text style={styles.hint}>Fill the frame with the open bin</Text>
        {bin ? (
          <Text style={styles.binLabel}>
            {bin.short_code} · {bin.name}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
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
  },
  binLabel: {
    color: '#fff',
    backgroundColor: 'rgba(32,138,239,0.75)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    overflow: 'hidden',
    fontSize: 13,
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
  permissionText: { fontSize: 16, textAlign: 'center', color: '#444' },
  shutterAlt: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  shutterAltLabel: { color: '#fff', fontWeight: '600' },
});
