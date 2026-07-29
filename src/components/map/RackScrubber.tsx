import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { colors, mono, radius, sp } from '@/theme';

/**
 * The wall itself, as one strip along the bottom (v3).
 *
 * Every rack is a segment: its code, how full it is, and how many search hits
 * it holds. The rack you are on is the wide one — a scrubber rather than a
 * tab bar, because the thing being navigated is a physical run of shelving
 * and reading it left to right is how you would walk it.
 *
 * A rack with no room reads red *before* you try to drop into it, so neither
 * the rails nor the picker ever hands you a dead end.
 *
 * ## The segments share the width; they do not queue for it
 *
 * The strip is a flex row where the current rack takes twice the share of the
 * rest, so the whole wall is on screen at a glance — which is the only reason
 * to draw a wall-length strip at all. It scrolls, but only as the escape
 * hatch it is in the design: when enough racks hit their floor width that the
 * row genuinely cannot fit, not as the normal way to read it.
 *
 * The version before this made every segment its natural width in a scroller,
 * which meant the wall ran off the end at three racks and "+ RACK" had to be
 * pinned outside to stay reachable — where it sheared the last rack in half.
 */
/** Where a segment sits in the strip's content, as `onLayout` reports it. */
export interface Span {
  x: number;
  width: number;
}

/**
 * How far to scroll to bring a segment into view, or `null` to stay put.
 *
 * The nudge either way is deliberate: landing a chip flush against the edge of
 * the strip reads as "and that is the end of the wall", which it usually is
 * not. It is arithmetic rather than `scrollTo({ x: segment })` because the
 * cheap version re-centres the strip on every page, and a strip that moves
 * when it did not need to is a strip you cannot keep your place in.
 */
export function scrollTargetFor(
  span: Span | undefined,
  viewport: number,
  scrolled: number,
): number | null {
  if (!span || viewport <= 0) return null;
  const NUDGE = 8;
  if (span.x < scrolled) return Math.max(0, span.x - NUDGE);
  if (span.x + span.width > scrolled + viewport)
    return span.x + span.width - viewport + NUDGE;
  return null;
}

export interface RackSegment {
  key: string;
  code: string;
  label: string;
  /** "7/16". */
  fill: string;
  /** 0–1; how much of the segment's bar is filled. */
  ratio: number;
  /** Free slots left; Infinity when a shelf in it is unsized. */
  room: number;
  hits: number;
  current: boolean;
}

/** How full a rack reads at a glance: packed, tight, here, or elsewhere. */
function barTone(segment: RackSegment) {
  if (segment.room === 0) return styles.barFull;
  if (segment.room <= 2) return styles.barTight;
  return segment.current ? styles.barOn : styles.barOff;
}

