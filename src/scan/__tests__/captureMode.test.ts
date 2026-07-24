import {
  DEFAULT_CAPTURE_FLOW,
  flowForMode,
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
