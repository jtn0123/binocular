import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { followOffset, swipeVerdict } from './rackSwipe';

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
