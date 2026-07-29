import { renderHook } from '@testing-library/react-native';
// Namespaced: a bare `react-native` import shares a babel binding with
// `@testing-library/react-native` and the two quietly overwrite each other.
import * as RN from 'react-native';

import { followOffset, swipeVerdict, useRackSwipe } from '../useRackSwipe';

/** The travel the panel is given to clear the screen: one screen's worth. */
const SCREEN = RN.Dimensions.get('window').width;

/** Captured pan config and handlers; `mock`-prefixed for jest's factory. */
const mockPans: {
  handlers: Record<string, (e?: unknown, success?: boolean) => void>;
  config: Record<string, unknown>;
}[] = [];

jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => {
      const pan: {
        handlers: Record<string, unknown>;
        config: Record<string, unknown>;
        [key: string]: unknown;
      } = { handlers: {}, config: {} };
      for (const method of ['activateAfterLongPress', 'activeOffsetX', 'enabled', 'failOffsetY', 'maxPointers']) {
        pan[method] = (value: unknown) => {
          pan.config[method] = value;
          return pan;
        };
      }
      for (const method of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
        pan[method] = (fn: unknown) => {
          pan.handlers[method] = fn;
          return pan;
        };
      }
      mockPans.push(pan as (typeof mockPans)[number]);
      return pan;
    },
  },
}));

/**
 * Animation callbacks, waiting to be run.
 *
 * The transition is three moves and the last two only happen when the first
 * one lands, so a mock that drops the callback would test a third of it — and
 * the two it dropped are the two that were wrong. `settle()` is the frame
 * where the slide finishes.
 */
const mockLanding: ((finished: boolean) => void)[] = [];

jest.mock('react-native-reanimated', () => ({
  // Records everything assigned to it. What went wrong before was not where
  // the panel ended up — that was always 0 — but the route it took to get
  // there, so the route is what these tests read.
  useSharedValue: (initial: number) => {
    const trail: number[] = [];
    let current = initial;
    return {
      get value() {
        return current;
      },
      set value(next: number) {
        current = next;
        trail.push(next);
      },
      trail,
    };
  },
  runOnJS: (fn: unknown) => fn,
  withDelay: (_ms: number, animation: unknown) => animation,
  withTiming: (value: unknown, _config?: unknown, landed?: (finished: boolean) => void) => {
    if (landed) mockLanding.push(landed);
    return value;
  },
  Easing: { in: (fn: unknown) => fn, out: (fn: unknown) => fn, quad: 'quad', cubic: 'cubic' },
}));

/**
 * Swiping along the wall, played as the gesture would play it.
 *
 * The thresholds are already pinned as arithmetic in `rackSwipe.test.ts`.
 * What is asserted here is the *wiring* — that the pan is configured to want
 * only horizontal travel and to want it without waiting, and that a release
 * turns into a page. That configuration is what keeps this gesture and the
 * drag out of each other's way, and it is invisible to a test of either one
 * alone: the drag would still pass every test it has while the swipe quietly
 * stole every scroll of the rack panel.
 */
