import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, getScan, insertItem, insertScan } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { resolveVisionProvider } from '../../vision';
import { VisionError, type VisionProvider } from '../../vision/provider';
import { enqueueBinAuditScan, processScan } from '../scanFlow';

jest.mock('../photos', () => ({
  persistPhoto: jest.fn(() => 'file:///photos/stored.jpg'),
  makeUploadBase64: jest.fn(async () => 'base64-payload'),
}));

jest.mock('../../vision', () => ({
  resolveVisionProvider: jest.fn(),
}));

const mockResolve = resolveVisionProvider as jest.MockedFunction<typeof resolveVisionProvider>;

const RESULT = {
  items: [
    {
      name: 'Wood glue',
      brand: null,
      category: 'adhesive_finish' as const,
      quantity: 1,
      label_text: null,
      confidence: 'high' as const,
    },
  ],
  scene_notes: null,
};

function providerReturning(result: unknown): VisionProvider {
  return { recognize: jest.fn(async () => result) } as unknown as VisionProvider;
}

function providerThrowing(err: unknown): VisionProvider {
  return {
    recognize: jest.fn(async () => {
      throw err;
    }),
  };
}

describe('scan lifecycle (blueprint §9 shape)', () => {
  let db: NodeDbAdapter;

  beforeEach(() => {
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    jest.clearAllMocks();
  });
  afterEach(() => {
    db.close();
  });

  it('enqueue persists the photo and writes a queued scan row', () => {
    const bin = createBin(db, { name: 'Adhesives', shortCode: 'B-004' });
    const scanId = enqueueBinAuditScan(db, { binId: bin.id, tempPhotoUri: 'file:///tmp/x.jpg' });
    const scan = getScan(db, scanId);
    expect(scan?.status).toBe('queued');
    expect(scan?.photo_uri).toBe('file:///photos/stored.jpg');
    expect(scan?.mode).toBe('bin_audit');
    expect(scan?.bin_id).toBe(bin.id);
  });

  it('success path: processing -> review with raw_response stored verbatim', async () => {
    const bin = createBin(db, { name: 'Adhesives', shortCode: 'B-004' });
    const scanId = enqueueBinAuditScan(db, { binId: bin.id, tempPhotoUri: 'file:///tmp/x.jpg' });
    mockResolve.mockResolvedValue(providerReturning(RESULT));

    const outcome = await processScan(db, scanId);
    expect(outcome.outcome).toBe('review');
    const scan = getScan(db, scanId);
    expect(scan?.status).toBe('review');
    expect(JSON.parse(scan?.raw_response ?? '')).toEqual(RESULT);
  });

  it('passes bin name and existing item names as context hints', async () => {
    const bin = createBin(db, { name: 'Hand tools', shortCode: 'B-003' });
    insertItem(db, { binId: bin.id, name: 'Hammer', category: 'hand_tool' });
    const scanId = enqueueBinAuditScan(db, { binId: bin.id, tempPhotoUri: 'file:///t.jpg' });
    const provider = providerReturning(RESULT);
    mockResolve.mockResolvedValue(provider);

    await processScan(db, scanId);
    expect(provider.recognize).toHaveBeenCalledWith(['base64-payload'], {
      mode: 'bin_audit',
      binName: 'Hand tools',
      existingItems: ['Hammer'],
    });
  });

  it('network errors drop the scan back to queued — the photo is never lost', async () => {
    const bin = createBin(db, { name: 'A', shortCode: 'B-001' });
    const scanId = enqueueBinAuditScan(db, { binId: bin.id, tempPhotoUri: 'file:///t.jpg' });
    mockResolve.mockResolvedValue(providerThrowing(new VisionError('offline', 'network')));

    const outcome = await processScan(db, scanId);
    expect(outcome.outcome).toBe('queued');
    expect(getScan(db, scanId)?.status).toBe('queued');
  });

  it('rate_limit also returns to queued; auth and invalid_response fail', async () => {
    const bin = createBin(db, { name: 'A', shortCode: 'B-001' });
    const cases: ['rate_limit' | 'auth' | 'invalid_response', string][] = [
      ['rate_limit', 'queued'],
      ['auth', 'failed'],
      ['invalid_response', 'failed'],
    ];
    for (const [kind, expected] of cases) {
      const scanId = enqueueBinAuditScan(db, { binId: bin.id, tempPhotoUri: 'file:///t.jpg' });
      mockResolve.mockResolvedValue(providerThrowing(new VisionError(kind, kind)));
      const outcome = await processScan(db, scanId);
      expect(outcome.outcome).toBe(expected);
      expect(getScan(db, scanId)?.status).toBe(expected);
    }
  });

  it('failed scans record the error and resolved_at', async () => {
    const bin = createBin(db, { name: 'A', shortCode: 'B-001' });
    const scanId = enqueueBinAuditScan(db, { binId: bin.id, tempPhotoUri: 'file:///t.jpg' });
    mockResolve.mockResolvedValue(providerThrowing(new VisionError('bad key', 'auth')));

    await processScan(db, scanId);
    const scan = getScan(db, scanId);
    expect(scan?.error).toBe('bad key');
    expect(scan?.resolved_at).not.toBeNull();
  });

  it('processScan on a missing scan fails without touching the db', async () => {
    const outcome = await processScan(db, 'nope');
    expect(outcome.outcome).toBe('failed');
  });

  it('a queued scan can be re-processed later (manual retry path)', async () => {
    const bin = createBin(db, { name: 'A', shortCode: 'B-001' });
    const scanId = enqueueBinAuditScan(db, { binId: bin.id, tempPhotoUri: 'file:///t.jpg' });
    mockResolve.mockResolvedValueOnce(providerThrowing(new VisionError('offline', 'network')));
    await processScan(db, scanId);
    expect(getScan(db, scanId)?.status).toBe('queued');

    mockResolve.mockResolvedValueOnce(providerReturning(RESULT));
    const second = await processScan(db, scanId);
    expect(second.outcome).toBe('review');
  });

  it('a scan whose bin was never set still processes (find_it shape)', async () => {
    const scan = insertScan(db, { mode: 'find_it', photoUri: 'file:///photos/f.jpg' });
    const provider = providerReturning(RESULT);
    mockResolve.mockResolvedValue(provider);
    const outcome = await processScan(db, scan.id);
    expect(outcome.outcome).toBe('review');
    expect(provider.recognize).toHaveBeenCalledWith(['base64-payload'], {
      mode: 'find_it',
      binName: undefined,
      existingItems: undefined,
    });
  });
});
