import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, type SharedValue } from 'react-native-reanimated';

/**
 * Builds the map's single pan gesture.
 *
 * Lives outside the component for two reasons. The honest one: writing
 * `dragX.value` inside a `useMemo` reads to the React Compiler as mutating a
 * ref during render — `useSharedValue` returns a `{ value }` box it cannot
 * tell apart from `useRef` — and suppressing that rule at the only place it
 * fires would blunt it everywhere it is right. The better one: a factory keeps
 * the worklet bodies small and in one place, which is exactly what wants
 * auditing after a worklet killed the process last time.
 *
 * The bodies below are the whole gesture. Note what is NOT in them:
 *
 *  - `onUpdate` writes two numbers and calls nothing. The withdrawn version
 *    fired `runOnJS` on every touch sample — 90–120 Hz — and each hop drove a
 *    synchronous `scrollTo` on the JS thread.
 *  - no `measure`/`measureInWindow`. Hit-testing is arithmetic over rects
 *    collected at layout (see dragGeometry.ts).
 *  - no `scrollEnabled` flip. RNGH reads that at touch-down only, and changing
 *    it mid-gesture is the documented way to produce the pointer-set
 *    inconsistency it rethrows as a fatal exception.
 *  - no call to any function from module scope. That is what killed the last
 *    one: a captured non-worklet becomes a stub that throws, and release
 *    builds compile out the guard. `scripts/ci/audit-worklet-closures.mjs`
 *    fails the build if one reappears.
 *
 * Two thread hops per drag, both at the ends.
 */
export function makeBinDragGesture(opts: {
  enabled: boolean;
  activateAfterMs: number;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  onBegin: (x: number, y: number) => void;
  onRelease: (x: number, y: number) => void;
  onCancelled: () => void;
}) {
  const { enabled, activateAfterMs, dragX, dragY, onBegin, onRelease, onCancelled } = opts;
  return Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(activateAfterMs)
    .onStart((e) => {
      dragX.value = e.x;
      dragY.value = e.y;
      runOnJS(onBegin)(e.x, e.y);
    })
    .onUpdate((e) => {
      dragX.value = e.x;
      dragY.value = e.y;
    })
    .onEnd((e) => {
      runOnJS(onRelease)(e.x, e.y);
    })
    // A gesture the system cancels — an incoming call, the notification shade,
    // a rotation — must put the bin down rather than leave the map holding it.
    .onFinalize(() => {
      runOnJS(onCancelled)();
    });
}
