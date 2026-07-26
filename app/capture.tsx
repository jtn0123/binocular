import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin, type ScanMode } from '@/db/queries';
import { logEvent } from '@/diagnostics/events';
import { hapticShutter } from '@/lib/haptics';
import { getScanQueue } from '@/queue/scanQueue';
import {
  DEFAULT_CAPTURE_FLOW,
  flowForMode,
  needsPreview,
  supportsKeepShooting,
  type CaptureFlow,
} from '@/scan/captureMode';
import { enqueueScan, processScan } from '@/scan/scanFlow';
import {
  DEFAULT_CAPTURE_PREFS,
  loadCapturePrefs,
  normalizeZoom,
  saveCapturePrefs,
} from '@/settings/capturePrefs';
import { getProviderChoice, type ProviderChoice } from '@/settings/settings';
import { colors } from '@/theme';
import { estimateScanCost, formatUsd } from '@/vision/cost';

interface PendingPhoto {
  uri: string;
  width: number;
  height: number;
}

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
  // Workshops are dim and bins are deep — torch and zoom are the two
  // controls that decide whether a photo is readable at all.
  // Persisted between scans (capturePrefs): re-arming the torch for every bin
  // on a shelf was the single most repeated action in the field test.
  const [torch, setTorch] = useState(DEFAULT_CAPTURE_PREFS.torch);
  const [zoom, setZoom] = useState(DEFAULT_CAPTURE_PREFS.zoom);
  const stepZoom = (delta: number) => setZoom((z) => normalizeZoom(z + delta));
  // D18: keep the camera up and let the queue recognize in the background, so
  // a shelf can be photographed in one pass. Session-scoped count, because
  // what matters here is "how many did I just shoot", not the queue depth.
  const [flowPref, setFlowPref] = useState<CaptureFlow>(DEFAULT_CAPTURE_FLOW);
  const [shotCount, setShotCount] = useState(0);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // A frame taken but not yet committed to a scan (cloud engines only).
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const canKeepShooting = supportsKeepShooting(mode);
  const confirmBeforeSending = needsPreview(engine);

  useEffect(() => {
    getProviderChoice().then(setEngine, () => setEngine(null));
  }, []);

  /**
   * Set once the user has walked away from this camera.
   *
   * Recognition cannot be called off — the request is in flight and the photo
   * is already durable — but the *navigation* absolutely can. Pressing Cancel
   * (or hardware back) during "Recognizing…" used to leave `processScan`
   * running, and its `router.replace` then fired seconds later, dragging the
   * user into a review screen for a scan they had abandoned. The scan still
   * lands in the queue and is reviewable from there; it just no longer
   * hijacks whatever they moved on to.
   */
  const abandoned = useRef(false);
  useEffect(
    () => () => {
      abandoned.current = true;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    loadCapturePrefs().then((prefs) => {
      if (cancelled) return;
      setTorch(prefs.torch);
      setZoom(prefs.zoom);
      setFlowPref(prefs.flow);
      setPrefsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Write-back only after the load has landed, so the initial defaults can't
  // race ahead and overwrite what was stored.
  useEffect(() => {
    if (!prefsLoaded) return;
    void saveCapturePrefs({ torch, zoom, flow: flowPref });
  }, [prefsLoaded, torch, zoom, flowPref]);
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
      const shot = { uri: photo.uri, width: photo.width, height: photo.height };
      if (confirmBeforeSending) {
        // A blurry frame on a cloud engine costs real money and a round trip
        // for a useless answer. The photo is not a scan yet — it becomes one
        // (durably) only when accepted below.
        setPending(shot);
        setBusy('idle');
        return;
      }
      await submit(shot);
    } catch (err) {
      Alert.alert('Capture failed', err instanceof Error ? err.message : String(err), [
        { text: 'OK', onPress: () => setBusy('idle') },
      ]);
    } finally {
      setBusy((b) => (b === 'capturing' ? 'idle' : b));
    }
  }

  async function submit(shot: PendingPhoto) {
    const flow = flowForMode(mode, flowPref);
    setPending(null);
    setBusy('capturing');
    try {
      // Photo persisted + scan row queued first — a kill or network loss
      // after this point can never lose the capture (blueprint §8.1 AC).
      const scanId = enqueueScan(db, {
        mode,
        binId: params.binId ?? null,
        tempPhotoUri: shot.uri,
      });
      // D16: so a dark or badly framed photo is explainable after the fact.
      logEvent(db, {
        kind: 'scan',
        name: 'capture_settings',
        scanId,
        detail: { torch, zoom, mode, width: shot.width, height: shot.height, flow },
      });

      if (flow === 'keep_shooting') {
        // D18: the scan is already durable (enqueueScan wrote photo + row);
        // hand it to the §9 drain loop and leave the camera up. Nothing
        // reaches inventory without its own review-screen save.
        setShotCount((n) => n + 1);
        setBusy('idle');
        void getScanQueue()?.drain();
        return;
      }

      setBusy('recognizing');
      const result = await processScan(db, scanId);
      // Walked away while it was thinking: the scan is saved and reviewable
      // from the queue, but nothing here gets to move them.
      if (abandoned.current) return;
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
      Alert.alert('Scan failed', err instanceof Error ? err.message : String(err), [
        { text: 'OK', onPress: () => setBusy('idle') },
      ]);
      return;
    } finally {
      setBusy((b) => (b === 'capturing' ? 'idle' : b));
    }
  }

  if (pending) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <Image source={{ uri: pending.uri }} style={styles.preview} contentFit="contain" />
        <View style={styles.overlayTop}>
          <Text style={styles.hint}>Sharp enough to read the labels?</Text>
          {estimate ? (
            <Text style={styles.costPill}>
              ≈ {formatUsd(estimate.usd)} · {engine === 'openai' ? 'OpenAI' : 'Claude'}
            </Text>
          ) : null}
        </View>
        <View style={styles.overlayBottom}>
          <View style={styles.previewRow}>
            <Pressable
              style={styles.previewSecondary}
              onPress={() => setPending(null)}
              accessibilityRole="button"
              accessibilityLabel="Discard this photo and take another"
              testID="preview-retake"
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.previewSecondaryLabel}>Retake</Text>
            </Pressable>
            <Pressable
              style={styles.previewPrimary}
              onPress={() => void submit(pending)}
              accessibilityRole="button"
              accessibilityLabel="Use this photo"
              testID="preview-use"
            >
              <Ionicons name="checkmark" size={18} color={colors.amberInkOn} />
              <Text style={styles.previewPrimaryLabel}>Use photo</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        enableTorch={torch}
        zoom={zoom}
      />
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
        {engine === 'fixture' ? (
          <Text style={styles.costPill} testID="demo-engine-pill">
            Demo engine · canned results — pick a real engine in Settings
          </Text>
        ) : null}
        {shotCount > 0 ? (
          <Pressable
            onPress={() => router.replace('/queue')}
            accessibilityRole="button"
            accessibilityLabel={`${shotCount} scan${shotCount === 1 ? '' : 's'} shot, open the queue to review`}
            testID="shot-count-pill"
          >
            <Text style={styles.queuedPill}>
              {shotCount} shot · recognizing in background — tap to review
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.overlayBottom}>
        {busy === 'idle' && (
          <View style={styles.controlRow}>
            <Pressable
              style={[styles.control, torch && styles.controlOn]}
              onPress={() => setTorch((t) => !t)}
              accessibilityRole="button"
              accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
              accessibilityState={{ selected: torch }}
              testID="torch-toggle"
            >
              <Ionicons
                name={torch ? 'flashlight' : 'flashlight-outline'}
                size={20}
                color={torch ? colors.amberInkOn : '#fff'}
              />
            </Pressable>

            <View style={styles.zoomGroup}>
              <Pressable
                style={styles.zoomButton}
                onPress={() => stepZoom(-0.1)}
                disabled={zoom <= 0}
                accessibilityRole="button"
                accessibilityLabel="Zoom out"
                testID="zoom-out"
              >
                <Ionicons name="remove" size={18} color={zoom <= 0 ? '#666' : '#fff'} />
              </Pressable>
              <Text style={styles.zoomLabel} testID="zoom-level">
                {zoom === 0 ? 'zoom' : `${Math.round(zoom * 100)}%`}
              </Text>
              <Pressable
                style={styles.zoomButton}
                onPress={() => stepZoom(0.1)}
                disabled={zoom >= 1}
                accessibilityRole="button"
                accessibilityLabel="Zoom in"
                testID="zoom-in"
              >
                <Ionicons name="add" size={18} color={zoom >= 1 ? '#666' : '#fff'} />
              </Pressable>
            </View>

            {canKeepShooting ? (
              <Pressable
                style={[styles.control, flowPref === 'keep_shooting' && styles.controlOn]}
                onPress={() =>
                  setFlowPref((f) => (f === 'keep_shooting' ? 'review_now' : 'keep_shooting'))
                }
                accessibilityRole="button"
                accessibilityLabel={
                  flowPref === 'keep_shooting'
                    ? 'Keep shooting is on — review later from the queue'
                    : 'Keep shooting is off — review each photo straight away'
                }
                accessibilityState={{ selected: flowPref === 'keep_shooting' }}
                testID="keep-shooting-toggle"
              >
                <Ionicons
                  name={flowPref === 'keep_shooting' ? 'layers' : 'layers-outline'}
                  size={20}
                  color={flowPref === 'keep_shooting' ? colors.amberInkOn : '#fff'}
                />
              </Pressable>
            ) : null}
          </View>
        )}
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
        <View style={styles.footerRow}>
          {mode === 'bin_audit' && flowPref === 'keep_shooting' && busy === 'idle' ? (
            <Pressable
              style={styles.cancel}
              onPress={() => router.replace({ pathname: '/(tabs)/scan', params: { pick: '1' } })}
              accessibilityRole="button"
              accessibilityLabel="Move on to the next bin"
              testID="next-bin"
            >
              <Text style={styles.nextBinLabel}>Next bin →</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.cancel}
            onPress={() => {
              abandoned.current = true;
              router.back();
            }}
            accessibilityRole="button"
            accessibilityLabel={shotCount > 0 ? 'Done photographing' : 'Cancel'}
            testID="capture-cancel"
          >
            <Text style={styles.cancelLabel}>{shotCount > 0 ? 'Done' : 'Cancel'}</Text>
          </Pressable>
        </View>
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
  preview: { flex: 1, backgroundColor: '#000' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  previewSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  previewSecondaryLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  previewPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: colors.amber,
  },
  previewPrimaryLabel: { color: colors.amberInkOn, fontSize: 15, fontWeight: '700' },
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
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 4,
  },
  control: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  controlOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  zoomGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 4,
  },
  zoomButton: {
    width: 38,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: {
    color: '#fff',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    textAlign: 'center',
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
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  cancel: { padding: 8 },
  cancelLabel: { color: '#fff', fontSize: 15 },
  nextBinLabel: { color: colors.amber, fontSize: 15, fontWeight: '700' },
  queuedPill: {
    color: colors.amberInkOn,
    backgroundColor: 'rgba(255,196,0,0.9)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '700',
  },
  permissionText: { fontSize: 16, textAlign: 'center', color: colors.textDim },
  shutterAlt: {
    backgroundColor: colors.amber,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  shutterAltLabel: { color: colors.amberInkOn, fontWeight: '700' },
});
