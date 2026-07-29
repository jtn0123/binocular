import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

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
 *
 * ## The shape of a page
 *
 * Three moves, and the middle one is the reason there are three. The panel
 * carries on the way the finger pushed it until it is off the screen; the
 * rack underneath is swapped while nothing of it is visible; then it comes
 * back from the *opposite* edge. Walking right along the wall therefore
 * looks like walking right.
 *
 * The first version had only the last move — it swapped the rack and slid the
 * panel back to the middle from wherever the finger had dragged it. So a
 * swipe left, which means "the next rack, please", drew the next rack
 * entering from the left: the wall appeared to shove you back the way you
 * came. Everything before the release felt right, which is what made it hard
 * to name; it was the answer that was reversed, not the question.
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
 * The rack being left, accelerating off the edge the finger pushed it towards.
 *
 * Short, because it starts from a panel that is already moving: a slow exit
 * after a flick reads as the wall having second thoughts.
 */
const LEAVE = { duration: 120, easing: Easing.in(Easing.quad) };
/**
 * How long the panel waits off-screen before coming back.
 *
 * The swap happens on the JS thread — `onPage` is a `setState`, and the new
 * rack is not drawn until React has re-rendered. This is the margin that
 * takes: without it a slow frame would bring the *old* rack back on, sliding
 * in from the wrong side, and then pop to the right one.
 *
 * Nothing is drawn during it, which is the reason not to be generous — it is
 * a blank where the wall should be. Long enough to cover a re-render, short
 * enough not to read as the screen having gone out.
 */
const SWAP = 50;
/** The rack arriving, decelerating into place the way something heavy stops. */
const ARRIVE = { duration: 200, easing: Easing.out(Easing.cubic) };
/** A swipe that did not go far enough: the wall taking itself back. */
const SETTLE = { duration: 190, easing: Easing.out(Easing.quad) };

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
  /**
   * A release that committed has scheduled the whole three-move transition,
   * and `onFinalize` runs immediately after `onEnd`. Without this it would
   * yank the panel back to the middle a frame into the exit — the transition
   * would be cancelled by its own gesture ending.
   */
  const paging = useSharedValue(0);

  // The panel is the width of the screen, so this is the travel that puts it
  // entirely outside it — which is what makes the swap invisible rather than
  // merely quick.
  const { width } = useWindowDimensions();

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
        // `success` is false when the gesture was taken over or cancelled
        // rather than let go of. The finger never said "next", so the last
        // translation it happened to be at must not be read as if it had.
        .onEnd((e, success) => {
          if (!success) return;
          const verdict = swipeVerdict({
            dx: e.translationX,
            vx: e.velocityX,
            canPrev,
            canNext,
          });
          if (verdict === 0) {
            offset.value = withTiming(0, SETTLE);
            return;
          }
          paging.value = 1;
          // Out the way it was pushed…
          offset.value = withTiming(-verdict * width, LEAVE, (finished) => {
            // Interrupted — a second swipe took the panel over. That gesture
            // owns where it ends up, and paging now would page twice.
            if (!finished) return;
            runOnJS(onPage)(verdict);
            // …and back from the other side, which is the half that was
            // missing. Set outright rather than animated: the panel is off
            // the screen, so this is where the next rack starts, not a move.
            offset.value = verdict * width;
            offset.value = withDelay(SWAP, withTiming(0, ARRIVE));
          });
        })
        .onFinalize(() => {
          if (paging.value === 1) {
            paging.value = 0;
            return;
          }
          // A call, a notification, a second finger: the panel must not be
          // left sitting half off the screen with no gesture to finish it.
          offset.value = withTiming(0, SETTLE);
        }),
    [canNext, canPrev, enabled, offset, onPage, paging, width],
  );

  return { pan, offset };
}
