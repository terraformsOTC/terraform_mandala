// Encode the parcel preview animation as a GIF using gifenc.
//
// We render each frame on an offscreen canvas via canvasRenderer.renderFrame,
// then feed the RGBA pixels through gifenc's quantize → applyPalette →
// writeFrame pipeline. Palette is computed once on frame 0 and reused for
// every subsequent frame: the animation only cycles existing palette colors,
// so re-quantizing per frame would waste CPU and risk slight color drift.

import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { loadParcelFont, renderFrame } from './canvasRenderer.js';

export const DEFAULT_GIF_OPTS = {
  width: 384,
  height: 560,
  fps: 12,
  durationSec: 5,
};

// Yield to the event loop so the progress callback paints and we don't
// freeze the tab on slow machines.
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function exportGif({ animData, heightmap, tokenId, options, onProgress }) {
  const opts = { ...DEFAULT_GIF_OPTS, ...(options || {}) };
  const { width, height, fps, durationSec } = opts;
  const totalFrames = Math.max(2, Math.round(fps * durationSec));
  const delay = Math.round(1000 / fps);

  const fontFamily = await loadParcelFont(animData?.html, tokenId);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const gif = GIFEncoder();
  let palette = null;

  for (let f = 0; f < totalFrames; f++) {
    renderFrame(ctx, {
      animData,
      heightmap,
      frame: f,
      totalFrames,
      width,
      height,
      fontFamily,
    });
    const imgData = ctx.getImageData(0, 0, width, height);
    if (palette == null) {
      palette = quantize(imgData.data, 256);
    }
    const indexed = applyPalette(imgData.data, palette);
    gif.writeFrame(indexed, width, height, { palette, delay });
    if (onProgress) onProgress((f + 1) / totalFrames);
    // Yield every few frames so the UI stays responsive.
    if (f % 4 === 3) await tick();
  }

  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

// Trigger a browser download of the blob.
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
