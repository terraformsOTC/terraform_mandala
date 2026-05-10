'use client';

import { useMemo } from 'react';

// Renders the on-chain HTML inside a sandboxed iframe with our mandala cells
// substituted in. Inherits font, colors, and CSS animations from the contract
// output exactly — no re-implementation.

export default function ParcelPreview({ animData, heightmap, previewMode = 'v2antenna', width = 388, height = 560 }) {
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

// previewMode controls which animation path the iframe renders:
//   'v0'       — patch MODE to daydream; leave ANTENNA as-is (0 for terrain parcels).
//                v0-token scripts show the legacy daydream; v2-token scripts show the
//                non-antenna branch. This is the on-chain reality for old parcels.
//   'v2'       — patch MODE to daydream; force ANTENNA=0. Shows the v2 daydream
//                animation without the radial spire/antenna pattern.
//   'v2antenna' — patch MODE to daydream; force ANTENNA=1. Shows the full v2 radial
//                antenna pattern. Default, and recommended for v2-renderer tokens.
function buildPreviewHtml(animData, heightmap, previewMode = 'v2antenna') {
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
  // Patch to MODE=1 so all three preview modes show the daydream animation.
  if (status === 0) {
    out = out.replace(/let\s+MODE\s*=\s*0\b/, 'let MODE=1');
  }
  // ANTENNA controls the radial spire pattern in v2-renderer scripts.
  // Apply the chosen override regardless of parcel status so the toggle works
  // for Dreaming/Terraformed parcels too.
  if (previewMode === 'v2antenna') {
    out = out.replace(/let\s+ANTENNA\s*=\s*0\b/, 'let ANTENNA=1');
  } else if (previewMode === 'v2') {
    out = out.replace(/let\s+ANTENNA\s*=\s*1\b/, 'let ANTENNA=0');
  }
  // 'v0': leave ANTENNA at whatever the token script declares.
  return out;
}

const HEIGHT_TO_CLASS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'i'];
function heightToClass(d) {
  return HEIGHT_TO_CLASS[d] || 'a';
}
