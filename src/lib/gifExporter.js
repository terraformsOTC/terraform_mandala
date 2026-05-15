// Encode the parcel preview animation as a GIF via canvas re-render +
// gifenc. See canvasRenderer.js for the animation model — this file is
// just the driver.

import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { prepareRenderer, renderFrame } from './canvasRenderer.js';

export const DEFAULT_GIF_OPTS = {
  width: 384,
  height: 560,
  fps: 12,
  durationSec: 5,
  // Simulated "page time" at frame 0. Offset into the animation so the GIF
  // captures all CSS-animated classes mid-cycle (their delays are 0/2/4/6 s
  // for the typical Terraforms renderer; starting at 8 s places everyone
  // past their delay and into a meaningful color phase).
  startTimeMs: 8000,
};

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function exportGif({ animData, heightmap, tokenId, options, onProgress }) {
  const opts = { ...DEFAULT_GIF_OPTS, ...(options || {}) };
  const { width, height, fps, durationSec, startTimeMs } = opts;
  const totalFrames = Math.max(2, Math.round(fps * durationSec));
  const delay = Math.round(1000 / fps);

  const state = await prepareRenderer(animData?.html);

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
