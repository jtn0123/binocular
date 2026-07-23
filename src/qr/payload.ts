import { z } from 'zod';

/**
 * Typed QR payload (blueprint §7, D13): `binoc:v1:<type>:<uuid>` —
 * versioned, dumb, offline-parseable. Everything read off a camera goes
 * through zod before use; anything foreign returns null for a friendly
 * error at the call site.
 */
export const QrTargetType = z.enum(['bin', 'shelf', 'location']);
export type QrTargetType = z.infer<typeof QrTargetType>;

export const QrPayload = z.object({
  type: QrTargetType,
  id: z.string().min(1),
});
export type QrPayload = z.infer<typeof QrPayload>;

const PREFIX = 'binoc';
const VERSION = 'v1';

export function encodeQrPayload(payload: QrPayload): string {
  return `${PREFIX}:${VERSION}:${payload.type}:${payload.id}`;
}

export function parseQrPayload(raw: string): QrPayload | null {
  // Scanners sometimes pad with whitespace or a trailing newline — trim
  // before parsing so our own labels always round-trip.
  const parts = raw.trim().split(':');
  if (parts.length !== 4) return null;
  const [prefix, version, type, id] = parts;
  if (prefix !== PREFIX || version !== VERSION) return null;
  const result = QrPayload.safeParse({ type, id: id.trim() });
  return result.success ? result.data : null;
}
