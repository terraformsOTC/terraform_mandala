// The "experimental" pattern (James, 2026-11-17): the heightmap exploration's winners and
// runners-up (~/ops/mandala-explore, rounds 1-3), drawn cell for cell as explored. The
// drawings themselves are fixed (experimentalDesigns.js, generated); three transforms let
// them be explored on a parcel without changing what they are:
//   shift   0-7  turns every drawn height 1-8 round by n (1 -> 1+n, 8 -> n): the same
//                structure in other palette colours and phases;
//   reverse      flips the drawn heights (h -> 9 - h), so the motion runs the other way
//                (glyphs flow uphill: the spiral turns back, the star gate flies outward);
//   ground       swaps empty cells (9) for ground (0), so the background flickers with the
//                parcel's ground glyph instead of showing the parcel's background colour.
// Heights 0 and 9 are never shifted or reversed: they are ground and empty, not tones.

import { EXPERIMENTAL_DESIGNS } from './experimentalDesigns.js';

export { EXPERIMENTAL_DESIGNS };
export const EXPERIMENTAL_CATEGORIES = ['winners', 'runners-up'];
export const EXPERIMENTAL_DEFAULT = 'donut';

export const experimentalDesignsIn = (category) =>
  Object.keys(EXPERIMENTAL_DESIGNS).filter((id) => EXPERIMENTAL_DESIGNS[id].category === category);

export const normalizeExperimental = (id) => (EXPERIMENTAL_DESIGNS[id] ? id : EXPERIMENTAL_DEFAULT);

export function generateExperimental(id, { shift = 0, reverse = false, ground = false } = {}) {
  const design = EXPERIMENTAL_DESIGNS[normalizeExperimental(id)];
  const n = ((Math.round(Number(shift)) || 0) % 8 + 8) % 8;
  return design.rows.map((row) => row.split('').map((ch) => {
    let h = Number(ch);
    if (h >= 1 && h <= 8) {
      if (reverse) h = 9 - h;
      h = 1 + ((h - 1 + n) % 8);
    } else if (h === 9 && ground) {
      h = 0;
    }
    return String(h);
  }));
}
