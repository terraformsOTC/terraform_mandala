'use client';

import { useMemo } from 'react';

// Renders the on-chain HTML inside a sandboxed iframe with our mandala cells
// substituted in. Inherits font, colors, and CSS animations from the contract
// output exactly — no re-implementation.

export default function ParcelPreview({ animData, heightmap, previewMode = 'on', width = 388, height = 560 }) {
  const srcDoc = useMemo(() => {
    if (!animData?.html || !heightmap) return null;
    return buildPreviewHtml(animData, heightmap, previewMode);
  }, [animData, heightmap, previewMode]);

  if (!srcDoc) {
    return (
      <div
        className="bg-placeholder flex items-center justify-center text-xs opacity-50"
        style={{ width, height }}
      >
        no preview
      </div>
    );
  }

  return (
    <iframe
      title="parcel preview"
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      width={width}
      height={height}
      style={{ border: 'none', background: animData?.bg || '#000' }}
    />
  );
}

// previewMode toggles the v2 renderer's ANTENNA variable (the radial spire pattern):
//   'on'  — force ANTENNA=1 in the script.
//   'off' — force ANTENNA=0 in the script.
// V0-renderer parcels have no ANTENNA variable, so the toggle has no effect there;
// the iframe just plays the legacy v0 daydream animation either way.
function buildPreviewHtml(animData, heightmap, previewMode = 'on') {
  const { html, chars, status } = animData;
  const cells = new Array(1024);
  for (let i = 0; i < 1024; i++) {
    const cls = heightToClass(heightmap.charCodeAt(i) - 48);
    const ch = chars[cls] ?? '&#160;';
    cells[i] = `<p class='${cls}'>${ch}</p>`;
  }
  const cellsHtml = cells.join('');
  let out = html.replace(
    /(<div class='r'[^>]*>)[\s\S]*?(<\/div>\s*<\/div>\s*<\/foreignObject>)/,
    `$1${cellsHtml}$2`,
  );
  // Terrain parcels (status 0) run MODE=0 (terrain renderer) on-chain.
  // Patch to MODE=1 so the preview shows the daydream animation regardless.
  if (status === 0) {
    out = out.replace(/let\s+MODE\s*=\s*0\b/, 'let MODE=1');
  }
  // Force ANTENNA to the requested state regardless of parcel status, so the
  // toggle works for Dreaming/Terraformed parcels too. No-op on v0 scripts.
  if (previewMode === 'on') {
    out = out.replace(/let\s+ANTENNA\s*=\s*0\b/, 'let ANTENNA=1');
  } else {
    out = out.replace(/let\s+ANTENNA\s*=\s*1\b/, 'let ANTENNA=0');
  }
  return out;
}

const HEIGHT_TO_CLASS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'i'];
function heightToClass(d) {
  return HEIGHT_TO_CLASS[d] || 'a';
}
