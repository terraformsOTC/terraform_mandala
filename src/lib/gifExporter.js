// Encode the parcel preview animation as a GIF via canvas re-render +
// gifenc. See canvasRenderer.js for the animation model — this file is
// just the driver.

import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { prepareRenderer, renderFrame } from './canvasRenderer.js';

export const DEFAULT_GIF_OPTS = {
  // 2× the iframe's 388×560 outer box. renderFrame scales padding and font
  // size from those reference dimensions, so cell geometry stays correct.
  // Indexed-palette compression keeps file size sub-linear in pixel count for
  // the Mandala's flat-color cells — usually ~2× the file size of 1× output.
  width: 776,
  height: 1120,
  fps: 12,
  durationSec: 5,
  // Simulated "page time" at frame 0. Offset into the animation so the GIF
  // captures all CSS-animated classes mid-cycle (their delays are 0/2/4/6 s
  // for the typical Terraforms renderer; starting at 8 s places everyone
  // past their delay and into a meaningful color phase).
  startTimeMs: 8000,
};

// Twitter's GIF upload limit. Exceeded GIFs are auto-shrunk by reducing
// canvas resolution (duration/fps are never touched).
const TWITTER_MAX_BYTES = 15 * 1024 * 1024;

// Auto-shrink floor: 1× the iframe reference dimensions.
// Going below this makes the export worse quality than the live preview.
const MIN_GIF_WIDTH = 388;

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Encode one pass at the given canvas dimensions. `state` is dimension-
// independent (fonts + parsed animation data) and is reused across retries.
async function encodeGifBlob({
  state,
  heightmap,
  width,
  height,
  fps,
  durationSec,
  startTimeMs,
  onProgress,
}) {
  const totalFrames = Math.max(2, Math.round(fps * durationSec));
  const delay = Math.round(1000 / fps);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Sample 4 evenly-spaced frames to build the palette. The CSS keyframes
  // interpolate linearly between stops, so a single-frame palette would miss
  // intermediate colors that appear later. Sampling across the loop captures
  // the full spectrum of interpolated colors.
  const sampleStride = Math.max(1, Math.floor(totalFrames / 4));
  const sampleBufs = [];
  for (let f = 0; f < totalFrames; f += sampleStride) {
    const timeMs = startTimeMs + (f * 1000) / fps;
    renderFrame(ctx, state, heightmap, timeMs, { width, height });
    sampleBufs.push(new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data));
  }
  const combined = new Uint8ClampedArray(sampleBufs.reduce((s, b) => s + b.length, 0));
  let off = 0;
  for (const b of sampleBufs) { combined.set(b, off); off += b.length; }
  const palette = quantize(combined, 256);

  const gif = GIFEncoder();

  for (let f = 0; f < totalFrames; f++) {
    const timeMs = startTimeMs + (f * 1000) / fps;
    renderFrame(ctx, state, heightmap, timeMs, { width, height });
    const imgData = ctx.getImageData(0, 0, width, height);
    const indexed = applyPalette(imgData.data, palette);
    gif.writeFrame(indexed, width, height, { palette, delay });
    if (onProgress) onProgress((f + 1) / totalFrames);
    if (f % 4 === 3) await tick();
  }

  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/**
 * Export the parcel animation as a GIF, auto-shrinking canvas resolution if
 * the first encode exceeds the Twitter 15 MB limit.
 *
 * Duration and fps are never altered — only pixel dimensions are reduced.
 * Up to 3 encode attempts are made; if the floor (1× reference size) is
 * reached before hitting the limit the best result is returned anyway.
 *
 * Returns { blob, width, height, reducedResolution }.
 * `reducedResolution` is true whenever a retry was needed.
 *
 * Callbacks:
 *   onProgress(0..1)  — called each frame during encoding (resets to 0 on retry)
 *   onRetry({ attempt, width, height, prevSizeKb })  — called before each retry
 */
export async function exportGif({
  animData,
  heightmap,
  tokenId,
  options,
  onProgress,
  onRetry,
}) {
  const opts = { ...DEFAULT_GIF_OPTS, ...(options || {}) };
  const { fps, durationSec, startTimeMs } = opts;
  const maxBytes = opts.maxBytes ?? TWITTER_MAX_BYTES;

  let width = opts.width;
  let height = opts.height;

  // Compute the exact font size renderFrame will use so we prime FontFace at
  // the right (family, size) tuple — otherwise the very first frame can still
  // render with monospace fallback while the browser loads the right size.
  // Fonts are re-used as-is for smaller retry passes; document.fonts caches
  // them regardless of the px size requested after the initial load.
  const cellH = (height - 2 * (24 * (height / 560))) / 32;
  const renderFontPx = Math.max(6, Math.round(cellH * (14 / 16)));
  // status 3 = Origin: triggers the extra origin glyph set in the renderer so
  // the GIF matches the live preview (which forces MODE=3 for origin parcels).
  const state = await prepareRenderer(animData?.html, {
    primeFontPx: renderFontPx,
    isOrigin: animData?.status === 3,
  });

  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const blob = await encodeGifBlob({
      state,
      heightmap,
      width,
      height,
      fps,
      durationSec,
      startTimeMs,
      onProgress,
    });

    const withinLimit = blob.size <= maxBytes;
    const atFloor = width <= MIN_GIF_WIDTH;

    if (withinLimit || atFloor || attempt === MAX_ATTEMPTS) {
      return { blob, width, height, reducedResolution: attempt > 1 };
    }

    // Over limit — derive the new scale factor.
    //
    // Pixel count scales as width × height, so halving pixels halves raw data
    // (GIF LZW compression varies, but the correlation is tight for these
    // flat-color frames). sqrt converts the area ratio to a linear scale.
    // The 0.93 margin absorbs rounding and compression variance so we don't
    // land just over the limit again after resizing.
    const scale = Math.sqrt(maxBytes / blob.size) * 0.93;
    width = Math.max(MIN_GIF_WIDTH, Math.round((width * scale) / 2) * 2); // snap to even px
    // Preserve the original target aspect ratio (not accumulated per-retry).
    height = Math.round((opts.height / opts.width) * width);
    height = Math.round(height / 2) * 2; // snap to even px

    if (onRetry) onRetry({ attempt, width, height, prevSizeKb: Math.round(blob.size / 1024) });
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
