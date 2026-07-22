import * as Print from 'expo-print';

import { labelSheetHtml, type LabelSpec } from './labels';

/** Opens the native print dialog (which includes save-as-PDF). */
export async function printLabelSheet(labels: LabelSpec[]): Promise<void> {
  if (labels.length === 0) throw new Error('Nothing to print');
  await Print.printAsync({ html: labelSheetHtml(labels) });
}
