'use client';

import { useMemo } from 'react';

// Renders the on-chain HTML inside a sandboxed iframe with our mandala cells
// substituted in. Inherits font, colors, and CSS animations from the contract
// output exactly — no re-implementation.

export default function ParcelPreview({ animData, heightmap, width = 388, height = 560 }) {
  const srcDoc = useMemo(() => {
    if (!animData?.html || !heightmap) return null;
    return buildPreviewHtml(animData, heightmap);
  }, [animData, heightmap]);

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

function buildPreviewHtml(animData, heightmap) {
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
  // Terrain mode (status 0) uses a different in-script renderer that flows
  // chars across the grid, distorting the mandala. Patch the script to take
  // the daydream branch instead — visually identical to terraformed mode for
  // our purposes (cell animation only; no pointer interactions).
  //
  // For Version=2.0 tokens the v2 daydream renderer also gates the radial
  // ring pattern behind ANTENNA > 0. Most Terrain tokens have Antenna=Off
  // (ANTENNA=0 in the script), which would silently fall through to the
  // non-radial branch. Force ANTENNA=1 too so users always see the v2
  // radial pattern when previewing.
  //
  // Pre-v2 tokens (no Version trait, no `BIOMECODE` constant in their
  // script) don't have the v2 renderer in their tokenHTML at all — the MODE
  // patch alone falls through to the v0 daydream path for those, which is
  // a known limitation pending a template-substitution fix.
  if (status === 0) {
    out = out.replace(/let\s+MODE\s*=\s*0\b/, 'let MODE=1');
    out = out.replace(/let\s+ANTENNA\s*=\s*0\b/, 'let ANTENNA=1');
  }
  return out;
}

const HEIGHT_TO_CLASS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'i'];
function heightToClass(d) {
  return HEIGHT_TO_CLASS[d] || 'a';
}
