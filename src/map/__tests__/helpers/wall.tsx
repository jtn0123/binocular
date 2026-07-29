import { fireEvent, within, type RenderResult } from '@testing-library/react-native';

import { CARD_H, slotMidlines, slotWidth } from '@/components/map/metrics';

/**
 * A synthetic wall: real layout geometry pushed into a rendered map.
 *
 * `useMapFrames.measureRows` sums a chain — area → well → board → strip,
 * minus the vertical scroll — because React Native only ever reports a view's
 * position relative to its direct parent. Its own comment says it plainly:
 * "Dropping any link silently lands a bin on the wrong shelf."
 *
 * ## Ported to the v3 wall
 *
 * Two things changed under it, and both are forced rather than chosen. The
 * map used to be one scroller holding every rack; it is now one rack holding
 * its own scroller, so `map-scroll` sits *inside* `map-area-*` instead of
 * around it. And cells no longer have a fixed width and pitch — they share
 * the plank — so card centres come from `slotMidlines`.
 *
 * That second one costs this harness some of its independence, and the loss
 * should be known rather than discovered: the mid-lines are now computed with
 * the same function the board draws with, so a fault in *that* would move the
 * cards and the expectations together and this would not see it. What it
 * still checks on its own is the part that has actually broken before — the
 * summing of the chain, written out here link by link.
 *
 * Under jest nothing lays anything out, so every link is absent, `measureRow`
 * returns null for every row, and the drag resolves to nothing. That is why
 * the screen tests mock the gesture away entirely — and it means the sum has
 * never been exercised against a rendered tree. This drives the layout pass
 * by hand with positions a phone would produce, so it is.
 *
 * The offsets below are deliberately large and distinct at every level. If a
 * link is dropped or mis-ordered the finger lands on a *different shelf*, not
 * a few points off — geometry with small offsets would let that pass.
 */
const AREA_HEAD = 0; // v3 draws the rack's name as chrome outside the panel
/**
 * Where the rack panel starts, and why it is not zero.
 *
 * v3 shows one rack at a time, so the second area that used to make this
 * non-zero is no longer on screen — and an area at the origin hides a dropped
 * `area.x`/`area.y` completely, which is the exact hole the two-location
 * fixture was built to close. In the running app the panel is inset below the
 * toolbar and in from the edge, so these are what a phone reports anyway.
 */
const AREA_TOP = 58;
const AREA_X = 12;
const AREA_GAP = 20;
const WELL_Y = 52; // the well is recessed below the area's heading
const WELL_X = 16;
const BOARD_X = 5; // a board's own inset within the well
const BOARD_GAP = 14;
const BOARD_H = CARD_H + 34; // card plus the plank and its lip
const STRIP_W = 360; // the plank's usable width, which the slots divide up
const STRIP_X = 9; // the card row's inset within a board
const STRIP_Y = 12;

