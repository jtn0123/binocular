import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, mono, radius, sp } from '@/theme';

/**
 * The §8.5 confirm, asked on the map.
 *
 * A drop that crosses shelves re-homes the bin — the same `shelf_id` update
 * as scanning a shelf label — so it asks first, exactly as the blueprint's
 * move mode does. It is a sheet rather than an `Alert` because the answer
 * depends on things a two-line alert cannot show: where the bin is coming
 * from, which slot it is going to, and whether the destination is already
 * full.
 *
 * The last line is the one field testing asked for. The printed label on the
 * bin does not change when it moves — the label carries an id, not an address
 * — and people reasonably assume otherwise.
 */
export interface MoveConfirmRequest {
  code: string;
  name: string;
  from: string;
  to: string;
  /** 1-based, for a human. */
  slot: number;
  /** Destination capacity when the drop would exceed it. */
  overCapacity: number | null;
  destination: string;
}

export function MoveConfirmSheet({
  request,
  onConfirm,
  onCancel,
}: {
  request: MoveConfirmRequest | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      visible={request !== null}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Cancel the move" />
      {request ? (
        <View style={styles.sheet} testID="map-move-confirm">
          <View style={styles.grabber} />
          <Text style={styles.title}>Re-home this bin?</Text>

          <View style={styles.binRow}>
            <Text style={styles.code}>{request.code}</Text>
            <Text style={styles.name} numberOfLines={2}>
              {request.name}
            </Text>
          </View>

          <View style={styles.route}>
            <Text style={styles.from} numberOfLines={1}>
              {request.from}
            </Text>
            <Ionicons name="arrow-forward" size={15} color={colors.textFaint} />
            <Text style={styles.to} numberOfLines={2}>
              {request.to}, slot {request.slot}
            </Text>
          </View>

          {request.overCapacity !== null ? (
            <View style={styles.warn}>
              <Ionicons name="warning-outline" size={15} color={colors.danger} />
              <Text style={styles.warnText}>
                {request.destination} only has {slotLabel(request.overCapacity)}. It will still take
                the bin — the shelf just reads over.
              </Text>
            </View>
          ) : null}

          <Text style={styles.note}>
            This is a filing change — the printed label on the bin does not change. Reprint it from
            the bin screen.
          </Text>

          <View style={styles.buttons}>
            <Pressable
              style={styles.cancel}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel the move"
              testID="map-move-cancel"
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.confirm}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel="Move it"
              testID="map-move-confirm-go"
            >
              <Text style={styles.confirmLabel}>Move it</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

/** A one-slot shelf reads "only has 1 slot", not "1 slots". */
function slotLabel(slots: number): string {
  return `${slots} slot${slots === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.64)' },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: sp(5),
    paddingTop: sp(4.5),
    paddingBottom: sp(6.5),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: sp(2.5),
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  binRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2.5), marginTop: sp(3) },
  code: {
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 12,
    color: colors.amberInkOn,
    backgroundColor: colors.amber,
    borderRadius: 4,
    paddingHorizontal: sp(2),
    paddingVertical: sp(1),
  },
  name: { flex: 1, color: colors.text, fontSize: 14 },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
    marginTop: sp(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2.5),
  },
  from: { color: colors.textDim, fontFamily: mono, fontSize: 12, flexShrink: 1 },
  to: { flex: 1, color: colors.amber, fontFamily: mono, fontSize: 12 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: sp(2), marginTop: sp(2) },
  warnText: { flex: 1, color: colors.danger, fontSize: 11.5, lineHeight: 16 },
  note: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, marginTop: sp(2) },
  buttons: { flexDirection: 'row', gap: sp(2.5), marginTop: sp(4) },
  cancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: sp(3.5),
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
  cancelLabel: { color: colors.textDim, fontSize: 14, fontWeight: '700' },
  confirm: {
    flex: 1.4,
    alignItems: 'center',
    paddingVertical: sp(3.5),
    backgroundColor: colors.amber,
    borderRadius: radius.md,
  },
  confirmLabel: { color: colors.amberInkOn, fontSize: 14, fontWeight: '800' },
});
