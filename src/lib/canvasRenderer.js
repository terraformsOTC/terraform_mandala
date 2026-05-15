// Off-iframe canvas renderer for parcel mandala animations.
//
// The on-chain HTML renders a 32×32 grid of glyphs whose colors and characters
// are driven by per-cell CSS class. To capture the preview as a GIF we re-render
// the same model on a <canvas> in the parent window, sidestepping the iframe
// sandbox entirely.
//
// Animation model: cells shift their effective height by a directional wave
// every frame. heightmap[r][c] = h → h_anim = (h + wave(r, c, t)) % 10.
// This approximates the on-chain "flowing" daydream animation.

const HEIGHT_TO_CLASS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'i'];

// direction is parsed from the on-chain HTML; 0..3 → unit vector.
const DIRECTION_VEC = {
  0: [0, 1],   // down
  1: [1, 0],   // right
  2: [0, -1],  // up
  3: [-1, 0],  // left
};

// HTML entity → string. Covers the entities the on-chain HTML actually uses
// in its chars dictionary (non-breaking space + numeric refs).
function decodeEntity(raw) {
  if (!raw) return ' ';
  if (raw === '&#160;' || raw === '&nbsp;') return ' ';
  const dec = raw.match(/^&#(\d+);$/);
  if (dec) return String.fromCharCode(Number(dec[1]));
  const hex = raw.match(/^&#x([0-9a-fA-F]+);$/i);
  if (hex) return String.fromCharCode(parseInt(hex[1], 16));
  return raw;
}

// Pull the @font-face woff2 data URL out of the on-chain HTML so we can
// register it via the FontFace API. Returns null when no font is embedded
// (some legacy renderers ship without one).
export function extractFontDataUrl(html) {
  if (!html) return null;
  const m = html.match(/url\(\s*(data:[^)]*woff2[^)]*)\s*\)/i);
  return m ? m[1].trim() : null;
}

// Load the parcel's woff2 into the document's font set under a unique family
// name (one per tokenId, so multiple parcels can coexist on the page).
// Returns the family name to use in ctx.font, or null if loading failed.
export async function loadParcelFont(html, tokenId) {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return null;
  const dataUrl = extractFontDataUrl(html);
  if (!dataUrl) return null;
  const family = `parcelFont_${tokenId}`;
  // Avoid duplicate adds across re-renders.
  for (const f of document.fonts) {
    if (f.family === family) return family;
  }
  try {
    const face = new FontFace(family, `url(${dataUrl})`);
    await face.load();
    document.fonts.add(face);
    return family;
  } catch {
    return null;
  }
}

// Paint one frame of the animation onto ctx. Caller is responsible for sizing
// the canvas and ensuring the parcel font is loaded (loadParcelFont).
export function renderFrame(ctx, {
  animData, heightmap, frame, totalFrames, width, height, fontFamily,
}) {
  const { colors, bg, chars, direction } = animData;
  const [dx, dy] = DIRECTION_VEC[direction ?? 0] || DIRECTION_VEC[0];

  // 32×32 cell grid covering the full canvas.
  const cellW = width / 32;
  const cellH = height / 32;
  // Font sized to fill cell vertically with a small inset.
  const fontPx = Math.max(6, Math.floor(cellH * 0.95));

  ctx.fillStyle = bg || '#000';
  ctx.fillRect(0, 0, width, height);

  ctx.font = `${fontPx}px ${fontFamily || 'monospace'}, monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Phase ranges 0..10 across the loop, then wraps. With direction-vec spatial
  // offset, this produces a continuous flow that re-aligns at frame=totalFrames.
  const phase = (frame / totalFrames) * 10;

  for (let r = 0; r < 32; r++) {
    for (let c = 0; c < 32; c++) {
      const h = heightmap.charCodeAt(r * 32 + c) - 48;
      if (h < 0 || h > 9) continue;
      const spatial = r * dy + c * dx;
      const rawShift = spatial + phase;
      const shift = ((Math.floor(rawShift) % 10) + 10) % 10;
      const hAnim = (h + shift) % 10;
      const cls = HEIGHT_TO_CLASS[hAnim] || 'a';
      const color = (colors && colors[cls]) || '#fff';
      const ch = decodeEntity((chars && chars[cls]) || ' ');
      ctx.fillStyle = color;
      ctx.fillText(ch, c * cellW + cellW / 2, r * cellH + cellH / 2);
    }
  }
}
