import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, insertItem, insertScan, updateScanStatus } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { buildDiagnosticsPayload } from '../bundle';
import type { DeviceContext } from '../context';
import { logEvent, setLoggingEnabled } from '../events';

const CTX: DeviceContext = {
  appVersion: '0.1.0',
  appName: 'Binocular',
  platform: 'android',
  osVersion: '36',
  isDev: false,
  networkType: 'wifi',
  networkConnected: true,
};

describe('diagnostics bundle (blueprint D16)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    setLoggingEnabled(true);
  });
  afterEach(() => db.close());

  function populate() {
    const bin = createBin(db, { name: 'Hand tools', shortCode: 'B-003' });
    const scan = insertScan(db, { mode: 'bin_audit', photoUri: 'file:///p.jpg', binId: bin.id });
    updateScanStatus(db, scan.id, 'confirmed', { rawResponse: '{"items":[]}' });
    insertItem(db, { binId: bin.id, name: 'Hammer', category: 'hand_tool' });
    logEvent(db, { kind: 'app', name: 'app_start' });
    logEvent(db, { kind: 'crash', name: 'uncaught', detail: { message: 'boom' } });
    return { bin, scan };
  }

  it('carries context, counts, events and the full dump', () => {
    populate();
    const payload = buildDiagnosticsPayload(db, CTX);

    expect(payload.context).toEqual(CTX);
    expect(payload.counts).toMatchObject({ events: 2, crashes: 1, scans: 1, items: 1, bins: 1 });
    expect(payload.events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['app_start', 'uncaught']),
    );
    // Superset of the backup: the dump is included verbatim.
    expect(payload.dump.items[0].name).toBe('Hammer');
    expect(payload.dump.scans[0].raw_response).toBe('{"items":[]}');
    expect(payload.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records whether logging was on', () => {
    setLoggingEnabled(false);
    expect(buildDiagnosticsPayload(db, CTX).logging_enabled).toBe(false);
    setLoggingEnabled(true);
    expect(buildDiagnosticsPayload(db, CTX).logging_enabled).toBe(true);
  });

  it('NEVER contains API key material', () => {
    populate();
    // Simulate the kinds of settings events the app logs — booleans only.
    logEvent(db, { kind: 'settings', name: 'key_changed', detail: { engine: 'openai', present: true } });
    logEvent(db, { kind: 'settings', name: 'engine_changed', detail: { to: 'claude' } });

    const payload = buildDiagnosticsPayload(db, CTX);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/sk-ant-/);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(serialized).not.toMatch(/api_key|apiKey/i);

    // The boolean form is what we DO keep (detail is a JSON string column).
    const keyEvent = payload.events.find((e) => e.name === 'key_changed');
    expect(JSON.parse(keyEvent?.detail ?? '{}')).toEqual({ engine: 'openai', present: true });
  });

  it('respects the event limit', () => {
    for (let i = 0; i < 10; i++) logEvent(db, { kind: 'app', name: `e${i}` });
    expect(buildDiagnosticsPayload(db, CTX, 4).events).toHaveLength(4);
  });
});
