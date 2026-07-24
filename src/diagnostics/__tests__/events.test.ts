import type { DbAdapter } from '../../db/adapter';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { runMigrations } from '../../db/schema';
import {
  clearEvents,
  countEvents,
  countEventsOfKind,
  listEvents,
  logEvent,
  MAX_EVENTS,
  pruneEvents,
  setLoggingEnabled,
} from '../events';

describe('diagnostics event log (blueprint D16)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    setLoggingEnabled(true);
  });
  afterEach(() => {
    setLoggingEnabled(true);
    db.close();
  });

  it('appends events and returns them newest-first', () => {
    logEvent(db, { kind: 'app', name: 'app_start' });
    logEvent(db, { kind: 'screen', name: '/settings' });
    logEvent(db, { kind: 'scan', name: 'scan_settled', durationMs: 1234, scanId: 's1' });

    const rows = listEvents(db);
    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe('scan_settled');
    expect(rows[0].duration_ms).toBe(1234);
    expect(rows[0].scan_id).toBe('s1');
    expect(countEvents(db)).toBe(3);
    expect(countEventsOfKind(db, 'screen')).toBe(1);
  });

  it('serializes detail as JSON', () => {
    logEvent(db, { kind: 'search', name: 'search', detail: { query: 'screw', results: 2 } });
    expect(JSON.parse(listEvents(db)[0].detail ?? '{}')).toEqual({ query: 'screw', results: 2 });
  });

  it('records nothing while logging is disabled', () => {
    setLoggingEnabled(false);
    logEvent(db, { kind: 'app', name: 'ignored' });
    expect(countEvents(db)).toBe(0);

    setLoggingEnabled(true);
    logEvent(db, { kind: 'app', name: 'kept' });
    expect(countEvents(db)).toBe(1);
  });

  it('NEVER throws, even on a broken adapter — diagnostics cannot break a flow', () => {
    const broken = {
      runSync: () => {
        throw new Error('db gone');
      },
      getAllSync: () => {
        throw new Error('db gone');
      },
      getFirstSync: () => {
        throw new Error('db gone');
      },
      execSync: () => {
        throw new Error('db gone');
      },
      withTransactionSync: () => {
        throw new Error('db gone');
      },
    } as unknown as DbAdapter;

    expect(() => logEvent(broken, { kind: 'app', name: 'x' })).not.toThrow();
    expect(listEvents(broken)).toEqual([]);
    expect(countEvents(broken)).toBe(0);
    expect(pruneEvents(broken)).toBe(0);
    expect(() => clearEvents(broken)).not.toThrow();
  });

  describe('pruning is bounded by BOTH age and count', () => {
    it('drops events older than the age window', () => {
      logEvent(db, { kind: 'app', name: 'old' });
      db.runSync("UPDATE events SET created_at = '2020-01-01T00:00:00Z'");
      logEvent(db, { kind: 'app', name: 'fresh' });

      expect(pruneEvents(db)).toBe(1);
      const rows = listEvents(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('fresh');
    });

    it('caps the log at MAX_EVENTS, keeping the newest', () => {
      const over = 25;
      db.withTransactionSync(() => {
        for (let i = 0; i < MAX_EVENTS + over; i++) {
          logEvent(db, { kind: 'app', name: `e${i}` });
        }
      });
      expect(countEvents(db)).toBe(MAX_EVENTS + over);

      expect(pruneEvents(db)).toBe(over);
      expect(countEvents(db)).toBe(MAX_EVENTS);
      // The newest survived; the oldest did not.
      const names = listEvents(db, MAX_EVENTS).map((r) => r.name);
      expect(names).toContain(`e${MAX_EVENTS + over - 1}`);
      expect(names).not.toContain('e0');
    });
  });

  it('clearEvents empties the log', () => {
    logEvent(db, { kind: 'app', name: 'a' });
    clearEvents(db);
    expect(countEvents(db)).toBe(0);
  });
});
