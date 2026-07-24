import type { ScanContext } from './provider';

/**
 * The vision prompt — blueprint §6.2 verbatim. The prompt text is part of
 * the AI contract; change it only via a `blueprint:` commit.
 */
export function buildVisionPrompt(ctx: ScanContext): string {
  const lines = [
    'You are an inventory assistant for a home workshop. Analyze the photo and',
    'list every distinct item you can identify.',
    '',
    'Rules:',
    '- One entry per distinct item type. Identical items get one entry with a',
    '  quantity (e.g. 3 identical screwdrivers -> quantity: 3).',
    '- name: a short generic name a hardware store would use. No brand in name.',
    '- brand: only if the brand is actually legible or unmistakable in the photo.',
    '  Do not guess brands from color schemes. Otherwise null.',
    '- label_text: if the item is packaged (box of screws, tube of adhesive),',
    '  transcribe the key label text verbatim (product name, size, count).',
    '  Otherwise null.',
    // D19: the vocabulary is the user's, so it is listed from the tags table
    // at build time rather than hardcoded here.
    `- category: exactly one of: ${ctx.tags.join(', ')}.`,
    '  Use "other" when none of them fits — do not invent a category.',
    '- confidence — use exactly this rubric:',
    '    high:   item type AND its identifying details (size/brand/label) are',
    '            clearly visible and unambiguous.',
    '    medium: item type is clear, but details are inferred, partially',
    '            visible, or generic.',
    '    low:    item is partially hidden, blurry, or you are pattern-guessing',
    '            from shape/context.',
    '- Do not invent items to seem thorough. If in doubt, include it at low',
    '  confidence rather than omitting it — the user reviews every entry.',
    '- scene_notes: one sentence of anything that limits accuracy (glare,',
    '  overlap, closed containers), else null.',
  ];

  if (ctx.binName) {
    lines.push('', `Context: this bin is labeled "${ctx.binName}".`);
  }
  if (ctx.existingItems && ctx.existingItems.length > 0) {
    lines.push(
      '',
      'Items previously recorded in this bin (the photo may or may not still',
      `contain them): ${ctx.existingItems.join(', ')}.`,
    );
  }

  lines.push(
    '',
    'Respond with ONLY a JSON object matching:',
    '{ "items": [{ "name", "brand", "category", "quantity", "label_text",',
    '  "confidence" }], "scene_notes" }',
  );

  return lines.join('\n');
}