export function RackScrubber({
  segments,
  editing,
  onGo,
  onOpenWall,
  onAddRack,
}: Readonly<{
  segments: readonly RackSegment[];
  editing: boolean;
  onGo: (index: number) => void;
  onOpenWall: () => void;
  onAddRack: () => void;
}>) {
  const scroller = useRef<ScrollView>(null);
  /** Where each segment sits in the content, for scrolling one into view. */
  const spans = useRef(new Map<number, { x: number; width: number }>());
  const viewport = useRef(0);
  const scrolled = useRef(0);
  const current = segments.findIndex((s) => s.current);

  /**
   * Keep the rack you are on, and the button that adds one, on screen.
   *
   * In the common case the row fits and none of this does anything. It earns
   * its keep on a long wall, where paging to R9 would otherwise leave the
   * strip showing R1–R4 and no sign of where you went.
   */
  useEffect(() => {
    // "+ RACK" trails the last rack, so arriving at the end of the wall has to
    // bring the button with it — otherwise adding a rack leaves you looking at
    // the rack you just made with the button that made it half off the screen.
    if (editing && current === segments.length - 1) {
      scroller.current?.scrollToEnd({ animated: true });
      return;
    }
    const x = scrollTargetFor(spans.current.get(current), viewport.current, scrolled.current);
    if (x !== null) scroller.current?.scrollTo({ x, animated: true });
  }, [current, editing, segments.length]);

  useEffect(() => {
    // "+ RACK" appears at the end of the row: entering edit mode should put it
    // where you can see it rather than making you go looking.
    if (editing) scroller.current?.scrollToEnd({ animated: true });
  }, [editing]);

  const onStripLayout = (e: LayoutChangeEvent) => {
    viewport.current = e.nativeEvent.layout.width;
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrolled.current = e.nativeEvent.contentOffset.x;
  };

  return (
    <View style={styles.strip}>
      <Pressable
        style={styles.grid}
        onPress={onOpenWall}
        accessibilityRole="button"
        accessibilityLabel="Show the whole wall"
        testID="map-wall-toggle"
      >
        <Ionicons name="grid-outline" size={13} color={colors.textDim} />
      </Pressable>

      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        // `flexGrow` is what makes this share rather than queue: the content
        // stretches to fill the strip when it fits — so the segments' own
        // `flex` divides up the real width — and only scrolls when it cannot.
        contentContainerStyle={styles.segments}
        onLayout={onStripLayout}
        onScroll={onScroll}
        scrollEventThrottle={32}
        testID="map-rack-strip"
      >
        {segments.map((segment, index) => (
          <Pressable
            key={segment.key}
            style={[styles.segment, segment.current && styles.segmentOn]}
            onLayout={(e: LayoutChangeEvent) =>
              spans.current.set(index, {
                x: e.nativeEvent.layout.x,
                width: e.nativeEvent.layout.width,
              })
            }
            onPress={() => onGo(index)}
            accessibilityRole="button"
            accessibilityState={{ selected: segment.current }}
            accessibilityLabel={`Rack ${segment.code}, ${segment.label}, ${segment.fill} full${
              segment.hits > 0 ? `, ${segment.hits} matching` : ''
            }`}
            testID={`map-rack-${segment.code}`}
          >
            <View style={styles.segmentHead}>
              <Text style={[styles.segCode, segment.current && styles.segCodeOn]}>
                {segment.code}
              </Text>
              {segment.current ? (
                <>
                  <Text style={styles.segName} numberOfLines={1}>
                    {segment.label}
                  </Text>
                  <Text style={styles.segFill}>{segment.fill}</Text>
                </>
              ) : null}
              {segment.hits > 0 ? (
                <View style={styles.hits}>
                  <Text style={styles.hitsText}>{segment.hits}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.bar,
                  { width: `${Math.round(Math.max(0, Math.min(1, segment.ratio)) * 100)}%` },
                  barTone(segment),
                ]}
              />
            </View>
          </Pressable>
        ))}

        {editing ? (
          <Pressable
            style={styles.addRack}
            onPress={onAddRack}
            accessibilityRole="button"
            accessibilityLabel="Add a rack to the wall"
            testID="map-add-rack"
          >
            <Ionicons name="add" size={11} color={colors.amberInkOn} />
            <Text style={styles.addRackLabel}>RACK</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1),
    height: 40,
    marginHorizontal: sp(4),
    marginBottom: sp(3),
    paddingHorizontal: sp(1.5),
    borderRadius: radius.pill,
    backgroundColor: '#0E1012',
    borderWidth: 1,
    borderColor: '#262A2F',
  },
  grid: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: '#22262B',
    borderWidth: 1,
    borderColor: '#3A4046',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  segments: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: sp(1) },
  segment: {
    // Share of the leftover width, with a floor it will not read below.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 40,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: '#22262B',
    borderWidth: 1,
    borderColor: '#3A4046',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  segmentOn: {
    // Double share: the rack you are on is the one that has to fit a name.
    flexGrow: 2,
    flexBasis: 'auto',
    minWidth: 132,
    height: 30,
    paddingHorizontal: sp(1.5),
    backgroundColor: 'rgba(255,196,0,0.09)',
    borderWidth: 2,
    borderColor: colors.amber,
  },
  segmentHead: { flexDirection: 'row', alignItems: 'center', gap: sp(1), maxWidth: '100%' },
  segCode: { color: colors.textDim, fontFamily: mono, fontSize: 8, letterSpacing: 0.5 },
  segCodeOn: { color: colors.amber, fontWeight: '700' },
  segName: {
    color: colors.text,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  segFill: { color: '#D8C97A', fontFamily: mono, fontSize: 9.5 },
  hits: {
    minWidth: 11,
    height: 11,
    borderRadius: 6,
    paddingHorizontal: 2,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hitsText: { color: colors.amberInkOn, fontFamily: mono, fontWeight: '800', fontSize: 7 },
  track: { width: '60%', height: 2, borderRadius: 1, backgroundColor: colors.border },
  bar: { height: 2, borderRadius: 1 },
  barOn: { backgroundColor: colors.amber },
  barOff: { backgroundColor: colors.textFaint },
  barTight: { backgroundColor: colors.warn },
  barFull: { backgroundColor: colors.danger },
  addRack: {
    // A command, not a place: it keeps its size while the racks give way.
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(1),
    height: 26,
    paddingHorizontal: sp(2.25),
    borderRadius: radius.pill,
    backgroundColor: colors.amber,
  },
  addRackLabel: {
    color: colors.amberInkOn,
    fontFamily: mono,
    fontWeight: '800',
    fontSize: 8,
    letterSpacing: 0.5,
  },
});
