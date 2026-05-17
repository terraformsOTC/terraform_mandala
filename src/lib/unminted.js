// Unminted parcels (token IDs 9912–11104) don't exist on-chain so the contract
// has no `tokenHTML` to fetch, and we can't derive a `placement` value to pass
// directly to the v2 renderer. The Estimator API has the per-parcel animation
// data (chars, colors, seed, biome, zone, chroma) baked from terrafans.
//
// To force unminted parcels into the v2 daydream render with ANTENNA=1 just
// like minted parcels, we:
//   1. Fetch a v2 renderer "template" HTML from any minted token (cached).
//   2. Patch the template's class colors, background, @keyframes palette
//      cycle, and JS constants (SEED, BIOME, ZONE, CHROMA, BIOMECODE) with
//      the unminted parcel's trait values.
//   3. Return the patched HTML. ParcelPreview substitutes cells in as usual,
//      and the embedded v2 JS runs terraLoop with MODE=1/ANTENNA=1.

import { fetchV2TokenHTML } from './tokenHTML.js';

const ESTIMATOR_API_URL = process.env.ESTIMATOR_API_URL || 'https://terraform-estimator.onrender.com';
const TOTAL_MINTED = 9911;

// Any minted v2 parcel works as the template — its placement-specific values
// get patched out before returning. Picked an arbitrary mid-range mint.
const V2_TEMPLATE_TOKEN_ID = 1627;

// Per-biome font-size in px. The v2 contract picks a font-size for each biome
// (the BIOMECODE glyphs are designed at biome-specific sizes so the resulting
// p-tag fills its cell). Without this, every unminted parcel rendered at the
// template's font-size (14px for biome 89) regardless of biome — biomes that
// need 22px+ rendered at half size. Derived by sampling minted parcels via
// the contract; gaps (73/74/77/78 + 92-99) fall back to BIOME_FONT_SIZE_DEFAULT.
const BIOME_FONT_SIZE_DEFAULT = 14;
const BIOME_FONT_SIZE = {
  0: 27, 1: 18, 2: 18, 3: 18, 4: 26, 5: 23, 6: 23, 7: 18, 8: 22, 9: 18,
  10: 18, 11: 18, 12: 22, 13: 18, 14: 17, 15: 18, 16: 18, 17: 26, 18: 14, 19: 18,
  20: 20, 21: 20, 22: 22, 23: 18, 24: 13, 25: 20, 26: 22, 27: 22, 28: 22, 29: 22,
  30: 20, 31: 22, 32: 15, 33: 15, 34: 18, 35: 24, 36: 23, 37: 14, 38: 18, 39: 18,
  40: 16, 41: 20, 42: 25, 43: 14, 44: 15, 45: 16, 46: 12, 47: 12, 48: 12, 49: 18,
  50: 15, 51: 16, 52: 16, 53: 16, 54: 11, 55: 12, 56: 15, 57: 12, 58: 14, 59: 14,
  60: 16, 61: 16, 62: 13, 63: 13, 64: 14, 65: 12, 66: 13, 67: 11, 68: 12, 69: 12,
  70: 10, 71: 9, 72: 9, 75: 12, 76: 14, 79: 12,
  80: 12, 81: 14, 82: 14, 83: 12, 84: 14, 85: 15, 86: 17, 87: 22, 88: 17, 89: 14,
  90: 14, 91: 14,
};

const CACHE_MAX = 200;
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, ts: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

let _v2Template = null;
let _v2TemplateExpiry = 0;
const V2_TEMPLATE_TTL_MS = 60 * 60_000; // v2 template HTML is state-independent
async function v2Template() {
  if (_v2Template && Date.now() < _v2TemplateExpiry) return _v2Template;
  _v2Template = await fetchV2TokenHTML(V2_TEMPLATE_TOKEN_ID);
  _v2TemplateExpiry = Date.now() + V2_TEMPLATE_TTL_MS;
  return _v2Template;
}

export function isUnminted(tokenId) {
  return tokenId > TOTAL_MINTED && tokenId <= 11104;
}