describe('the swipe that pages the wall', () => {
  let onPage: jest.Mock;

  const swipe = async (
    over: { enabled?: boolean; canPrev?: boolean; canNext?: boolean } = {},
  ) => {
    mockPans.length = 0;
    mockLanding.length = 0;
    const { result } = await renderHook(() =>
      useRackSwipe({ enabled: true, canPrev: true, canNext: true, onPage, ...over }),
    );
    const pan = mockPans[0];
    const offset = result.current.offset as unknown as { value: number; trail: number[] };
    const end = (dx: number, vx: number, success: boolean) =>
      pan.handlers.onEnd?.({ translationX: dx, translationY: 0, velocityX: vx }, success);
    return {
      config: pan.config,
      offset: () => offset.value,
      /** Every position the panel was sent to, in order. */
      trail: () => offset.trail,
      move: (dx: number) => pan.handlers.onUpdate?.({ translationX: dx, translationY: 0 }),
      release: (dx: number, vx = 0) => end(dx, vx, true),
      /** Ended without being let go of — taken over, or cancelled outright. */
      interrupt: (dx: number, vx = 0) => end(dx, vx, false),
      abandon: () => pan.handlers.onFinalize?.(),
      /** The slide reaches the edge of the screen. */
      settle: (finished = true) => {
        const queued = mockLanding.splice(0);
        for (const landed of queued) landed(finished);
      },
    };
  };

  beforeEach(() => {
    onPage = jest.fn();
  });

  describe('how it stays out of the drag’s way', () => {
    it('wants sideways travel, and will not start without it', async () => {
      // The drag is a hold that has not moved; this is movement that has not
      // waited. Two different pieces of evidence, so the race between them
      // has a winner rather than being a coin toss.
      expect((await swipe()).config.activeOffsetX).toEqual([-24, 24]);
    });

    it('gives up the moment the finger goes more vertical than sideways', async () => {
      // Without this the panel's own scroll would fight it, and the wall
      // would page whenever someone tried to look at a lower shelf.
      expect((await swipe()).config.failOffsetY).toEqual([-24, 24]);
    });

    it('is a one-finger gesture', async () => {
      expect((await swipe()).config.maxPointers).toBe(1);
    });

    it('is switched off outright rather than declining politely', async () => {
      // Off while a bin is in hand: with something being carried, a sideways
      // drag towards a rail is the same motion as a swipe.
      expect((await swipe({ enabled: false })).config.enabled).toBe(false);
    });
  });

  describe('while the finger is down', () => {
    it('carries the panel along, behind the finger', async () => {
      const gesture = await swipe();
      gesture.move(-100);
      // Lagging the finger is what makes the wall feel like it has weight.
      expect(gesture.offset()).toBeCloseTo(-55);
      expect(gesture.offset()).toBeGreaterThan(-100);
    });

    it('barely gives at the end of the wall', async () => {
      const gesture = await swipe({ canNext: false });
      gesture.move(-100);
      // It has to move a little — a surface that ignores a finger reads as a
      // missed touch — but not so much that it promises a rack.
      expect(Math.abs(gesture.offset())).toBeLessThan(20);
      expect(gesture.offset()).not.toBe(0);
    });
  });

  describe('on release', () => {
    /** Push the panel there, let go, and let the slide land. */
    const page = async (dx: number, vx = 0, over = {}) => {
      const gesture = await swipe(over);
      gesture.move(dx);
      gesture.release(dx, vx);
      gesture.settle();
      return gesture;
    };

    it('walks right when the finger dragged the panel far enough left', async () => {
      await page(-90);
      expect(onPage).toHaveBeenCalledWith(1);
    });

    it('walks left on the mirror of that', async () => {
      await page(90);
      expect(onPage).toHaveBeenCalledWith(-1);
    });

    it('takes a flick that never travelled the distance', async () => {
      await page(-20, -1400);
      expect(onPage).toHaveBeenCalledWith(1);
    });

    it('stays put on a nudge', async () => {
      await page(-30);
      expect(onPage).not.toHaveBeenCalled();
    });

    it('refuses to walk off either end of the wall', async () => {
      await page(-200, -3000, { canNext: false });
      await page(200, 3000, { canPrev: false });
      expect(onPage).not.toHaveBeenCalled();
    });
  });

  /**
   * The half that was missing.
   *
   * The panel used to slide *back* to the middle from wherever the finger had
   * left it, which put the incoming rack on the side the outgoing one had just
   * been pushed towards: swipe left for the next rack and the wall appeared to
   * shove you back the way you came. Every assertion the old version had still
   * passed, because they all read the final position — which was 0 then and is
   * 0 now. So these read the route.
   */
  describe('the way the wall moves between racks', () => {
    it('carries on the way the finger pushed it, then comes back from the far side', async () => {
      const gesture = await swipe();
      gesture.move(-100);
      gesture.release(-90);

      // Still going left, and far enough that none of it is on the screen —
      // which is what makes swapping the rack invisible rather than merely
      // quick.
      expect(gesture.offset()).toBe(-SCREEN);
      expect(onPage).not.toHaveBeenCalled();

      gesture.settle();
      expect(onPage).toHaveBeenCalledWith(1);
      // Off the right-hand edge, then in to the middle. The sign flip is the
      // whole fix: the rack you walked towards arrives from the direction you
      // walked.
      expect(gesture.trail().slice(-3)).toEqual([-SCREEN, SCREEN, 0]);
    });

    it('mirrors exactly when the wall is walked the other way', async () => {
      const gesture = await swipe();
      gesture.move(100);
      gesture.release(90);
      gesture.settle();

      expect(onPage).toHaveBeenCalledWith(-1);
      expect(gesture.trail().slice(-3)).toEqual([SCREEN, -SCREEN, 0]);
    });

    it('swaps the rack only once the panel is off the screen', async () => {
      // The other order is what the fix is *for*: paging first and sliding
      // afterwards is what drew the new rack coming in from the wrong side.
      const gesture = await swipe();
      gesture.release(-90);
      expect(onPage).not.toHaveBeenCalled();
      gesture.settle();
      expect(onPage).toHaveBeenCalledTimes(1);
    });

    it('does not page when the slide never got there', async () => {
      // A second swipe took the panel over mid-transition. That gesture owns
      // where the wall ends up; finishing this one too would page twice off
      // one flick.
      const gesture = await swipe();
      gesture.release(-90);
      gesture.settle(false);
      expect(onPage).not.toHaveBeenCalled();
    });

    it('falls back into place when the swipe did not go far enough', async () => {
      const gesture = await swipe();
      gesture.move(-40);
      gesture.release(-30);

      expect(gesture.offset()).toBe(0);
      // Straight back, with no excursion off the screen on the way.
      expect(gesture.trail()).not.toContain(-SCREEN);
    });

    it('brings it home even when the gesture is cancelled mid-swipe', async () => {
      // A call, a notification, a second finger — the panel must not be left
      // sitting half off the screen with no gesture to finish it.
      const gesture = await swipe();
      gesture.move(-100);
      gesture.abandon();

      expect(gesture.offset()).toBe(0);
      expect(onPage).not.toHaveBeenCalled();
    });

    it('does not undo its own transition when the gesture ends', async () => {
      // `onFinalize` runs immediately after `onEnd`, and its job is to rescue
      // a panel left stranded. Without knowing a page is under way it would
      // rescue this one — cancelling the slide a frame after it started, so
      // the wall twitched and stayed on the rack you had just left.
      const gesture = await swipe();
      gesture.move(-100);
      gesture.release(-90);
      gesture.abandon();

      expect(gesture.offset()).toBe(-SCREEN);
      gesture.settle();
      expect(onPage).toHaveBeenCalledWith(1);
      expect(gesture.offset()).toBe(0);
    });

    it('ignores a gesture that was taken over rather than let go of', async () => {
      // `onEnd` fires for a cancellation too. The finger never said "next", so
      // whatever translation it had reached must not be read as if it had.
      const gesture = await swipe();
      gesture.move(-100);
      gesture.interrupt(-200, -3000);
      gesture.settle();

      expect(onPage).not.toHaveBeenCalled();
      // And the rescue in onFinalize still runs, because nothing claimed it.
      gesture.abandon();
      expect(gesture.offset()).toBe(0);
    });
  });
});

