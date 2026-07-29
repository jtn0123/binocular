import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, sp, type } from '../theme';

/**
 * The camera permission gate, shared by every screen that needs a camera.
 *
 * All three screens used to render their own version, and all three called
 * `requestPermission` unconditionally. On Android the system dialog only
 * appears while `canAskAgain` is true: after the second denial the OS stops
 * showing it, so the Grant button became permanently inert with no
 * explanation. Since capture, label scanning and bin covers are all behind
 * it, two taps of "Deny" disabled every photo path in the app for good — the
 * only way back being Android's own app-settings screen, which nothing
 * mentioned.
 *
 * So the button changes job when asking stops working: it opens the settings
 * page instead, and the text says what to look for once you are there.
 */
export function CameraGate({
  /** What the camera is for, as a phrase: "to photograph bins". */
  reason,
  canAskAgain,
  onRequest,
}: {
  reason: string;
  canAskAgain: boolean;
  onRequest: () => void;
}) {
  return (
    <View style={styles.center} testID="camera-gate">
      <Text style={styles.text}>Binocular needs the camera {reason}.</Text>
      {canAskAgain ? (
        <Pressable
          style={styles.button}
          onPress={onRequest}
          accessibilityRole="button"
          accessibilityLabel="Grant camera access"
          testID="camera-grant"
        >
          <Text style={styles.buttonLabel}>Grant camera access</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.hint}>
            Android will not ask again — the permission has to be switched back on by hand, under
            Permissions › Camera.
          </Text>
          <Pressable
            style={styles.button}
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            accessibilityLabel="Open app settings"
            testID="camera-open-settings"
          >
            <Text style={styles.buttonLabel}>Open app settings</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(4),
    padding: sp(6),
    backgroundColor: colors.bg,
  },
  text: { fontSize: 16, textAlign: 'center', color: colors.textDim },
  hint: { ...type.dim, textAlign: 'center', lineHeight: 20 },
  button: {
    backgroundColor: colors.amber,
    paddingHorizontal: sp(5),
    paddingVertical: sp(3),
    borderRadius: radius.md,
  },
  buttonLabel: { color: colors.amberInkOn, fontWeight: '700' },
});
