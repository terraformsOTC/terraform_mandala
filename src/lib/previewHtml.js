import { isOriginStatus } from './originGlyphs.js';

// What the contract draws for each heightmap digit: classes a-i are heights 0-8,
// and 9 is class j, which stays empty for the whole animation. tokenCharacters and
// the on-chain script both treat it that way, so the preview must too.
const HEIGHT_TO_CLASS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const EMPTY = '&#160;';

// Renders whichever HTML the API returned (v0 or v2, chosen via ?renderer=v0|v2)
// with the mandala's cells in place of the parcel's, so it shows what tokenHTML would
// return once this heightmap is committed.
//
// On v2, MODE is the mode a commit leaves the parcel in: terraformed (2), or origin
// terraformed (4) for an origin parcel, whose extra glyph set depends on it. The v2
// HTML for these differs from a daydream's only in `let MODE=N`.
//
// v0 stays in a daydream mode: its animation runs unconditionally and a parcel must be
// on v2 to commit, so that view is a look at the old renderer, not a commit preview.
export function buildPreviewHtml(animData, heightmap) {
  const { html, renderer } = animData;
  const chars = cellChars(animData);
  const cells = new Array(1024);
  for (let i = 0; i < 1024; i++) {
    const cls = HEIGHT_TO_CLASS[heightmap.charCodeAt(i) - 48] || 'a';
    cells[i] = `<p class='${cls}'>${cls === 'j' ? EMPTY : chars[cls] ?? EMPTY}</p>`;
  }
  let out = html.replace(
    /(<div class='r'[^>]*>)[\s\S]*?(<\/div>\s*<\/div>\s*<\/foreignObject>)/,
    `$1${cells.join('')}$2`,
  );
  const origin = isOriginStatus(animData.status);
  const mode = renderer === 'v0' ? (origin ? 3 : 1) : origin ? 4 : 2;
  out = out.replace(/\blet\s+MODE\s*=\s*\d+\b/, `let MODE=${mode}`);
  return out;
}

// The parcel's antenna as its v2 HTML sets it (`let ANTENNA=0|1`): 'on', 'off', or null
// when the HTML has none (v0). An antenna is switched on-chain (see /antenna); a v2
// parcel without one animates differently, so the designer can preview either.
export function antennaOf(animData) {
  const m = animData?.html?.match(/\blet\s+ANTENNA\s*=\s*(\d+)/);
  if (!m) return null;
  return Number(m[1]) > 0 ? 'on' : 'off';
}

// The parcel data with its antenna switched for viewing (James, 2026-11-12). Only the
// script's ANTENNA changes — the preview and the GIF export (canvasRenderer reads ANTENNA
// from the same HTML) then animate as the parcel would with its antenna that way.
export function withAntenna(animData, antenna) {
  const own = antennaOf(animData);
  if (!own || (antenna !== 'on' && antenna !== 'off') || antenna === own) return animData;
  return {
    ...animData,
    html: animData.html.replace(/\blet\s+ANTENNA\s*=\s*\d+/, `let ANTENNA=${antenna === 'on' ? 1 : 0}`),
  };
}

// The API reads the parcel with an empty canvas on v2, whose cells are all class a, so
// only `chars.a` comes back. BIOMECODE holds the parcel's nine glyphs, a to i.
function cellChars({ chars, biomecode }) {
  if (!biomecode) return chars;
  const glyphs = Array.from(biomecode);
  if (glyphs.length !== 9) return chars;
  const out = { ...chars };
  for (let i = 0; i < 9; i++) out[HEIGHT_TO_CLASS[i]] = out[HEIGHT_TO_CLASS[i]] ?? glyphs[i];
  return out;
}