const verdict = (over: Partial<Parameters<typeof swipeVerdict>[0]> = {}) =>
  swipeVerdict({ dx: 0, vx: 0, canPrev: true, canNext: true, ...over });

describe('what a sideways swipe across the wall means', () => {
  it('walks right when the finger travelled far enough left', () => {
    // Dragging the panel left pulls the next rack in from the right, the same
    // way stepping right along the wall does.
    expect(verdict({ dx: -80 })).toBe(1);
  });

  it('walks left on the mirror of that', () => {
    expect(verdict({ dx: 80 })).toBe(-1);
  });

  it('stays put on a nudge', () => {
    // Half a commit either way is a hand resting, or a scroll that drifted.
    expect(verdict({ dx: -30 })).toBe(0);
    expect(verdict({ dx: 30 })).toBe(0);
  });

  it('takes a fast flick that never travelled the distance', () => {
    // Requiring both distance and speed makes short deliberate flicks feel
    // ignored, which reads as the wall being broken rather than strict.
    expect(verdict({ dx: -20, vx: -1400 })).toBe(1);
    expect(verdict({ dx: 20, vx: 1400 })).toBe(-1);
  });

  it('refuses to walk off either end of the wall', () => {
    expect(verdict({ dx: -120, vx: -2000, canNext: false })).toBe(0);
    expect(verdict({ dx: 120, vx: 2000, canPrev: false })).toBe(0);
  });
});

describe('how far the panel follows the finger', () => {
  it('lags it, so the wall reads as heavier than the gesture', () => {
    expect(followOffset(100, true, true)).toBeCloseTo(55);
  });

  it('stops well before the panel would leave a gap behind it', () => {
    expect(followOffset(600, true, true)).toBe(90);
    expect(followOffset(-600, true, true)).toBe(-90);
  });

  it('barely gives at the end of the wall', () => {
    // It has to move a little — a surface that does not respond at all reads
    // as a missed touch — but not so much that it promises a rack.
    const free = followOffset(-100, true, true);
    const wall = followOffset(-100, true, false);
    expect(Math.abs(wall)).toBeLessThan(Math.abs(free) / 2);
    expect(wall).not.toBe(0);
  });
});
