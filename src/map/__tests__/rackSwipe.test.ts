import { followOffset, swipeVerdict } from '../rackSwipe';

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
