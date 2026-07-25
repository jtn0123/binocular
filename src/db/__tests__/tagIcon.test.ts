import { iconForTag } from '../tagIcon';
import { SEEDED_TAG_SLUGS } from '../tags';

describe('an icon for every tag (D19)', () => {
  it('gives every seeded tag its own icon', () => {
    for (const slug of SEEDED_TAG_SLUGS) {
      expect(iconForTag(slug)).toBeTruthy();
    }
  });

  it('does not give the whole list the same icon', () => {
    // The point is telling rows apart; one icon for everything is no icon.
    const distinct = new Set(SEEDED_TAG_SLUGS.map(iconForTag));
    expect(distinct.size).toBeGreaterThanOrEqual(SEEDED_TAG_SLUGS.length - 1);
  });

  it('guesses sensibly for a tag the user invented', () => {
    // D19 means the vocabulary is open, so these must not all fall through.
    expect(iconForTag('marine')).toBe('water');
    expect(iconForTag('garden_tool')).toBe('build');
    expect(iconForTag('wire_nuts')).toBe('flash');
    expect(iconForTag('lag_bolts')).toBe('hardware-chip');
  });

  it('falls back rather than throwing on something unguessable', () => {
    expect(iconForTag('zzz')).toBe('ellipse-outline');
    expect(iconForTag('')).toBe('ellipse-outline');
  });
});
