import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { colors } from '../theme';

/**
 * Bin thumbnail with a graceful fallback chain (field-test ask): the audit
 * cover photo if one exists, else a collage of the photos its items were
 * cataloged from (1 = full frame, 2+ = grid), else the tray icon.
 */
export function BinThumb({
  coverUri,
  itemPhotoUris,
  size,
  radius: borderRadius,
}: {
  coverUri: string | null;
  itemPhotoUris: string[];
  size: number;
  radius: number;
}) {
  const box = { width: size, height: size, borderRadius };
  if (coverUri) {
    return <Image source={{ uri: coverUri }} style={[styles.base, box]} contentFit="cover" />;
  }
  const photos = itemPhotoUris.slice(0, 4);
  if (photos.length === 1) {
    return (
      <Image
        source={{ uri: photos[0] }}
        style={[styles.base, box]}
        contentFit="cover"
        testID="bin-thumb-single"
      />
    );
  }
  if (photos.length > 1) {
    const cell = size / 2 - 1;
    return (
      <View style={[styles.base, styles.grid, box]} testID="bin-thumb-collage">
        {photos.map((uri, i) => (
          <Image
            key={`${uri}-${i}`}
            source={{ uri }}
            style={{ width: photos.length === 2 ? size / 2 - 1 : cell, height: photos.length === 2 ? size : cell }}
            contentFit="cover"
          />
        ))}
      </View>
    );
  }
  return (
    <View style={[styles.base, styles.empty, box]} testID="bin-thumb-empty">
      <Ionicons name="file-tray" size={Math.max(16, size * 0.34)} color={colors.textFaint} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  empty: { alignItems: 'center', justifyContent: 'center' },
});
