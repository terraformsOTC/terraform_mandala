'use client';

import { useState } from 'react';
import { encode, asciiViz } from '@/lib/heightmap';

export default function HeightmapInspector({ heightmap, validation }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);

  if (!heightmap) return null;

  const symmetries = [
    { label: 'vertical', ok: validation.vertical_sym },
    { label: 'horizontal', ok: validation.horizontal_sym },
    { label: '180° rotation', ok: validation.rotational_sym },
  ];

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
  const copyRaw = async () => {
    await navigator.clipboard.writeText(heightmap);
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 1200);
  };

  return (
    <div className="flex flex-col gap-3 mt-4">
      <div className="flex flex-wrap gap-3 text-xs">
        {symmetries.map((s) => (
          <span key={s.label} className="opacity-80">
            <span style={{ color: s.ok ? '#34d399' : '#f87171' }}>{s.ok ? '✓' : '✗'}</span>{' '}
            {s.label}
          </span>
        ))}
      </div>

      <details className="text-xs opacity-80">
        <summary className="cursor-pointer">[ascii viz]</summary>
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
                <button type="button" className="btn-primary btn-sm text-xs" onClick={copyRaw}>
                  {copiedRaw ? '[copied!]' : '[copy 1024-char string]'}
                </button>
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
