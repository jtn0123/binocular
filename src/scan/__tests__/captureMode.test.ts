import {
  DEFAULT_CAPTURE_FLOW,
  flowForMode,
  needsPreview,
  supportsKeepShooting,
  type CaptureFlow,
} from '../captureMode';

describe('capture flow (D18)', () => {
  it('offers keep-shooting for the two cataloging modes', () => {
    expect(supportsKeepShooting('bin_audit')).toBe(true);
    expect(supportsKeepShooting('check_in')).toBe(true);
  });

  it('never offers keep-shooting for find_it', () => {
    expect(supportsKeepShooting('find_it')).toBe(false);
  });

  it('honours the preference where the mode allows it', () => {
    expect(flowForMode('bin_audit', 'keep_shooting')).toBe('keep_shooting');
    expect(flowForMode('check_in', 'keep_shooting')).toBe('keep_shooting');
    expect(flowForMode('bin_audit', 'review_now')).toBe('review_now');
  });

  it('forces find_it to resolve now whatever the preference says', () => {
    const flows: CaptureFlow[] = ['review_now', 'keep_shooting'];
    for (const flow of flows) {
      expect(flowForMode('find_it', flow)).toBe('review_now');
    }
  });

  it('defaults to the blocking flow, so a single scan still ends on review', () => {
    expect(DEFAULT_CAPTURE_FLOW).toBe('review_now');
    expect(flowForMode('bin_audit', DEFAULT_CAPTURE_FLOW)).toBe('review_now');
  });
});

describe('capture preview', () => {
  it('confirms the frame on the engines that charge for it', () => {
    expect(needsPreview('claude')).toBe(true);
    expect(needsPreview('openai')).toBe(true);
  });

  it('costs the free engines no extra tap', () => {
    expect(needsPreview('fixture')).toBe(false);
    expect(needsPreview('local')).toBe(false);
  });

  it('does not block a capture while the engine is still unknown', () => {
    expect(needsPreview(null)).toBe(false);
  });
});
