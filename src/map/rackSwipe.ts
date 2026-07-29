/**
 * The arithmetic behind swiping along the wall, kept out of the hook.
 *
 * These run on the UI thread inside the gesture's worklets — hence the
 * directives — but they are ordinary functions, so the thresholds that decide
 * whether a given flick counts are readable and testable without a device.
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
