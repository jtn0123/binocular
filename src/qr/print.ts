import * as Print from 'expo-print';

import { labelSheetHtml, shelfPosterHtml, type LabelSpec } from './labels';
import type { QrPayload } from './payload';

/** Opens the native print dialog (which includes save-as-PDF). */
export async function printLabelSheet(labels: LabelSpec[]): Promise<void> {
  if (labels.length === 0) throw new Error('Nothing to print');
  await Print.printAsync({ html: labelSheetHtml(labels) });
}

/** Per-shelf poster: shelf QR + mini bin-QR grid on one page. */
export async function printShelfPoster(input: {
  shelfName: string;
  locationName: string | null;
  shelfPayload: QrPayload;
  bins: { payload: QrPayload; code: string; name: string }[];
}): Promise<void> {
  await Print.printAsync({ html: shelfPosterHtml(input) });
}
