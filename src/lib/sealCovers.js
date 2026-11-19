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
import { fieldOf, partsOf, withHeights, partTops, SUNFLOWER_PARTS, MINI_FLOWER_ROWS, MINI_FLOWER_VARIANTS, miniFlowerRows } from './sunflower.js';

export { fieldOf, partsOf, withHeights, partTops, SUNFLOWER_PARTS, MINI_FLOWER_ROWS, MINI_FLOWER_VARIANTS, miniFlowerRows };

export const SEAL_COVERS = {
  flower: { rows: MATHCASTLES_DREAMS.p6454.rows, p: 0.15, frame: 64, size: null },
  miniflower: { rows: MINI_FLOWER_ROWS, p: 0.5, frame: 96, size: 96 },
};
// frame: the largest grain frame the cover holds (its text capacity, seal.js grainTextCapacity);
// size: the frame every seal in it uses (null: the smallest that fits).
export const coverForMode = (mode) => (mode === 'sealed' ? 'miniflower' : 'flower');

/** A random number in [0, 1) from the platform's CSPRNG. */
export function freshRandom() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

// The parts of each cover's drawing (the sunflower's are shared by its variants).
const FLOWER_PARTS = partsOf(MATHCASTLES_DREAMS.p6454.rows);
export const partsFor = (name) => (name === 'miniflower' ? SUNFLOWER_PARTS : FLOWER_PARTS);
/** The heights each cover's parts are drawn at (petals: the flower 7, the sunflower 6; corona 4; bud 8). */
export const coverTops = (name) => partTops(name === 'miniflower' ? miniFlowerRows(0) : SEAL_COVERS.flower.rows, partsFor(name));

/**
 * A cover to seal into: the drawing (for the sunflower, a random one of its variants) at the
 * heights asked for ({ petal, corona, bud }, see withHeights), its field speckled (rnd() < p turns an 8 into
 * a 7), and alt[c], the digit field cell c may become (8 <-> 7), null for every other cell. Also
 * returns the drawing before the speckle and its variant.
 */
export function grainCover(name, rnd = freshRandom, heights = {}) {
  const { p } = SEAL_COVERS[name];
  const variant = name === 'miniflower' ? Math.min(MINI_FLOWER_VARIANTS - 1, Math.floor(rnd() * MINI_FLOWER_VARIANTS)) : null;
  const drawn = variant === null ? SEAL_COVERS[name].rows : miniFlowerRows(variant);
  const field = fieldOf(drawn);
  const rows = withHeights(drawn, field, partsFor(name), heights);
  const hm = rows.join('').split('').map((v, i) => (field[i] && rnd() < p ? '7' : v));
  return { heightmap: hm.join(''), alt: hm.map((v, i) => (field[i] ? (v === '8' ? 7 : 8) : null)), drawing: rows.join(''), variant };
}
