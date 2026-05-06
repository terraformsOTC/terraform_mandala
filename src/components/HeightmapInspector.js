'use client';

import { useState } from 'react';
import { encode, asciiViz } from '@/lib/heightmap';

export default function HeightmapInspector({ heightmap, validation }) {
  const [copiedAll, setCopiedAll] = useState(false);

  if (!heightmap) return null;

  let encoded = null;
  try {
    encoded = encode(heightmap);
  } catch {
    encoded = null;
  }

  const arrayString = encoded ? '[' + encoded.join(',') + ']' : null;

  const copyArray = async () => {
    if (!arrayString) return;
    await navigator.clipboard.writeText(arrayString);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1200);
  };

  return (
    <div className="flex flex-col gap-3 mt-4">
      <details className="text-xs opacity-80">
        <summary className="cursor-pointer">[ascii visualisation]</summary>
        <pre className="mt-2 leading-none text-[10px] opacity-90" style={{ fontFamily: 'monospace' }}>
{asciiViz(heightmap)}
        </pre>
      </details>

      <details className="text-xs opacity-80">
        <summary className="cursor-pointer">[uint256[16] for commitDreamToCanvas]</summary>
        <div className="mt-2 flex flex-col gap-2">
          {encoded ? (
            <>
              <pre
                className="text-[10px] whitespace-pre-wrap break-all opacity-90 p-2"
                style={{
                  fontFamily: 'monospace',
                  border: '1px solid rgba(232,232,232,0.15)',
                  maxHeight: '180px',
                  overflowY: 'auto',
                }}
              >
                {encoded.join(',\n')}
              </pre>
              <div className="flex gap-2">
                <button type="button" className="btn-primary btn-sm text-xs" onClick={copyArray}>
                  {copiedAll ? '[copied!]' : '[copy array]'}
                </button>
                <a
                  href="https://etherscan.io/token/0x4e1f41613c9084fdb9e34e11fae9412427480e56#writeContract"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary btn-sm text-xs no-underline inline-flex items-center"
                >
                  [etherscan ↗]
                </a>
              </div>
            </>
          ) : (
            <span className="opacity-60">cannot encode — heightmap invalid</span>
          )}
        </div>
      </details>
    </div>
  );
}
