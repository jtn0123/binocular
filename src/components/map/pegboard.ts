/**
 * The pegboard the rack panel is recessed into.
 *
 * The design paints it with `radial-gradient(#1A1E23 1.1px, transparent 1.2px)`
 * on a 14px grid. React Native has no CSS gradients and no SVG in this app, so
 * the texture ships as a 14x14 tile repeated across the panel — one decode,
 * no per-dot views, and it survives the panel scrolling under it.
 *
 * Generated, not hand-written: see the script in the commit that added it.
 */
export const PEGBOARD_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAJklEQVR42mOQklNmIAczjGCNNkC8DEqTpBGk6T+Upo+No/FIiUYATqRKNO8cPDAAAAAASUVORK5CYII=';
