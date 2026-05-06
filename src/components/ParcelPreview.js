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
  const { html, chars } = animData;
  const cells = new Array(1024);
  for (let i = 0; i < 1024; i++) {
    const cls = heightToClass(heightmap.charCodeAt(i) - 48);
    const ch = chars[cls] ?? '&#160;';
    cells[i] = `<p class='${cls}'>${ch}</p>`;
  }
  const cellsHtml = cells.join('');
  return html.replace(
    /(<div class='r'[^>]*>)[\s\S]*?(<\/div>\s*<\/div>\s*<\/foreignObject>)/,
    `$1${cellsHtml}$2`,
  );
}

const HEIGHT_TO_CLASS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'i'];
function heightToClass(d) {
  return HEIGHT_TO_CLASS[d] || 'a';
}
