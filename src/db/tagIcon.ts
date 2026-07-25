/**
 * A small icon per tag, for item rows (field report: "can we put the small
 * icons next to the item").
 *
 * Most items have no photo of their own — scanning stamps the capture onto
 * the bin cover, not each item — so a thumbnail would either be blank or the
 * same bin picture repeated down the whole list. An icon carries what a
 * photo cannot here: which *kind* of thing each row is, at a glance.
 *
 * The vocabulary is the user's (D19), so this is a lookup with a fallback
 * rather than an exhaustive map. A tag invented this morning gets the
 * default and still looks deliberate.
 */
export type IoniconName =
  | 'construct'
  | 'flash'
  | 'water'
  | 'color-fill'
  | 'shield-checkmark'
  | 'resize'
  | 'disc'
  | 'hardware-chip'
  | 'layers'
  | 'cube'
  | 'build'
  | 'ellipse-outline';

const ICONS: Record<string, IoniconName> = {
  hand_tool: 'build',
  power_tool: 'construct',
  fastener: 'hardware-chip',
  electrical: 'flash',
  plumbing: 'water',
  adhesive_finish: 'color-fill',
  safety: 'shield-checkmark',
  measuring: 'resize',
  bit_blade_accessory: 'disc',
  hardware: 'cube',
  material: 'layers',
  other: 'ellipse-outline',
};

/**
 * Falls back on a keyword in the slug before giving up, so a user-invented
 * `garden_tool` or `marine_hardware` still lands somewhere sensible.
 */
export function iconForTag(slug: string): IoniconName {
  const exact = ICONS[slug];
  if (exact) return exact;
  // Guard the empty slug: `anything.includes('')` is true, so without this
  // every unnamed tag would take the first icon in the map.
  if (slug.length < 3) return 'ellipse-outline';

  for (const [known, icon] of Object.entries(ICONS)) {
    if (known === 'other') continue;
    if (slug.includes(known) || known.includes(slug)) return icon;
  }

  // Order is the ruleset. The more specific material wins: "wire nuts" are
  // electrical despite containing "nut", so electrical is asked first, and a
  // plain "nuts" still falls through to fasteners.
  if (/wire|cable|batter|electr|light|solder/.test(slug)) return 'flash';
  if (/pipe|hose|valve|water|marine|boat|plumb/.test(slug)) return 'water';
  if (/paint|glue|tape|finish|seal|varnish/.test(slug)) return 'color-fill';
  if (/screw|bolt|nail|nut|washer|rivet|anchor/.test(slug)) return 'hardware-chip';
  if (/blade|bit|disc|sand/.test(slug)) return 'disc';
  if (/tool|wrench|driver|saw|drill|hammer|plier/.test(slug)) return 'build';
  if (/glove|goggle|mask|helmet|safe/.test(slug)) return 'shield-checkmark';
  if (/wood|metal|plastic|sheet|lumber|stock/.test(slug)) return 'layers';
  return 'ellipse-outline';
}
