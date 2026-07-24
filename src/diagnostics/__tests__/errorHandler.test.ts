import type { DbAdapter } from '../../db/adapter';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { runMigrations } from '../../db/schema';
import { countEventsOfKind, listEvents, setLoggingEnabled } from '../events';
import { describeError, installErrorHandler, recordCrash } from '../errorHandler';

describe('global crash capture (blueprint D16)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    setLoggingEnabled(true);
  });
  afterEach(() => db.close());

  it('describes Errors and non-Errors alike', () => {
    expect(describeError(new Error('boom')).message).toBe('boom');
    expect(describeError(new Error('boom')).stack).toBeDefined();
    expect(describeError('plain string').message).toBe('plain string');
    expect(describeError({ odd: true }).message).toBe('{"odd":true}');
  });

  it('records a crash event with message, trimmed stack, and fatality', () => {
    recordCrash(db, new Error('kaboom'), { isFatal: true });

    const rows = listEvents(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('crash');
    const detail = JSON.parse(rows[0].detail ?? '{}');
    expect(detail.message).toBe('kaboom');
    expect(detail.isFatal).toBe(true);
    expect(String(detail.stack).split('\n').length).toBeLessThanOrEqual(20);
  });

  it('falls back to a file when the DB write fails — the DB may BE the problem', () => {
    const broken = {
      runSync: () => {
        throw new Error('disk full');
      },
      getFirstSync: () => {
        throw new Error('disk full');
      },
      getAllSync: () => {
        throw new Error('disk full');
      },
      execSync: () => {},
      withTransactionSync: () => {},
    } as unknown as DbAdapter;

    const lines: string[] = [];
    expect(() =>
      recordCrash(broken, new Error('fatal'), { appendFallback: (l) => lines.push(l) }),
    ).not.toThrow();

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).message).toBe('fatal');
  });

  it('installs a handler that logs AND calls the previous one', () => {
    const previous = jest.fn();
    let installed: ((e: unknown, fatal?: boolean) => void) | null = null;
    const errorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => {
        installed = h;
      },
    };

    const dispose = installErrorHandler(db, { errorUtils });
    expect(installed).not.toBeNull();

    installed!(new Error('from the field'), true);
    expect(countEventsOfKind(db, 'crash')).toBe(1);
    // Normal crash behaviour is preserved, not swallowed.
    expect(previous).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('no-ops safely when ErrorUtils is unavailable', () => {
    expect(() => installErrorHandler(db, { errorUtils: null })()).not.toThrow();
  });
});
