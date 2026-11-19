// The drawings a grain seal hides in (James, 2026-11-19: "We are only going with messages encoded
// in grain"; "keep the flower the same size as before for unencrypted messages, and only use the
// smaller one when a user wants to encrypt something, so in effect we have 2 different, but similar
// looking flower drawings"). Both are parcel #6454's flower (glyphs › mathcastles › #6454): its outer
// field, the 8s that reach the border, is speckled with 7s, and a seal moves some speckles by one
// height (seal.js, GRAIN SEALS). The flower itself never changes.
//   flower      the flower as dreamt, speckled at p = 0.15: inscriptions (up to 53 bytes, in a frame
//               of up to 64), commitments, plain hashes and lists (a 48-byte frame). 583 field cells.
//   miniflower  the same flower at 70% (~/ops/mandala-explore/miniflower, mini70-clean), whose wider
//               field (~800 cells) holds a sealed message of up to 53 bytes. Speckled at p = 0.5, so a
//               seal leaves the speckle as dense as it was, and always sealed in a 96-byte frame, so a
//               sealed flower reads the same whatever the message's length. Its drawing differs for
//               every seal (James, 2026-11-19: "implement a range of changes to the flowers within the
//               bounds you've just set, so each flower drawing for a sealed secret is in fact
//               different"): one of MINI_FLOWER_VARIANTS tweaks of it, below.
// A cover's speckle is fresh for every seal (and redrawn when a seal does not fit it); decoding
// needs only the drawing.
import { MATHCASTLES_DREAMS } from './mandala.js';

export const MINI_FLOWER_ROWS = [
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888566888888888888',
  '88888888888888885566688888888888',
  '88888888887778885566688888888888',
  '88888888866666885555688888888888',
  '88888888866556775555688888888888',
  '88888888865555544455688888888888',
  '88888888885544444345555568888888',
  '88888888888554888844455568888888',
  '88888888888554888833455568888888',
  '88888887766544888874556668888888',
  '88888886655543888774566668888888',
  '88888886655545777734568888888888',
  '88888886665555443444555888888888',
  '88888888677665544555555588888888',
  '88888888888765555555556588888888',
  '88888888888765555855566588888888',
  '88888888888766555886666888888888',
  '88888888888866655888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
];

// The small flower's variants: the hand-drawn flower with the tweaks James picked from on 2026-11-19
// (~/ops/mandala-explore/minitweak2, candidates a-j). Always: the hole's square corners rounded off
// with the ring's height (3); the outline's creases (7, the speckle's own height) turned to rim (6);
// every petal edge outlined (6). Then four choices, 4 x 2 x 2 x 4 = 64 drawings:
//   the upper-left petal (it was the smallest) grown: a row taller, a column wider, both, or both
//   with a pointed tip; the lower-right petal's spur kept or trimmed; the top petal's tip as drawn or
//   fuller; the petals' gradient: 4 near the centre and 5 further out, changing 5.6, 6.2 or 6.8 cell
//   widths from the hole's centre (rows count 1.45 wide), or 3 > 4 > 5 in three steps.
// Every one holds a 53-character sealed message (~/ops/mandala-seal/grain/test-site-covers.mjs).
export const MINI_FLOWER_VARIANTS = 64;
const ROUND_CENTRE = [[14, 14], [14, 17], [17, 14]];
const CRISP = [[9, 10], [9, 11], [9, 12], [11, 14], [11, 15], [16, 7], [16, 8], [20, 9], [20, 10], [21, 11], [22, 11], [23, 11]];
const UL_OLD_EDGE = [[9, 10], [9, 11], [9, 12], [10, 9], [10, 10], [10, 11], [10, 12], [11, 9], [11, 10], [12, 9]];
const UL_UP = [[8, 10], [8, 11], [8, 12], [9, 9], [9, 13]];
const UL_LEFT = [[10, 8], [11, 8], [12, 8], [13, 9]];
const UL_SHAPES = [
  [...UL_OLD_EDGE.slice(0, 7), ...UL_UP],                // a row taller
  [[10, 9], [11, 9], [12, 9], ...UL_LEFT],                // a column wider
  [...UL_OLD_EDGE, ...UL_UP, ...UL_LEFT],                 // both
  [...UL_OLD_EDGE, ...UL_UP, ...UL_LEFT, [7, 11]],        // both, with a pointed tip
];
const TOP_TIP = [[7, 16], [6, 17], [6, 18]];
const LR_SPUR = [[21, 23], [22, 23]];
const GRADIENTS = [
  (d) => (d < 5.6 ? '4' : '5'),
  (d) => (d < 6.2 ? '4' : '5'),
  (d) => (d < 6.8 ? '4' : '5'),
  (d) => (d < 4.9 ? '3' : d < 6.8 ? '4' : '5'),
];