interface Placed {
  el: unknown;
  depth: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface Wall {
  /** Viewport point at the centre of a bin card, by short code. */
  onCard(code: string): { x: number; y: number };
  /**
   * A point in a card's left half — where a drop means "in front of this
   * one". The slot index counts cards whose mid-line the finger is left of,
   * so the halves of a card mean before and after, and the mid-line itself
   * counts as after. Aiming dead centre to mean "in front" is a coin flip on
   * a rounding error, which is why intent is spelled out here rather than in
   * each test's arithmetic.
   */
  frontOf(code: string): { x: number; y: number };
  /** A point in a card's right half — a drop lands after it. */
  behindOf(code: string): { x: number; y: number };
  /** Viewport point on a shelf's plank, past its last card. */
  pastEndOf(rowIndex: number): { x: number; y: number };
  /** A point below every shelf — releasing there is a cancel. */
  offWall(): { x: number; y: number };
  /** Viewport y-band of a shelf, for assertions. */
  bandOf(rowIndex: number): { top: number; bottom: number };
}

export interface LayoutOptions {
  /**
   * Which end of the tree reports its layout first.
   *
   * React Native does not promise an order, and a child commonly reports
   * before its parent. `measureRows` sums on demand rather than at report
   * time, so both orders must produce the same wall — this is what proves it.
   */
  order?: 'children-first' | 'parents-first';
  /** Vertical scroll offset to report, as if the wall had been scrolled. */
  scrollY?: number;
}

/**
 * Lay out every area, well, board and strip the map has drawn, then return
 * the coordinates a finger would use to touch them.
 */
export async function layoutWall(
  screen: RenderResult,
  { order = 'children-first', scrollY = 0 }: LayoutOptions = {},
): Promise<Wall> {
  const placed: Placed[] = [];
  const cards = new Map<string, { x: number; y: number }>();
  const cardRow = new Map<string, number>();
  const bands: {
    top: number;
    bottom: number;
    contentLeft: number;
    count: number;
    /** A slot's width on this plank, which the shared-width model decides. */
    width: number;
    /** Just past the last slot, still on the plank. */
    end: number;
  }[] = [];

  const viewport = screen.getByTestId('map-viewport');
  placed.push({ el: viewport, depth: 0, rect: { x: 0, y: 0, width: 400, height: 640 } });

  // In v3 the scroller lives *inside* the rack panel — one rack, one well —
  // so it is reported below the area rather than above it, and it is the well
  // whose offset `measureRow` adds.
  const scroll = screen.getByTestId('map-scroll');

  const areas = screen.getAllByTestId(/^map-area-/);
  let areaY = AREA_TOP;
  for (const area of areas) {
    // The well is looked up once, above: v3 has one rack on screen and one
    // scroller inside it, so it is no longer keyed by area.
    const boards = within(area).queryAllByTestId(/^map-board-/);
    const wellHeight = boards.length * (BOARD_H + BOARD_GAP);
    placed.push({
      el: area,
      depth: 2,
      rect: { x: AREA_X, y: areaY, width: 400 - AREA_X, height: AREA_HEAD + WELL_Y + wellHeight },
    });

    placed.push({
      el: scroll,
      depth: 3,
      rect: { x: WELL_X, y: WELL_Y, width: 400 - WELL_X, height: wellHeight },
    });

    let boardY = 0;
    for (const board of boards) {
      const key = String(board.props.testID).replace('map-board-', '');
      placed.push({
        el: board,
        depth: 4,
        rect: { x: BOARD_X, y: boardY, width: 400 - WELL_X - BOARD_X, height: BOARD_H },
      });

      const strip = screen.getByTestId(`map-strip-${key}`);
      placed.push({
        el: strip,
        depth: 5,
        rect: { x: STRIP_X, y: STRIP_Y, width: STRIP_W, height: CARD_H },
      });

      // The same sum measureRow performs, written out link by link so a
      // change to one has to be justified against the other.
      const top = areaY + WELL_Y + boardY - scrollY;
      const contentLeft = AREA_X + WELL_X + BOARD_X + STRIP_X;

      // Filled cells and declared-but-empty ones both take a slot, and it is
      // the total that sets the pitch — a half-empty shelf's cards are wider
      // and further in than a full one's.
      const cells = within(strip).queryAllByTestId(/^map-cell-/);
      const gaps = within(strip).queryAllByTestId(/^map-gap-/);
      const slots = cells.length + gaps.length;
      const width = slotWidth(STRIP_W, slots);
      const mids = slotMidlines(contentLeft, STRIP_W, slots);
      cells.forEach((cell, i) => {
        const code = String(cell.props.testID).replace('map-cell-', '');
        cards.set(code, { x: mids[i], y: top + BOARD_H / 2 });
        cardRow.set(code, bands.length);
      });
      bands.push({
        top,
        bottom: top + BOARD_H,
        contentLeft,
        count: cells.length,
        width,
        end: (mids[slots - 1] ?? contentLeft) + width,
      });

      boardY += BOARD_H + BOARD_GAP;
    }
    areaY += AREA_HEAD + WELL_Y + wellHeight + AREA_GAP;
  }

  const sorted = [...placed].sort((a, b) =>
    order === 'children-first' ? b.depth - a.depth : a.depth - b.depth,
  );
  for (const { el, rect } of sorted) {
    await fireEvent(el as Parameters<typeof fireEvent>[0], 'layout', {
      nativeEvent: { layout: rect },
    });
  }

  if (scrollY !== 0) {
    await fireEvent(scroll, 'scroll', {
      nativeEvent: {
        contentOffset: { x: 0, y: scrollY },
        contentSize: { width: 400, height: areaY },
        layoutMeasurement: { width: 400, height: 640 },
      },
    });
  }

  /** Which plank a card is standing on — its slot width comes from that row. */
  const bandFor = (code: string) => {
    const row = cardRow.get(code);
    const band = row !== undefined ? bands[row] : undefined;
    if (!band) throw new Error(`no card ${code} on the wall`);
    return band;
  };

  return {
    onCard(code) {
      const p = cards.get(code);
      if (!p) throw new Error(`no card ${code} on the wall`);
      return p;
    },
    frontOf(code) {
      const p = cards.get(code);
      if (!p) throw new Error(`no card ${code} on the wall`);
      return { x: p.x - bandFor(code).width / 4, y: p.y };
    },
    behindOf(code) {
      const p = cards.get(code);
      if (!p) throw new Error(`no card ${code} on the wall`);
      return { x: p.x + bandFor(code).width / 4, y: p.y };
    },
    pastEndOf(rowIndex) {
      const band = bands[rowIndex];
      if (!band) throw new Error(`no shelf ${rowIndex} on the wall`);
      // Past the last slot but still on the plank: off the end of the row is
      // a different answer from off the wall.
      return { x: band.end, y: band.top + BOARD_H / 2 };
    },
    bandOf(rowIndex) {
      const band = bands[rowIndex];
      if (!band) throw new Error(`no shelf ${rowIndex} on the wall`);
      return { top: band.top, bottom: band.bottom };
    },
    offWall() {
      const last = bands[bands.length - 1];
      return { x: 200, y: (last?.bottom ?? 0) + 200 };
    },
  };
}
