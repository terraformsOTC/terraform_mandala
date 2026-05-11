import { getContract } from './contract.js';

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

  const seed = num(html.match(/(?:const|var|let)\s+SEED\s*=\s*(\d+)/));
  const resource = num(html.match(/(?:const|var|let)\s+RESOURCE\s*=\s*(\d+)/));
  const direction = num(html.match(/(?:const|var|let)\s+DIRECTION\s*=\s*(\d+)/));
  const blade = str(html.match(/(?:const|var|let)\s+BLADE\s*=\s*["']([^"'\n]+)["']/));
  const chroma = str(html.match(/(?:const|var|let)\s+CHROMA\s*=\s*["']([^"'\n]+)["']/));

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
