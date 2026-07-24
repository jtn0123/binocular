import qrcodegen from 'qrcode-generator';

import { encodeQrPayload, type QrPayload } from './payload';

/**
 * Printable label sheets (blueprint §7): Avery 5163 geometry — US Letter,
 * 2in × 4in labels, 2 columns × 5 rows, 10 per page. QR left,
 * human-readable code + name right, so bins are findable without the app.
 * Pure HTML generation lives here (unit-testable); expo-print renders it.
 */
export interface LabelSpec {
  payload: QrPayload;
  /** Big human-readable line — bin short code, or shelf/location name. */
  code: string;
  /** Secondary line — bin name, or "Shelf"/"Location". */
  name: string;
  /** Optional third line — shelf · location breadcrumb (field-test ask). */
  where?: string;
}

/** Renders a QR code as an inline SVG sized via viewBox (scales in CSS). */
export function buildQrSvg(data: string): string {
  const qr = qrcodegen(0, 'M'); // type 0 = auto-size
  qr.addData(data);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2; // quiet-zone modules on each side
  const size = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labelHtml(label: LabelSpec): string {
  const svg = buildQrSvg(encodeQrPayload(label.payload));
  return (
    `<div class="label">` +
    `<div class="qr">${svg}</div>` +
    `<div class="text"><div class="code">${escapeHtml(label.code)}</div>` +
    `<div class="name">${escapeHtml(label.name)}</div>` +
    (label.where ? `<div class="where">${escapeHtml(label.where)}</div>` : '') +
    `</div>` +
    `</div>`
  );
}

/** Full printable document: 10 labels per US-Letter page, Avery 5163. */
export function labelSheetHtml(labels: LabelSpec[]): string {
  const pages: string[] = [];
  for (let i = 0; i < labels.length; i += 10) {
    const cells = labels
      .slice(i, i + 10)
      .map((l) => labelHtml(l))
      .join('');
    pages.push(`<div class="page">${cells}</div>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: letter; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; }
  .page {
    width: 8.5in; height: 11in;
    padding: 0.5in 0.15625in;
    display: flex; flex-wrap: wrap; align-content: flex-start;
    column-gap: 0.1875in;
    page-break-after: always;
  }
  .label {
    width: 4in; height: 2in;
    display: flex; align-items: center; gap: 0.15in;
    padding: 0.15in;
    overflow: hidden;
    /* Cut/fold guide for plain-paper printing; sits inside the sticker
       edge on Avery 5163 sheets. */
    border: 1px dashed #999;
    border-radius: 6px;
  }
  .qr { width: 1.6in; height: 1.6in; flex-shrink: 0; }
  .qr svg { width: 100%; height: 100%; }
  .text { flex: 1; min-width: 0; }
  .code { font-size: 28pt; font-weight: 700; letter-spacing: 0.02em; }
  .name { font-size: 13pt; color: #333; margin-top: 0.06in;
          overflow: hidden; text-overflow: ellipsis; }
  .where { font-size: 10pt; color: #666; margin-top: 0.04in;
           overflow: hidden; text-overflow: ellipsis; }
  </style></head><body>${pages.join('')}</body></html>`;
}

/**
 * Per-shelf poster (field-test ask): one page with the shelf QR big at the
 * top and a grid of its bins' mini labels below — tape it to the shelf edge.
 */
export function shelfPosterHtml(input: {
  shelfName: string;
  locationName: string | null;
  shelfPayload: QrPayload;
  bins: { payload: QrPayload; code: string; name: string }[];
}): string {
  const shelfQr = buildQrSvg(encodeQrPayload(input.shelfPayload));
  const cells = input.bins
    .map(
      (bin) =>
        `<div class="cell"><div class="cellqr">${buildQrSvg(encodeQrPayload(bin.payload))}</div>` +
        `<div class="cellcode">${escapeHtml(bin.code)}</div>` +
        `<div class="cellname">${escapeHtml(bin.name)}</div></div>`,
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: letter; margin: 0.5in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; }
  .head { display: flex; align-items: center; gap: 0.3in;
          border: 1px dashed #999; border-radius: 8px; padding: 0.2in;
          margin-bottom: 0.25in; }
  .headqr { width: 1.8in; height: 1.8in; flex-shrink: 0; }
  .headqr svg { width: 100%; height: 100%; }
  .shelf { font-size: 30pt; font-weight: 700; }
  .loc { font-size: 14pt; color: #555; margin-top: 0.08in; }
  .grid { display: flex; flex-wrap: wrap; gap: 0.15in; }
  .cell { width: 1.55in; border: 1px dashed #bbb; border-radius: 6px;
          padding: 0.1in; text-align: center; }
  .cellqr { width: 1in; height: 1in; margin: 0 auto; }
  .cellqr svg { width: 100%; height: 100%; }
  .cellcode { font-size: 13pt; font-weight: 700; margin-top: 0.05in; }
  .cellname { font-size: 8pt; color: #555; overflow: hidden;
              text-overflow: ellipsis; white-space: nowrap; }
  </style></head><body>
  <div class="head"><div class="headqr">${shelfQr}</div>
  <div><div class="shelf">${escapeHtml(input.shelfName)}</div>
  ${input.locationName ? `<div class="loc">${escapeHtml(input.locationName)}</div>` : ''}
  </div></div>
  <div class="grid">${cells}</div>
  </body></html>`;
}
