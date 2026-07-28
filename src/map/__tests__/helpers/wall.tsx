import { fireEvent, within, type RenderResult } from '@testing-library/react-native';

import { CARD_H, CARD_W, SLOT_PITCH } from '@/components/map/metrics';

/**
 * A synthetic wall: real layout geometry pushed into a rendered map.
 *
 * `useMapFrames.measureRows` sums a chain — area → well → board → sideways
 * strip, minus the vertical scroll — because React Native only ever reports a
 * view's position relative to its direct parent. Its own comment says it
 * plainly: "Dropping any link silently lands a bin on the wrong shelf."
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
const AREA_HEAD = 44; // area title, above the well
const AREA_GAP = 20;
const WELL_Y = 52; // the well is recessed below the area's heading
const WELL_X = 16;
const BOARD_X = 5; // a board's own inset within the well
const BOARD_GAP = 14;
const BOARD_H = CARD_H + 34; // card plus the plank and its lip
const STRIP_X = 9; // the sideways scroller's inset within a board
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
  /** Sideways scroll within a shelf's strip, by row index. */
  stripScrollX?: Record<number, number>;
}

/**
 * Lay out every area, well, board and strip the map has drawn, then return
 * the coordinates a finger would use to touch them.
 */
export async function layoutWall(
  screen: RenderResult,
  { order = 'children-first', scrollY = 0, stripScrollX = {} }: LayoutOptions = {},
): Promise<Wall> {
  const placed: Placed[] = [];
  const cards = new Map<string, { x: number; y: number }>();
  const bands: { top: number; bottom: number; contentLeft: number; count: number }[] = [];

  const viewport = screen.getByTestId('map-viewport');
  placed.push({ el: viewport, depth: 0, rect: { x: 0, y: 0, width: 400, height: 640 } });

  // The ScrollView is the gesture view's only laid-out child and fills it, so
  // it contributes no offset — which is exactly why `measureRow` does not add
  // one. Reported anyway, at zero, so the assumption is visible here.
  const scroll = screen.getByTestId('map-scroll');
  placed.push({ el: scroll, depth: 1, rect: { x: 0, y: 0, width: 400, height: 640 } });

  const areas = screen.getAllByTestId(/^map-area-/);
  let areaY = 0;
  for (const area of areas) {
    const areaKey = String(area.props.testID).replace('map-area-', '');
    const boards = within(area).queryAllByTestId(/^map-board-/);
    const wellHeight = boards.length * (BOARD_H + BOARD_GAP);
    placed.push({
      el: area,
      depth: 2,
      rect: { x: 0, y: areaY, width: 400, height: AREA_HEAD + WELL_Y + wellHeight },
    });

    const well = screen.getByTestId(`map-well-${areaKey}`);
    placed.push({
      el: well,
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
        rect: { x: STRIP_X, y: STRIP_Y, width: 360, height: CARD_H },
      });

      const rowIndex = bands.length;
      const sideways = stripScrollX[rowIndex] ?? 0;
      // The same sum measureRow performs, written out independently so a
      // change to one has to be justified against the other.
      const top = areaY + WELL_Y + boardY - scrollY;
      const contentLeft = 0 + WELL_X + BOARD_X + STRIP_X - sideways;

      const cells = within(strip).queryAllByTestId(/^map-cell-/);
      cells.forEach((cell, i) => {
        const code = String(cell.props.testID).replace('map-cell-', '');
        cards.set(code, {
          x: contentLeft + i * SLOT_PITCH + CARD_W / 2,
          y: top + BOARD_H / 2,
        });
      });
      bands.push({ top, bottom: top + BOARD_H, contentLeft, count: cells.length });

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

  for (const [index, x] of Object.entries(stripScrollX)) {
    const board = screen.getAllByTestId(/^map-board-/)[Number(index)];
    if (!board) continue;
    const key = String(board.props.testID).replace('map-board-', '');
    await fireEvent(screen.getByTestId(`map-strip-${key}`), 'scroll', {
      nativeEvent: {
        contentOffset: { x, y: 0 },
        contentSize: { width: 2000, height: CARD_H },
        layoutMeasurement: { width: 360, height: CARD_H },
      },
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

  return {
    onCard(code) {
      const p = cards.get(code);
      if (!p) throw new Error(`no card ${code} on the wall`);
      return p;
    },
    frontOf(code) {
      const p = cards.get(code);
      if (!p) throw new Error(`no card ${code} on the wall`);
      return { x: p.x - CARD_W / 4, y: p.y };
    },
    behindOf(code) {
      const p = cards.get(code);
      if (!p) throw new Error(`no card ${code} on the wall`);
      return { x: p.x + CARD_W / 4, y: p.y };
    },
    pastEndOf(rowIndex) {
      const band = bands[rowIndex];
      if (!band) throw new Error(`no shelf ${rowIndex} on the wall`);
      return {
        x: band.contentLeft + band.count * SLOT_PITCH + CARD_W / 2,
        y: band.top + BOARD_H / 2,
      };
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
