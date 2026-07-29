import { Platform } from 'react-native';

/**
 * "Shop Floor" design system — the app looks like the inside of a
 * well-kept tool chest: graphite surfaces, gunmetal cards, safety-amber
 * accents, and label-maker monospace for every short code. One source of
 * truth; screens never hard-code colors.
 */
export const colors = {
  // surfaces
  bg: '#15171A', // chest interior
  surface: '#1F2226', // drawer card
  surfaceRaised: '#262A2F', // raised card / modal
  surfaceSunken: '#101214', // camera bars, wells
  border: '#33383F',
  borderStrong: '#464C55',

  // ink
  text: '#F2F0EA', // warm off-white
  textDim: '#A6ACB4',
  textFaint: '#6E747D',

  // brand
  amber: '#FFC400', // safety amber — primary action
  amberDeep: '#E0A800',
  amberInkOn: '#1A1500', // text on amber
  steel: '#7FB4D9', // cool steel-blue — links, secondary info

  // status
  danger: '#FF6B5E',
  dangerDim: '#4A2622',
  warn: '#FFB020',
  ok: '#7ACB8F',

  // chips
  chipBg: '#2A2F35',
  chipBorder: '#3D434B',
  chipSelectedBg: '#3A3524',
  chipSelectedBorder: '#8A7A2E',
} as const;

/**
 * The map's shelf hardware (D21): the recess a board sits in, the plank the
 * bins stand on, its uprights and slot ticks. Separate from `colors` because
 * these are lighting on a drawn object rather than surfaces of the UI — the
 * plank has a lit top edge and a shadowed face, and that pairing only makes
 * sense together.
 */
export const shelf = {
  /** The well a board is recessed into. */
  well: '#0E1012',
  wellBorder: '#23272B',
  /** Lit top edge of the plank, and of a bin card standing on it. */
  plankLit: '#5A626C',
  /** The plank's shadowed face. */
  plankFace: '#2E3338',
  upright: '#414850',
  tick: '#3A4046',
  /** The shelf name stamped on the board — louder than a caption, quieter than ink. */
  stamp: '#8F959D',
  /** Slot labels: quieter than textFaint, which would compete with the bins. */
  slotLabel: '#565C64',
} as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/** 4pt spacing scale: sp(4) = 16. */
export const sp = (n: number) => n * 4;

/** Label-maker mono for short codes, payload text, quantities. */
export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

export const type = {
  /** Stamped section headers: SHELF A, NEW, STILL HERE… */
  stamp: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
    color: colors.textFaint,
  },
  title: { fontSize: 22, fontWeight: '800' as const, color: colors.text },
  h2: { fontSize: 17, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  dim: { fontSize: 13, color: colors.textDim },
  code: { fontFamily: mono, fontWeight: '700' as const, color: colors.amber },
} as const;

/** Navigation chrome shared by Stack and Tabs. */
export const navTheme = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '800' as const, fontSize: 17 },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
} as const;
