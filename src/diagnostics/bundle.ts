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

/**
 * The log as text you can paste into a message (field-test finding: the zip
 * export is useless when the phone cannot hand a file to anyone, and "it
 * doesn't work" is all the bug report anybody can give).
 *
 * Deliberately NOT the zip's payload: the DB dump is the whole inventory and
 * has no place on a clipboard, and photos cannot go there at all. What is
 * kept is what explains behaviour — build, counts, memory, every crash in
 * full, and the tail of the event log. Same rule as the zip on secrets: an
 * API key is never in here, because it is never in an event.
 */
export function formatDiagnosticsText(
  payload: DiagnosticsPayload,
  opts: { events?: number } = {},
): string {
  const { context: c, counts } = payload;
  const lines: string[] = [
    `Binocular ${c.appVersion} · ${c.platform} ${c.osVersion} · ${c.isDev ? 'dev' : 'release'}`,
    `generated ${payload.generated_at} · logging ${payload.logging_enabled ? 'on' : 'off'}`,
    `network ${c.networkType} (${c.networkConnected === null ? 'unknown' : c.networkConnected ? 'connected' : 'offline'})`,
    `counts: ${counts.events} events, ${counts.crashes} crashes, ${counts.scans} scans, ${counts.items} items, ${counts.bins} bins`,
    `memory: ${payload.memory.remembered} of ${payload.memory.withPhotos} remembered · ${payload.memory.model ?? 'no encoder'}${payload.memory.available ? ' (loaded)' : ''} · ${payload.memory.recalls} recalls, ${payload.memory.embedFailures} embed failures`,
  ];

  // Crashes first and in full: they are the reason anyone opens this.
  const crashes = payload.events.filter((e) => e.kind === 'crash');
  lines.push('', `--- crashes (${crashes.length}) ---`);
  if (crashes.length === 0) lines.push('none recorded');
  for (const crash of crashes) {
    lines.push(`${crash.created_at} ${crash.name}`, crash.detail ?? '(no detail)');
  }

  const limit = opts.events ?? 120;
  const tail = payload.events.slice(0, limit);
  lines.push('', `--- last ${tail.length} events (newest first) ---`);
  for (const event of tail) {
    const ms = event.duration_ms === null ? '' : ` ${event.duration_ms}ms`;
    const detail = event.detail ? ` ${event.detail}` : '';
    lines.push(`${event.created_at} ${event.kind}/${event.name}${ms}${detail}`);
  }
  return lines.join('\n');
}

export interface DiagnosticsZipOptions {
  /**
   * Include the full inventory dump and every photo it references.
   *
   * Off by default, and that is the point. This export is reached from a
   * button labelled "Share diagnostics", next to one that promises "No photos
   * and no inventory, just the log" — and it used to send the entire workshop
   * and every photograph in it, unconditionally and without saying so.
   * Consent to share a log is not consent to share the workshop, and this is
   * the one thing in the app whose cost lands outside it.
   */
  includeInventory?: boolean;
}

/** Zips the log, and — only if asked — the inventory and its photos. */
export async function exportDiagnosticsZip(
  db: DbAdapter,
  opts: DiagnosticsZipOptions = {},
): Promise<void> {
  const payload = buildDiagnosticsPayload(db, deviceContext());
  const zip = new JSZip();
  const shared: Omit<DiagnosticsPayload, 'dump'> & { dump?: BackupDump } = { ...payload };
  if (!opts.includeInventory) delete shared.dump;
  zip.file('diagnostics.json', JSON.stringify(shared, null, 2));
  // Events also as JSONL — far easier to grep/tail than nested JSON.
  zip.file('events.jsonl', payload.events.map((e) => JSON.stringify(e)).join('\n'));
  if (opts.includeInventory) addPhotosToZip(zip, collectPhotoUris(payload.dump));
  const suffix = opts.includeInventory ? 'full' : 'log';
  await writeAndShareZip(zip, `binocular-diagnostics-${suffix}-${nowIso().slice(0, 10)}.zip`);
}
