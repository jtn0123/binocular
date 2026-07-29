import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RackEdge, WindowFrame } from '@/map/useMapDrag';
import { colors, mono, sp } from '@/theme';

/**
 * The way off this rack, on either side of the wall (v3).
 *
 * At rest it is a thin tab that pages one rack along — the equivalent of
 * walking sideways. With a bin in hand it widens and says SEND: release on it
 * and the bin goes to the rack that way, which is the move you make when you
 * decide something lives at the other end of the garage. Resting on it pages
 * the wall under you with the bin still in hand, so a rack three along is
 * reachable without putting anything down.
 *
 * It reports its own position on the glass because that is the space the
 * gesture speaks: `onLayout` would only give a position relative to whichever
 * nested view happens to be its parent.
 */
export function RackRail({
  side,
  code,
  more,
  carrying,
  hot,
  onPress,
  onFrame,
}: Readonly<{
  side: RackEdge;
  /** Short code of the rack immediately that way. */
  code: string;
  /** True when there is more than one rack that way — the label gets a "+". */
  more: boolean;
  /** A bin is in hand, by hold or by drag. */
  carrying: boolean;
  /** The finger is over this rail right now. */
  hot: boolean;
  onPress: () => void;
  onFrame: (frame: WindowFrame | null) => void;
}>) {
  const ref = useRef<View | null>(null);

  const report = () => {
    if (!carrying) {
      onFrame(null);
      return;
    }
    ref.current?.measureInWindow((x, y, width, height) => onFrame({ x, y, width, height }));
  };

  // A window frame outlives the view that reported it: paging the wall
  // unmounts this rail, and without this the band of screen it occupied
  // keeps catching drops on the next rack.
  useEffect(() => {
    const forget = onFrame;
    return () => forget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = more ? `${code}+` : code;

  // Named rather than inlined: what the chevron is doing and what it will do
  // are two different questions, and reading them as one nested expression
  // was the thing that made this rail hard to change.
  const chevronTone = hot ? colors.amberInkOn : carrying ? colors.amber : colors.textDim;
  const spokenLabel = carrying
    ? `Send this bin to rack ${code}${more ? ' or further along' : ''}`
    : `Go to rack ${code}`;

  return (
    <Pressable
      ref={ref}
      onLayout={report}
      onPress={onPress}
      style={[
        styles.rail,
        side === 'prev' ? styles.prev : styles.next,
        carrying && styles.armed,
        carrying && (side === 'prev' ? styles.armedPrev : styles.armedNext),
        hot && styles.hot,
        hot && (side === 'prev' ? styles.hotPrev : styles.hotNext),
      ]}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      testID={`map-rail-${side}`}
    >
      <Ionicons
        name={side === 'prev' ? 'chevron-back' : 'chevron-forward'}
        size={carrying ? 15 : 11}
        color={chevronTone}
      />
      {carrying ? (
        <Text style={[styles.send, hot && styles.inkOn]} numberOfLines={1}>
          SEND
        </Text>
      ) : null}
      <Text
        style={[styles.code, carrying && styles.codeArmed, hot && styles.inkOn]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    top: '50%',
    marginTop: -70,
    height: 140,
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp(1),
    backgroundColor: '#14171B',
    borderWidth: 1,
    borderColor: '#23272B',
    // Restated: `armed` is dashed, and Android keeps a dashed border until a
    // later style explicitly makes it solid again (see BinCard).
    borderStyle: 'solid',
    zIndex: 5,
  },
  prev: { left: 0, borderLeftWidth: 0, borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  next: { right: 0, borderRightWidth: 0, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  armed: {
    width: 34,
    height: 200,
    marginTop: -100,
    backgroundColor: 'rgba(58,53,36,0.94)',
    borderColor: colors.chipSelectedBorder,
    borderStyle: 'dashed',
    gap: sp(1.75),
    zIndex: 8,
  },
  armedPrev: { borderTopRightRadius: 10, borderBottomRightRadius: 10 },
  armedNext: { borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  hot: {
    width: 44,
    backgroundColor: colors.amber,
    borderColor: colors.amber,
    borderStyle: 'solid',
    borderWidth: 2,
  },
  hotPrev: { borderLeftWidth: 0 },
  hotNext: { borderRightWidth: 0 },
  // Stacked rather than rotated: React Native has no writing-mode, and a
  // transformed label mis-measures inside a fixed-width rail.
  send: {
    color: colors.chipSelectedBorder,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  code: { color: colors.textFaint, fontFamily: mono, fontWeight: '700', fontSize: 8 },
  codeArmed: { color: colors.amber, fontSize: 9 },
  inkOn: { color: colors.amberInkOn },
});
