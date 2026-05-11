import { getContract, getV2RendererContract } from './contract.js';

// Global seed is a contract constant after reveal — cache indefinitely.
let _globalSeed = null;
async function globalSeed() {
  if (_globalSeed != null) return _globalSeed;
  _globalSeed = await getContract().seed();
  return _globalSeed;
}

// tokenToPlacement is also permanent per token — cache indefinitely.
const _placementCache = new Map();
async function tokenPlacement(tokenId) {
  if (_placementCache.has(tokenId)) return _placementCache.get(tokenId);
  const p = await getContract().tokenToPlacement(tokenId);
  _placementCache.set(tokenId, p);
  return p;
}

// Fetch the v2 renderer's HTML for any token regardless of its on-chain renderer
// index. Always passes status=1 (Daydream) so the preview shows the v2 animation.
// yearsOfDecay is permanently 0 (dreamers > 500 since 2022). canvasData is empty
// because v0 tokens have no committed canvas, and we're simulating daydream mode.
export async function fetchV2TokenHTML(tokenId) {
  const key = `v2:${tokenId}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const [seed, placement] = await Promise.all([globalSeed(), tokenPlacement(tokenId)]);
  const html = await getV2RendererContract().tokenHTML(
    1,         // status: force Daydream
    placement,
    seed,
    0,         // yearsOfDecay: permanently 0
    [],        // canvasData: empty (no committed heightmap)
  );
  cacheSet(key, html);
  return html;
}

// LRU cache. tokenHTML output depends on token state (changes when a dream is
// committed/erased), so we use a short TTL rather than caching indefinitely.
const CACHE_MAX = 200;
const CACHE_TTL_MS = 60_000;
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, ts: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export async function fetchTokenHTML(tokenId) {
  const key = String(tokenId);
  const hit = cacheGet(key);
  if (hit) return hit;
  const c = getContract();
  const html = await c.tokenHTML(tokenId);
  cacheSet(key, html);
  return html;
}

// Extract the rendering palette from raw on-chain HTML.
//   colors: { a: '#xxxxxx', ..., j: '#...' }
//   chars:  { a: '𓁹', b: '.', ..., j: '&#160;' }   (raw HTML entities preserved)
//   bg:     '#xxxxxx'                              (background-color of .r)
//   seed, resource, direction: numbers parsed from <script>
export function extractAnimData(html) {
  const colors = {};
  for (const m of html.matchAll(/\.([a-j])\{color:(#[0-9a-fA-F]+)/g)) {
    colors[m[1]] = m[2];
  }
  const bgMatch = html.match(/\.r\{background-color:(#[0-9a-fA-F]+)/);
  const bg = bgMatch ? bgMatch[1] : null;

  const chars = {};
  for (const m of html.matchAll(/<p class='([a-j])'>([^<]*)<\/p>/g)) {
    if (chars[m[1]] === undefined) chars[m[1]] = m[2];
  }

  const seed = num(html.match(/(?:const|var|let)\s+SEED\s*=\s*(\d+)/) || html.match(/SEED=(\d+)/));
  const biome = num(html.match(/(?:const|var|let)\s+BIOME\s*=\s*(\d+)/) || html.match(/BIOME=(\d+)/));
  const resource = num(html.match(/(?:const|var|let)\s+RESOURCE\s*=\s*(\d+)/));
  const direction = num(html.match(/(?:const|var|let)\s+DIRECTION\s*=\s*(\d+)/));

  // BLADE is computed at runtime: bladeRailSequencer[(BIOME+SEED) % len]
  // We reconstruct it here from the static array in the script.
  let blade = null;
  const bladeArrMatch = html.match(/bladeRailSequencer=(\[[\s\S]*?\])/);
  if (bladeArrMatch && seed != null && biome != null) {
    try {
      const blades = JSON.parse(bladeArrMatch[1]);
      blade = blades[(biome + seed) % blades.length] ?? null;
    } catch { /* malformed array — leave null */ }
  }

  // CHROMA is a static string constant (single or double quoted)
  const chroma = str(html.match(/CHROMA=['"]([^'"]+)['"]/));

  // Pre-v2 tokens (no Version trait) ship the legacy short renderer in their
  // tokenHTML; V=2.0 tokens ship the longer v2 renderer that defines
  // BIOMECODE and the radial dist() formula. Use BIOMECODE as the cheap
  // signal for "this parcel has the v2 daydream code path available".
  const hasV2Renderer = html.includes('BIOMECODE');

  return { colors, bg, chars, seed, resource, direction, blade, chroma, hasV2Renderer };
}

function num(m) {
  return m ? Number(m[1]) : null;
}

function str(m) {
  return m ? m[1] : null;
}
