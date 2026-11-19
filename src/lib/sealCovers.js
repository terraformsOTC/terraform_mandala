// The drawings a grain seal hides in (James, 2026-11-19: "We are only going with messages encoded
// in grain"; "keep the flower the same size as before for unencrypted messages, and only use the
// smaller one when a user wants to encrypt something, so in effect we have 2 different, but similar
// looking flower drawings"). Both are parcel #6454's flower (glyphs › mathcastles › #6454): its outer
// field, the 8s that reach the border, is speckled with 7s, and a seal moves some speckles by one
// height (seal.js, GRAIN SEALS). The flower itself never changes.
//   flower      the flower as dreamt, speckled at p = 0.15: inscriptions (up to 53 bytes, in a frame
//               of up to 64), commitments, plain hashes and lists (a 48-byte frame). 583 field cells.
//   miniflower  the same flower at 70% (~/ops/mandala-explore/miniflower, mini70-clean), whose wider
//               field (808 cells) holds a sealed message of up to 53 bytes. Speckled at p = 0.5, so a
//               seal leaves the speckle as dense as it was, and always sealed in a 96-byte frame, so
//               every sealed flower looks alike and reads alike whatever the message's length.
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
 * A cover to seal into: the drawing with its field speckled (rnd() < p turns an 8 into a 7), and
 * alt[c], the digit field cell c may become (8 <-> 7), null for every other cell.
 */
export function grainCover(name, rnd = freshRandom) {
  const { rows, p } = SEAL_COVERS[name];
  const field = fieldOf(rows);
  const hm = rows.join('').split('').map((v, i) => (field[i] && rnd() < p ? '7' : v));
  return { heightmap: hm.join(''), alt: hm.map((v, i) => (field[i] ? (v === '8' ? 7 : 8) : null)) };
}