/** Variant v (0-63) of the small flower, as 32 rows: the upper-left petal is v & 3, the spur bit 2,
 *  the top tip bit 3, the gradient bits 4-5. */
export function miniFlowerRows(v) {
  if (!Number.isInteger(v) || v < 0 || v >= MINI_FLOWER_VARIANTS) throw new Error(`a small-flower variant is 0-${MINI_FLOWER_VARIANTS - 1}`);
  const g = MINI_FLOWER_ROWS.map((r) => [...r]);
  const put = (cells, h) => { for (const [r, c] of cells) g[r][c] = h; };
  put(ROUND_CENTRE, '3');
  put(CRISP, '6');
  put(UL_SHAPES[v & 3], '5');
  if (v & 8) put(TOP_TIP, '5');
  if (v & 4) put(LR_SPUR, '8');
  const field = fieldOf(g.map((r) => r.join('')));
  const isField = (r, c) => r < 0 || r > 31 || c < 0 || c > 31 || field[32 * r + c];
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) {
    if (!field[32 * r + c] && '345'.includes(g[r][c]) && (isField(r - 1, c) || isField(r + 1, c) || isField(r, c - 1) || isField(r, c + 1))) g[r][c] = '6';
  }
  const shade = GRADIENTS[(v >> 4) & 3];
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) if (g[r][c] === '5') g[r][c] = shade(Math.hypot(c - 16, (r - 15.5) * 1.45));
  return g.map((r) => r.join(''));
}

export const SEAL_COVERS = {
  flower: { rows: MATHCASTLES_DREAMS.p6454.rows, p: 0.15, frame: 64, size: null },
  miniflower: { rows: MINI_FLOWER_ROWS, p: 0.5, frame: 96, size: 96 },
};
// frame: the largest grain frame the cover holds (its text capacity, seal.js grainTextCapacity);
// size: the frame every seal in it uses (null: the smallest that fits).
export const coverForMode = (mode) => (mode === 'sealed' ? 'miniflower' : 'flower');

/** The outer field: the 8s connected to the border (4-neighbour flood fill), one flag per cell. */
export function fieldOf(rows) {
  const g = rows.join('');
  const field = new Array(1024).fill(false);
  const stack = [];
  for (let i = 0; i < 32; i++) stack.push([0, i], [31, i], [i, 0], [i, 31]);
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r < 0 || r > 31 || c < 0 || c > 31) continue;
    const i = 32 * r + c;
    if (field[i] || g[i] !== '8') continue;
    field[i] = true;
    stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
  }
  return field;
}

/** A random number in [0, 1) from the platform's CSPRNG. */
export function freshRandom() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

/**
 * A cover to seal into: the drawing (for the small flower, a random one of its variants) with its
 * field speckled (rnd() < p turns an 8 into a 7), and alt[c], the digit field cell c may become
 * (8 <-> 7), null for every other cell. Also returns the drawing before the speckle and its variant.
 */
export function grainCover(name, rnd = freshRandom) {
  const { p } = SEAL_COVERS[name];
  const variant = name === 'miniflower' ? Math.min(MINI_FLOWER_VARIANTS - 1, Math.floor(rnd() * MINI_FLOWER_VARIANTS)) : null;
  const rows = variant === null ? SEAL_COVERS[name].rows : miniFlowerRows(variant);
  const field = fieldOf(rows);
  const hm = rows.join('').split('').map((v, i) => (field[i] && rnd() < p ? '7' : v));
  return { heightmap: hm.join(''), alt: hm.map((v, i) => (field[i] ? (v === '8' ? 7 : 8) : null)), drawing: rows.join(''), variant };
}
