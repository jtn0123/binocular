import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDb } from '@/db/DbProvider';
import { getBin, listLocations, listShelves, moveBinToShelf } from '@/db/queries';
import { logEvent } from '@/diagnostics/events';
import { hapticSuccess } from '@/lib/haptics';
import { colors, radius, sp, type } from '@/theme';

/**
 * Move mode destination picker (blueprint §8.5): pick a shelf from the
 * tree, or jump to the label scanner. An optional locationId param
 * pre-filters to one location (set when a location QR was scanned).
 */
export default function MoveBinScreen() {
  const { binId, locationId } = useLocalSearchParams<{ binId: string; locationId?: string }>();
  const db = useDb();
  const router = useRouter();

  const bin = binId ? getBin(db, binId) : null;
  if (!bin) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>Bin not found.</Text>
      </View>
    );
  }

  const locations = listLocations(db).filter((l) => !locationId || l.id === locationId);

  /**
   * §8.5 is explicit that a move is confirmed — its acceptance criterion is
   * "two scans + one confirm" — and this screen committed on the first tap.
   * The same operation on the map asks first, gives haptic feedback, offers a
   * six-second undo and records an `organize` event; here an accidental brush
   * against a shelf name re-filed a bin with no confirmation, no undo and no
   * trace, then navigated away from the evidence. One verb, one behaviour.
   */
  function moveTo(shelfId: string | null, shelfName: string) {
    if (!bin) return;
    const commit = () => {
      moveBinToShelf(db, bin.id, shelfId);
      logEvent(db, {
        kind: 'organize',
        name: 'bin_moved',
        detail: { bin: bin.short_code, to: shelfName, via: 'move_picker' },
      });
      hapticSuccess();
      router.replace({ pathname: '/bin/[id]', params: { id: bin.id } });
    };
    Alert.alert('Move bin?', `Move ${bin.short_code} to ${shelfName}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move', onPress: commit },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: `Move ${bin.short_code}` }} />
      <Text style={styles.subtitle}>
        Where does {bin.short_code} · {bin.name} live now?
      </Text>

      <Pressable
        style={styles.scanButton}
        onPress={() => router.replace({ pathname: '/scan-code', params: { binId: bin.id } })}
      >
        <Ionicons name="qr-code" size={18} color={colors.amberInkOn} />
        <Text style={styles.scanLabel}>Scan a shelf label</Text>
      </Pressable>

      {locations.map((location) => (
        <View key={location.id} style={styles.location}>
          <Text style={styles.locationName}>{location.name}</Text>
          {listShelves(db, location.id).map((shelf) => (
            <Pressable
              key={shelf.id}
              style={[styles.shelfRow, shelf.id === bin.shelf_id && styles.shelfCurrent]}
              onPress={() => moveTo(shelf.id, `${location.name} › ${shelf.name}`)}
              testID={`move-to-${shelf.id}`}
            >
              <Text style={styles.shelfName}>{shelf.name}</Text>
              {shelf.id === bin.shelf_id && <Text style={styles.currentTag}>current</Text>}
            </Pressable>
          ))}
        </View>
      ))}

      <Pressable
        style={styles.unassign}
        onPress={() => moveTo(null, 'no shelf at all')}
        accessibilityRole="button"
        accessibilityLabel={`Take ${bin.short_code} off its shelf`}
        testID="move-unassign"
      >
        <Text style={styles.unassignLabel}>Unassign (no shelf)</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: sp(4), gap: sp(3.5), paddingBottom: sp(10), backgroundColor: colors.bg, flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  subtitle: { ...type.dim, fontSize: 15 },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(2),
    backgroundColor: colors.amber,
    padding: sp(3.25),
    borderRadius: radius.lg,
  },
  scanLabel: { color: colors.amberInkOn, fontWeight: '800' },
  location: { gap: sp(1) },
  locationName: { ...type.h2, marginBottom: 2 },
  shelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: sp(3.25),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginLeft: sp(2),
    marginBottom: sp(1.5),
  },
  shelfCurrent: { opacity: 0.55, borderStyle: 'dashed' },
  shelfName: { ...type.body, fontWeight: '600' },
  currentTag: { fontSize: 11, color: colors.textFaint },
  unassign: { alignItems: 'center', padding: sp(2.5) },
  unassignLabel: { color: colors.textFaint },
  dim: { ...type.dim },
});
