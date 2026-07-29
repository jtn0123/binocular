import { renderHook } from '@testing-library/react-native';

import { followOffset, swipeVerdict, useRackSwipe } from '../useRackSwipe';

/** Captured pan config and handlers; `mock`-prefixed for jest's factory. */
const mockPans: {
  handlers: Record<string, (e?: unknown) => void>;
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

jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: number) => ({ value: initial }),
  runOnJS: (fn: unknown) => fn,
  withTiming: (value: unknown) => value,
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
    const { result } = await renderHook(() =>
      useRackSwipe({ enabled: true, canPrev: true, canNext: true, onPage, ...over }),
    );
    const pan = mockPans[0];
    return {
      config: pan.config,
      offset: () => result.current.offset.value,
      move: (dx: number) => pan.handlers.onUpdate?.({ translationX: dx, translationY: 0 }),
      release: (dx: number, vx = 0) =>
        pan.handlers.onEnd?.({ translationX: dx, translationY: 0, velocityX: vx }),
      abandon: () => pan.handlers.onFinalize?.(),
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
    it('walks right when the finger dragged the panel far enough left', async () => {
      (await swipe()).release(-90);
      expect(onPage).toHaveBeenCalledWith(1);
    });

    it('walks left on the mirror of that', async () => {
      (await swipe()).release(90);
      expect(onPage).toHaveBeenCalledWith(-1);
    });

    it('takes a flick that never travelled the distance', async () => {
      (await swipe()).release(-20, -1400);
      expect(onPage).toHaveBeenCalledWith(1);
    });

    it('stays put on a nudge', async () => {
      (await swipe()).release(-30);
      expect(onPage).not.toHaveBeenCalled();
    });

    it('refuses to walk off either end of the wall', async () => {
      (await swipe({ canNext: false })).release(-200, -3000);
      (await swipe({ canPrev: false })).release(200, 3000);
      expect(onPage).not.toHaveBeenCalled();
    });

    it('brings the panel home whether or not it paged', async () => {
      // On a commit the rack underneath has changed, so sliding back *is* the
      // new rack arriving; on a refusal it is the wall saying no.
      const paged = await swipe();
      paged.move(-100);
      paged.release(-90);
      expect(paged.offset()).toBe(0);

      const refused = await swipe();
      refused.move(-40);
      refused.release(-30);
      expect(refused.offset()).toBe(0);
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
