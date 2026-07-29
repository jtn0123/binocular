import { scannedAgo } from '../time';

const now = new Date('2026-04-20T12:00:00Z');
const daysAgo = (days: number, hours = 0) =>
  new Date(now.getTime() - days * 86_400_000 - hours * 3_600_000).toISOString();

/**
 * "scanned 4d ago", under every bin on Browse and at the top of bin detail.
 *
 * It reads as decoration and is in fact the answer to the only question a long
 * list of bins is asked: which of these has nobody actually looked in. Its
 * edges — a bin nobody has ever scanned, a clock that has gone backwards —
 * are the ones a real workshop hits first.
 */
describe('how long since a bin was scanned', () => {
  it('says so plainly when the camera has never visited', () => {
    // Not a blank and not "0d ago", both of which read as "scanned just now".
    expect(scannedAgo(null, now)).toBe('never scanned');
  });

  it('calls anything inside a day today', () => {
    expect(scannedAgo(daysAgo(0), now)).toBe('scanned today');
    expect(scannedAgo(daysAgo(0, 23), now)).toBe('scanned today');
  });

  it('has a word for yesterday rather than "1d ago"', () => {
    expect(scannedAgo(daysAgo(1), now)).toBe('scanned yesterday');
  });

  it('counts whole days after that', () => {
    expect(scannedAgo(daysAgo(4), now)).toBe('scanned 4d ago');
    expect(scannedAgo(daysAgo(365), now)).toBe('scanned 365d ago');
  });

  it('rounds down, so a bin is never aged up by a few hours', () => {
    expect(scannedAgo(daysAgo(2, 23), now)).toBe('scanned 2d ago');
  });

  it('does not report a scan from the future as a negative age', () => {
    // Phones travel between timezones and clocks get corrected. "scanned
    // -1d ago" is the kind of thing that makes someone distrust the whole
    // screen.
    expect(scannedAgo(daysAgo(-3), now)).toBe('scanned today');
  });

  it('survives a timestamp it cannot parse', () => {
    expect(scannedAgo('not a date', now)).toBe('scanned today');
  });
});
