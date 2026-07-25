import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, sp, type } from '@/theme';

/**
 * Look at a photo full screen.
 *
 * Field report: "if I tap on an image inside the bin it should open it".
 * It did not — the bin cover was wired to /bin-photo, which is the *camera*
 * for replacing it. Tapping a picture to see it bigger is the one thing
 * everybody expects a picture to do, and instead it offered to overwrite it.
 *
 * Deliberately read-only and dumb: a uri in, an image out. Nothing here can
 * change or delete anything.
 */
export default function PhotoScreen() {
  const { uri, title } = useLocalSearchParams<{ uri: string; title?: string }>();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: title || 'Photo', headerShown: false }} />
      {uri ? (
        <Image source={{ uri }} style={styles.photo} contentFit="contain" transition={120} />
      ) : (
        <Text style={styles.missing}>That photo is no longer on this phone.</Text>
      )}
      <Pressable
        style={styles.close}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Close photo"
        testID="close-photo"
        hitSlop={12}
      >
        <Ionicons name="close" size={26} color={colors.text} />
      </Pressable>
      {title ? <Text style={styles.caption}>{title}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  photo: { flex: 1, width: '100%' },
  missing: { ...type.dim, textAlign: 'center', padding: sp(6) },
  close: {
    position: 'absolute',
    top: sp(6),
    right: sp(4),
    backgroundColor: '#0009',
    borderRadius: 999,
    padding: sp(2),
  },
  caption: {
    position: 'absolute',
    bottom: sp(6),
    alignSelf: 'center',
    color: colors.text,
    backgroundColor: '#0009',
    paddingHorizontal: sp(3),
    paddingVertical: sp(1.5),
    borderRadius: 999,
    fontSize: 13,
  },
});
