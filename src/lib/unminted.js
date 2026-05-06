// Unminted parcels (token IDs 9912–11104) don't exist on-chain so the contract
// has no `tokenHTML` to fetch. The Estimator API has the per-parcel animation
// data baked from terrafans (chars, colors, font, animClasses) and exposes it
// at /unminted/search?id=<unmintedId>. We fetch that and synthesize a static
// HTML structurally identical to the contract's tokenHTML output, so the
// existing iframe + cell-substitution path in ParcelPreview just works.
//
// The synthesized HTML uses CSS keyframe color cycling for animation (the
// "v0" style). It does not embed the v2 daydream JS renderer, so unminted
// parcels show the same v0 fallback note as pre-v2 minted parcels.

const ESTIMATOR_API_URL = process.env.ESTIMATOR_API_URL || 'https://terraform-estimator.onrender.com';
const TOTAL_MINTED = 9911;

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

  const res = await fetch(`${ESTIMATOR_API_URL}/unminted/search?id=${id}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`estimator unminted lookup failed (${res.status})`);
  }
  const data = await res.json();
  if (!data?.animData) throw new Error('no animation data for this unminted parcel');

  const html = synthHtml(data.animData);
  const result = {
    html,
    chars: data.animData.chars || {},
    bg: data.animData.colors?.bg || data.animData.colors?.j || '#000',
    traits: data.traits,
  };
  cacheSet(key, result);
  return result;
}

// Synthesize a tokenHTML-like document that ParcelPreview's existing
// regexes can splice cells into. Mirrors the on-chain tokenHTML shape
// closely so cell substitution and (no-op for unminted) MODE patches work.
function synthHtml(anim) {
  const { colors = {}, chars = {}, animClasses = [], fontData, fontSize = 12, fontWeight, grid = '' } = anim;
  const bg = colors.bg || colors.j || colors.a || '#000';

  const fontFace = fontData
    ? `@font-face{font-family:'MathcastlesRemix-Regular';font-display:block;src:url(data:application/font-woff2;charset=utf-8;base64,${fontData}) format('woff');}`
    : '';

  const classColorRules = Object.entries(colors)
    .filter(([cls]) => /^[a-j]$/.test(cls))
    .map(([cls, c]) => `.${cls}{color:${c};}`)
    .join('');

  // 10-stop palette cycle covering whatever class colors are defined; classes
  // without a colour get skipped.
  const stops = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    .map((cls, i) => (colors[cls] ? `${i * 10}%{color:${colors[cls]};}` : ''))
    .filter(Boolean)
    .join('');

  const animRules = animClasses
    .map((a) => `.${a.cls}{animation:x ${a.duration}ms ${a.delay}ms linear alternate both infinite;}`)
    .join('');

  const fontWeightRule = fontWeight ? `font-weight:${fontWeight};` : '';

  const cells = grid
    .split('')
    .map((cls) => `<p class='${cls}'>${chars[cls] ?? '&#160;'}</p>`)
    .join('');

  return `<html><head><meta charset='UTF-8'>
<style>html,body,svg{margin:0;padding:0;height:100%;text-align:center;}</style>
</head><body>
<svg version='2.0' encoding='utf-8' viewBox='0 0 388 560' preserveAspectRatio='xMidYMid' xmlns:xlink='http://www.w3.org/1999/xlink' xmlns='http://www.w3.org/2000/svg'>
<style>
${fontFace}
.meta{width:388px;height:560px;}
.r{box-sizing:border-box;width:388px;height:560px;padding:24px;font-size:${fontSize}px;${fontWeightRule}display:grid;grid-template-columns:repeat(32, 3%);grid-template-rows:repeat(32, 16px);grid-gap:0px;justify-content:space-between;background-color:${bg};}
p{font-family:'MathcastlesRemix-Regular',monospace;margin:0;text-align:center;display:flex;justify-content:center;align-items:center;}
${classColorRules}
@keyframes x{${stops}}
${animRules}
</style>
<foreignObject x='0' y='0' width='388' height='560'>
<div class='meta' xmlns='http://www.w3.org/1999/xhtml'>
<div class='r'>${cells}</div>
</div>
</foreignObject>
</svg>
</body></html>`;
}
