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

// Always renders the v2 daydream animation with antenna ON, regardless of the
// parcel's on-chain status or renderer version. MODE is forced to 1 (daydream)
// and ANTENNA is forced to 1 for all parcels. V0-renderer parcels (no MODE/ANTENNA
// variables in their script) will play their CSS animation as-is — v0 support
// will be wired in a subsequent pass.
function buildPreviewHtml(animData, heightmap) {
  const { html, chars } = animData;
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
  // Force daydream mode regardless of on-chain status (terrain=0, terra=2, etc.)
  out = out.replace(/\blet\s+MODE\s*=\s*\d+\b/, 'let MODE=1');
  // Force antenna ON — no-op on v0 scripts that lack this variable
  out = out.replace(/\blet\s+ANTENNA\s*=\s*\d+\b/, 'let ANTENNA=1');
  return out;
}

const HEIGHT_TO_CLASS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'i'];
function heightToClass(d) {
  return HEIGHT_TO_CLASS[d] || 'a';
}