export function unmintedIdFor(tokenId) {
  return tokenId - TOTAL_MINTED;
}

export async function fetchUnmintedAnimData(tokenId) {
  const id = unmintedIdFor(tokenId);
  const key = String(tokenId);
  const hit = cacheGet(key);
  if (hit) return hit;

  const [estimator, template] = await Promise.all([
    fetchEstimator(id),
    v2Template(),
  ]);
  if (!estimator?.animData) throw new Error('no animation data for this unminted parcel');

  const html = patchV2Template(template, estimator);

  const palette = {};
  for (const [k, v] of Object.entries(estimator.animData.colors || {})) {
    if (CLASS_KEY.test(k) && HEX_COLOR.test(v)) palette[k] = v;
  }
  const result = {
    html,
    chars: estimator.animData.chars || {},
    bg: estimator.animData.colors?.bg || estimator.animData.colors?.j || '#000',
    colors: palette,
    direction: 0,
    traits: estimator.traits,
  };
  cacheSet(key, result);
  return result;
}

async function fetchEstimator(id) {
  const res = await fetch(`${ESTIMATOR_API_URL}/unminted/search?id=${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`estimator unminted lookup failed (${res.status})`);
  return res.json();
}

// Validators for Estimator API payload — all inputs flow into an iframe srcDoc,
// so anything that could break out of CSS rules, attribute quoting, or HTML
// element structure must be rejected. Dashes and spaces ARE allowed in glyphs
// (the v2 contract's own BIOMECODE arrays contain dashes for some biomes) —
// JS-literal safety for BIOMECODE goes through jsLit, not this regex.
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const CLASS_KEY = /^[a-j]$/;
const SAFE_CHAR = /^[^<>'"\\ ]{0,12}$/;
const SAFE_IDENT = /^[A-Za-z0-9_-]{1,32}$/;
const SAFE_BASE64 = /^[A-Za-z0-9+/=]+$/;
const MAX_FONT_BYTES = 256 * 1024;

function safeColor(c, fallback) {
  return typeof c === 'string' && HEX_COLOR.test(c) ? c : fallback;
}
function safeUint(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}
function safeChar(s) {
  return typeof s === 'string' && SAFE_CHAR.test(s) ? s : '&#160;';
}
function safeIdent(s, fallback = '') {
  return typeof s === 'string' && SAFE_IDENT.test(s) ? s : fallback;
}

// Decode an HTML entity to a raw char (for inclusion in a JS string literal).
function decodeEntity(raw) {
  if (raw == null) return ' ';
  if (raw === '&#160;' || raw === '&nbsp;') return ' ';
  const dec = String(raw).match(/^&#(\d+);$/);
  if (dec) return String.fromCharCode(Number(dec[1]));
  const hex = String(raw).match(/^&#x([0-9a-fA-F]+);$/i);
  if (hex) return String.fromCharCode(parseInt(hex[1], 16));
  return String(raw);
}

// JS-string-literal escape for a single (possibly multi-codepoint) char. Forbid
// control characters to keep the iframe srcDoc well-formed.
function jsLit(c) {
  let out = '';
  for (const ch of String(c)) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) continue;
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else out += ch;
  }
  return out || ' ';
}

// Patch a v2 renderer template HTML so it renders the unminted parcel's
// traits and palette. Keeps the template's font, animation class rules,
// keyframe structure, and full daydream/terraLoop JS intact.
function patchV2Template(template, est) {
  const anim = est.animData || {};
  const traits = est.traits || {};
  const colors = anim.colors || {};
  const chars = anim.chars || {};

  // Sanitise inputs before any string interpolation.
  const safeColors = {};
  for (const cls of 'abcdefghij') {
    const c = safeColor(colors[cls], null);
    if (c) safeColors[cls] = c;
  }
  const bg = safeColor(colors.bg, safeColors.j || safeColors.a || '#000');

  const safeChars = {};
  for (const cls of 'abcdefghij') safeChars[cls] = safeChar(chars[cls]);

  const trSeed = safeUint(traits.seed, 0, 99999, 0);
  const trBiome = safeUint(traits.biome, 0, 255, 0);
  const trZone = safeIdent(traits.zone, 'Plain');
  const trChroma = safeIdent(traits.chroma, 'Mono');

  let out = template;

  // 1. Replace static .X{color:#YYY} class rules.
  for (const cls of 'abcdefghij') {
    if (!safeColors[cls]) continue;
    out = out.replace(
      new RegExp(`\\.${cls}\\{color:#[0-9a-fA-F]+;?\\}`),
      `.${cls}{color:${safeColors[cls]};}`,
    );
  }

  // 2. Replace .r background-color (keep all other .r rule contents).
  out = out.replace(
    /(\.r\{[^}]*?background-color:)#[0-9a-fA-F]+/,
    `$1${bg}`,
  );

  // 2b. Replace .r font-size with the unminted biome's value. The v2 contract
  // picks font-size per biome so BIOMECODE glyphs fill their cell — without
  // this patch, biomes that should render at 22-27px were stuck at 14px (the
  // template's biome-89 value), giving the "glyphs are too small" symptom.
  const biomeFs = BIOME_FONT_SIZE[trBiome] ?? BIOME_FONT_SIZE_DEFAULT;
  out = out.replace(
    /(\.r\{[^}]*?font-size:)\d+px/,
    `$1${biomeFs}px`,
  );

  // 3. Rewrite @keyframes x with a 10-stop cycle through the unminted palette.
  // Mirror the v2 contract's structure: 0%..90% in 10% steps mapping to a..j.
  const stops = 'abcdefghij'.split('').map((cls, i) => {
    const c = safeColors[cls] || bg;
    return `${i * 10}%{color:${c};}`;
  }).join('');
  out = out.replace(/@keyframes x\{[^@<]*?\}\s*\}/, `@keyframes x{${stops}}`);

  // 4. Patch JS constants. The v2 template uses `const SEED=N;` (capitalised)
  // and `let X=...;` for the rest.
  out = out.replace(/const\s+SEED\s*=\s*\d+/, `const SEED=${trSeed}`);
  out = out.replace(/let\s+BIOME\s*=\s*\d+/, `let BIOME=${trBiome}`);
  out = out.replace(/let\s+ZONE\s*=\s*'[^']*'/, `let ZONE='${trZone}'`);
  out = out.replace(/let\s+CHROMA\s*=\s*'[^']*'/, `let CHROMA='${trChroma}'`);

  // 5. Replace BIOMECODE array with chars-derived literal (indices 0..8 map
  //    to classes a..i; the v2 contract emits 9-entry arrays).
  const biomecodeArr = 'abcdefghi'.split('').map((cls) => decodeEntity(safeChars[cls]));
  const biomecodeJs = '[' + biomecodeArr.map((c) => `'${jsLit(c)}'`).join(',') + ']';
  out = out.replace(/let\s+BIOMECODE\s*=\s*\[[^\]]+\]/, `let BIOMECODE=${biomecodeJs}`);

  // 6. Swap in the unminted parcel's MathcastlesRemix-Regular font. The
  // contract's embedded font is general-purpose; terrafans bakes a
  // biome-specific font for each unminted parcel that shapes the BIOMECODE
  // chars to full-cell — without this swap, biomes whose chars the contract
  // font doesn't shape fall back to monospace and render at half-cell size.
  if (typeof anim.fontData === 'string'
      && anim.fontData.length > 0
      && anim.fontData.length <= MAX_FONT_BYTES
      && SAFE_BASE64.test(anim.fontData)) {
    out = out.replace(
      /(@font-face\s*\{font-family:'MathcastlesRemix-Regular';[^}]*src:url\()data:application\/font-woff2;charset=utf-8;base64,[A-Za-z0-9+/=]+(\))/,
      `$1data:application/font-woff2;charset=utf-8;base64,${anim.fontData}$2`,
    );
  }

  return out;
}
