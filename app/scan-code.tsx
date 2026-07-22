import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin, getLocation, getShelf, moveBinToShelf } from '@/db/queries';
import { parseQrPayload } from '@/qr/payload';
import { colors } from '@/theme';

/**
 * Label scanner (blueprint Stage 2). Two modes:
 *  - default: scanning any Binocular label navigates to it
 *  - pick-shelf (params: binId): scanning a shelf label re-homes that bin
 *    (§8.5); a location label prompts to pick a shelf within it.
 * Foreign QR codes get a friendly error, throttled so the camera doesn't
 * spam alerts while pointed at the same code.
 */
export default function ScanCodeScreen() {
  const { binId, forScanId } = useLocalSearchParams<{ binId?: string; forScanId?: string }>();
  const db = useDb();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const lockRef = useRef(false);

  const movingBin = binId ? getBin(db, binId) : null;

  function unlockSoon() {
    setTimeout(() => {
      lockRef.current = false;
    }, 1500);
  }

  function handleScanned(raw: string) {
    if (lockRef.current) return;
    lockRef.current = true;

    const payload = parseQrPayload(raw);
    if (!payload) {
      Alert.alert('Not a Binocular label', 'This QR code is not one of ours.', [
        { text: 'OK', onPress: unlockSoon },
      ]);
      return;
    }

    if (movingBin) {
      if (payload.type === 'shelf') {
        const shelf = getShelf(db, payload.id);
        if (!shelf) {
          Alert.alert('Unknown shelf', 'This label points at a shelf that no longer exists.', [
            { text: 'OK', onPress: unlockSoon },
          ]);
          return;
        }
        moveBinToShelf(db, movingBin.id, shelf.id);
        router.replace({ pathname: '/bin/[id]', params: { id: movingBin.id } });
        return;
      }
      if (payload.type === 'location') {
        const location = getLocation(db, payload.id);
        Alert.alert(
          location ? `${location.name} is a location` : 'Location label',
          'Pick a shelf within it from the list instead.',
          [
            {
              text: 'Pick shelf',
              onPress: () =>
                router.replace({
                  pathname: '/move/[binId]',
                  params: { binId: movingBin.id, locationId: payload.id },
                }),
            },
            { text: 'Keep scanning', onPress: unlockSoon },
          ],
        );
        return;
      }
      Alert.alert('That is a bin label', 'Scan a shelf label to choose the destination.', [
        { text: 'OK', onPress: unlockSoon },
      ]);
      return;
    }

    if (payload.type === 'bin') {
      const bin = getBin(db, payload.id);
      if (!bin) {
        Alert.alert('Unknown bin', 'This label points at a bin that no longer exists.', [
          { text: 'OK', onPress: unlockSoon },
        ]);
        return;
      }
      if (forScanId) {
        // Check-in destination pick: hand the bin back to the review screen.
        router.replace({
          pathname: '/review/[scanId]',
          params: { scanId: forScanId, destBinId: bin.id },
        });
        return;
      }
      router.replace({ pathname: '/bin/[id]', params: { id: bin.id } });
      return;
    }
    // Shelf/location labels: land on Browse.
    router.replace('/browse');
  }

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Scan label' }} />
        <Text style={styles.permissionText}>Binocular needs the camera to scan labels.</Text>
        <Pressable style={styles.grantButton} onPress={requestPermission}>
          <Text style={styles.grantLabel}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => handleScanned(data)}
      />
      <View style={styles.overlayTop}>
        <Text style={styles.hint}>
          {movingBin
            ? `Scan the destination shelf label for ${movingBin.short_code}`
            : forScanId
              ? 'Scan the destination bin label'
              : 'Point at a Binocular label'}
        </Text>
      </View>
      <View style={styles.overlayBottom}>
        <Pressable style={styles.cancel} onPress={() => router.back()}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: colors.bg },
  camera: { flex: 1 },
  overlayTop: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' },
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
  overlayBottom: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
  cancel: { padding: 10 },
  cancelLabel: { color: '#fff', fontSize: 16 },
  permissionText: { fontSize: 16, textAlign: 'center', color: colors.textDim },
  grantButton: {
    backgroundColor: colors.amber,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  grantLabel: { color: colors.amberInkOn, fontWeight: '700' },
});
