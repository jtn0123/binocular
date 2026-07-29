import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

/**
 * Swiping sideways to walk along the wall.
 *
 * ## Why this is safe when the old drag was not
 *
 * The gesture layer that killed the process on the field phone wrapped
 * *every cell* in its own detector driving its own worklets — forty
 * detectors and forty animated nodes on a full wall (docs/PLAN.md,
 * "Map customization › Withdrawn"). This is one detector and one animated
 * node for the whole screen, raced against the drag's single detector. Two
 * total, fixed, regardless of how many bins are drawn.
 *
 * The race is unambiguous because the two gestures are recognised by
 * different evidence: the drag activates on a 400 ms hold that has not
 * moved, this activates on 24pt of horizontal travel that has not waited.
 * You cannot accidentally do both, which is what makes composing them
 * something other than a coin toss.
 *
 * It is also unambiguous *inside* the panel, in a way it would not have been
 * before v3: shelves no longer scroll sideways, so horizontal travel over
 * the wall means one thing and one thing only. `failOffsetY` hands anything
 * more vertical than horizontal to the panel's own scroll.
 */
/*
 * The arithmetic lives here, in the same file as the worklets that call it.
 *
 * It was briefly its own module, purely so it could be tested without pulling
 * in Reanimated. That is the wrong trade: a worklet capturing a function from
 * another module is the shape `npm run audit:worklets` exists to reject,
 * because on the UI runtime a captured non-worklet becomes a stub that only
 * throws — and release builds compile out the guard that would say so. This
 * codebase has already lost the map once to a worklet fault that only showed
 * up on a real device, so the version that cannot raise the question wins over
 * the version that is merely convenient to test.
 */
/** How far the panel follows the finger, as a fraction of the travel. */
const FOLLOW = 0.55;
/** …and never further than this, so the wall never leaves a gap behind it. */
const MAX_FOLLOW = 90;
/** Travel that commits to the next rack on release. */
const COMMIT = 60;
/** A flick commits early: past this the intent is clear before the distance is. */
const FLICK = 900;

/**
 * How far the panel has slid, for a given amount of finger.
 *
 * Dragging past the end of the wall is allowed but heavily damped, so the
 * panel answers "nothing that way" instead of pretending there is more wall
 * and then snapping back as if you had missed.
 */
export function followOffset(dx: number, canPrev: boolean, canNext: boolean): number {
  'worklet';
  const followed = dx * FOLLOW;
  const wall = (followed < 0 && !canNext) || (followed > 0 && !canPrev);
  const damped = wall ? followed * 0.25 : followed;
  return Math.max(-MAX_FOLLOW, Math.min(MAX_FOLLOW, damped));
}

/**
 * Which way the release means, if any: -1 left, +1 right, 0 stay.
 *
 * Distance *or* speed, because a deliberate short flick and a slow long haul
 * are both people saying "next" — and requiring both would make the wall feel
 * like it was ignoring one of them.
 */
export function swipeVerdict({
  dx,
  vx,
  canPrev,
  canNext,
}: {
  dx: number;
  vx: number;
  canPrev: boolean;
  canNext: boolean;
}): -1 | 0 | 1 {
  'worklet';
  if ((dx <= -COMMIT || vx < -FLICK) && canNext) return 1;
  if ((dx >= COMMIT || vx > FLICK) && canPrev) return -1;
  return 0;
}

export interface RackSwipe {
  pan: ReturnType<typeof Gesture.Pan>;
  /** Panel offset, for the one Animated.View this hook drives. */
  offset: SharedValue<number>;
}

export function useRackSwipe({
  enabled,
  canPrev,
  canNext,
  onPage,
}: {
  /** Off while a bin is in hand — the rails are how you travel carrying one. */
  enabled: boolean;
  canPrev: boolean;
  canNext: boolean;
  /** -1 for the rack to the left, +1 for the right. */
  onPage: (direction: -1 | 1) => void;
}): RackSwipe {
  const offset = useSharedValue(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        // Horizontal intent only; anything steeper belongs to the scroll.
        .activeOffsetX([-24, 24])
        .failOffsetY([-24, 24])
        .onUpdate((e) => {
          offset.value = followOffset(e.translationX, canPrev, canNext);
        })
        .onEnd((e) => {
          const verdict = swipeVerdict({
            dx: e.translationX,
            vx: e.velocityX,
            canPrev,
            canNext,
          });
          if (verdict !== 0) runOnJS(onPage)(verdict);
          // Either way the panel returns home: on a commit the rack under it
          // has changed, so sliding back *is* the new rack arriving.
          offset.value = withTiming(0, { duration: 200 });
        })
        .onFinalize(() => {
          offset.value = withTiming(0, { duration: 200 });
        }),
    [canNext, canPrev, enabled, offset, onPage],
  );

  return { pan, offset };
}
