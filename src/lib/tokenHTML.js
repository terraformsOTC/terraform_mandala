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

  return { colors, bg, chars, seed, resource, direction };
}

function num(m) {
  return m ? Number(m[1]) : null;
}

// Replace the contract's rendered cell grid with a custom one.
// `gridClasses` is a 1024-long array of class letters (output of
// heightmapToGrid). `chars` is the extracted per-class char map. Cells whose
// class has no char fall back to '&#160;' (non-breaking space).
export function replaceCells(html, gridClasses, chars) {
  if (gridClasses.length !== 1024) {
    throw new Error(`replaceCells: expected 1024 classes, got ${gridClasses.length}`);
  }
  const cellsHtml = gridClasses
    .map((cls) => `<p class='${cls}'>${chars[cls] ?? '&#160;'}</p>`)
    .join('');
  // The <div class='r'> wraps all 1024 <p> cells. Replace its inner content.
  return html.replace(
    /(<div class='r'[^>]*>)[\s\S]*?(<\/div>\s*<\/div>\s*<\/foreignObject>)/,
    `$1${cellsHtml}$2`,
  );
}
