import JSZip from 'jszip';

import { addPhotosToZip, collectPhotoUris, writeAndShareZip } from '../backup/backup';
import type { DbAdapter } from '../db/adapter';
import { dumpAll, type BackupDump } from '../db/backupQueries';
import { nowIso } from '../lib/time';

import { deviceContext, type DeviceContext } from './context';
import { countEvents, countEventsOfKind, isLoggingEnabled, listEvents, type EventRow } from './events';
import { buildMemoryReport, type MemoryReport } from './memoryReport';

/**
 * User-initiated diagnostics export (blueprint D16).
 *
 * Deliberately a superset of the backup — same DB dump, same photos, same zip
 * helpers (`src/backup/backup.ts`) — plus the event log and device context.
 * That reuse is the point: one code path to keep correct.
 *
 * NEVER include API keys. They live in expo-secure-store and are not part of
 * the DB dump; `settingsSummary` records only whether a key exists.
 */
export interface DiagnosticsPayload {
  generated_at: string;
  context: DeviceContext;
  logging_enabled: boolean;
  counts: {
    events: number;
    crashes: number;
    scans: number;
    items: number;
    bins: number;
  };
  events: EventRow[];
  /** D20: what visual memory holds and what it has been finding. */
  memory: MemoryReport;
  dump: BackupDump;
}

/** Pure assembly — unit-tested without touching the filesystem. */
export function buildDiagnosticsPayload(
  db: DbAdapter,
  context: DeviceContext,
  eventLimit = 2_000,
): DiagnosticsPayload {
  const dump = dumpAll(db, nowIso());
  return {
    generated_at: nowIso(),
    context,
    logging_enabled: isLoggingEnabled(),
    counts: {
      events: countEvents(db),
      crashes: countEventsOfKind(db, 'crash'),
      scans: dump.scans.length,
      items: dump.items.length,
      bins: dump.bins.length,
    },
    events: listEvents(db, eventLimit),
    memory: buildMemoryReport(db),
    dump,
  };
}

/** Zips the payload plus every referenced photo and opens the share sheet. */
export async function exportDiagnosticsZip(db: DbAdapter): Promise<void> {
  const payload = buildDiagnosticsPayload(db, deviceContext());
  const zip = new JSZip();
  zip.file('diagnostics.json', JSON.stringify(payload, null, 2));
  // Events also as JSONL — far easier to grep/tail than nested JSON.
  zip.file('events.jsonl', payload.events.map((e) => JSON.stringify(e)).join('\n'));
  addPhotosToZip(zip, collectPhotoUris(payload.dump));
  await writeAndShareZip(zip, `binocular-diagnostics-${nowIso().slice(0, 10)}.zip`);
}
