import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { CameraGate } from '@/components/CameraGate';
import { useDb } from '@/db/DbProvider';
import { getBin, setBinCoverPhoto } from '@/db/queries';
import { hapticShutter } from '@/lib/haptics';
import { persistPhoto } from '@/scan/photos';
import { colors } from '@/theme';

/**
 * Take a picture OF the bin itself (field-test ask): becomes the bin's
 * cover/icon everywhere, taking precedence over the item collage. No
 * recognition runs — this is just a photo.
 */
export default function BinPhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  const bin = id ? getBin(db, id) : null;

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <>
        <Stack.Screen options={{ title: 'Bin photo' }} />
        <CameraGate
          reason="to photograph the bin"
          canAskAgain={permission.canAskAgain}
          onRequest={() => void requestPermission()}
        />
      </>
    );
  }

  async function capture() {
    if (!cameraRef.current || busy || !bin) return;
    setBusy(true);
    hapticShutter();
    try {
      const photo = await cameraRef.current.takePictureAsync();
      const stored = persistPhoto(photo.uri, `cover-${bin.id}`, bin.cover_photo_uri);
      setBinCoverPhoto(db, bin.id, stored);
      router.back();
    } catch (err) {
      Alert.alert('Photo failed', err instanceof Error ? err.message : String(err), [
        { text: 'OK', onPress: () => setBusy(false) },
      ]);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={styles.overlayTop}>
        <Text style={styles.hint}>
          Photograph the bin itself — this becomes its cover picture
        </Text>
        {bin ? (
          <Text style={styles.binLabel}>
            {bin.short_code} · {bin.name}
          </Text>
        ) : null}
      </View>
      <View style={styles.overlayBottom}>
        <Pressable
          style={[styles.shutter, busy && styles.shutterDisabled]}
          onPress={capture}
          accessibilityLabel="Take bin photo"
        />
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
  cancel: { padding: 8 },
  cancelLabel: { color: '#fff', fontSize: 15 },
  permissionText: { fontSize: 16, textAlign: 'center', color: colors.textDim },
  grant: {
    backgroundColor: colors.amber,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  grantLabel: { color: colors.amberInkOn, fontWeight: '700' },
});
