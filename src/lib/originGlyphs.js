// Origin parcels (status 3) don't animate the blade. The v0/v2 renderers
// replace it with a seed-derived glyph set drawn from a fixed 28-entry unicode
// table (the same table the contract calls `uni`). This module reproduces that
// selection so the meta panel can display the glyphs that actually appear —
// the origin analog of the BLADE row.
//
// Selection (mirrors the contract's isOrigin branch):
//   seed <= 9000 : a single set, makeSet(UNI[seed % 28])
//   seed >  9000 : all 28 sets concatenated (and the animation also speeds up;
//                  seed > 9950 additionally enters "overdrive")
//
// NB: makeSet uses String.fromCharCode, which truncates code points > 0xFFFF to
// their low 16 bits — exactly as the contract does — so the characters here
// match the ones the renderer paints, glyph-for-glyph.

// On-chain status enum: 0=Terrain, 1=Daydream, 2=Terraformed,
// 3=OriginDaydream, 4=OriginTerraformed. Both origin variants render the blade
// replaced by the seed-derived glyph set (the on-chain script gates this on
// `isOrigin = MODE==3 || MODE==4`, with identical charset construction for the
// two). One predicate so callers can't special-case 3 and forget 4 again.
export const isOriginStatus = (status) => status === 3 || status === 4;

export const ORIGIN_UNI = [
  9600, 9610, 9620, 3900, 9812, 9120, 9590, 143345, 48, 143672, 143682, 143692, 143702,
  820, 8210, 8680, 9573, 142080, 142085, 142990, 143010, 143030, 9580, 9540, 1470,
  143762, 143790, 143810,
];

function makeSet(start) {
  let out = '';
  for (let i = 0; i < 10; i++) out += String.fromCharCode(start + i);
  return out;
}

// The seed-derived glyph alphabet for an origin parcel. Returns '' for a
// non-finite seed. The returned string is the distinct character set the
// animation cycles through (excluding BIOMECODE, which the BIOME row covers).
export function originGlyphSet(seed) {
  const s = Number(seed);
  if (!Number.isFinite(s)) return '';
  const n = Math.floor(s);
  if (n > 9000) return ORIGIN_UNI.map(makeSet).join('');
  return makeSet(ORIGIN_UNI[n % ORIGIN_UNI.length]);
}
