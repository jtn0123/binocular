import * as Haptics from 'expo-haptics';

/**
 * Best-effort haptics (dogfood find): on builds without the native module
 * (or devices without a vibrator) the expo-haptics promise REJECTS, and a
 * bare `void` call surfaces an "Uncaught (in promise)" error over the UI.
 * Feedback is a garnish — it must never be able to break a flow.
 */
export function hapticShutter(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function hapticSuccess(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticWarning(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
