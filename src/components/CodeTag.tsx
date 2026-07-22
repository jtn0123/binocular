import { StyleSheet, Text, View } from 'react-native';

import { colors, mono, radius } from '../theme';

/**
 * The app's signature mark: a bin short code rendered as a label-maker
 * tag — amber strip, punched-hole notch, monospace stamp.
 */
export function CodeTag({ code, small }: { code: string; small?: boolean }) {
  return (
    <View style={[styles.tag, small && styles.tagSmall]}>
      <View style={styles.hole} />
      <Text style={[styles.code, small && styles.codeSmall]} numberOfLines={1}>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.amber,
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  tagSmall: { paddingVertical: 2, paddingHorizontal: 6 },
  hole: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.amberInkOn,
    opacity: 0.55,
  },
  code: {
    fontFamily: mono,
    fontWeight: '700',
    fontSize: 13,
    color: colors.amberInkOn,
    letterSpacing: 0.5,
  },
  codeSmall: { fontSize: 11 },
});
