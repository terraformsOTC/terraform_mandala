'use client';

import { useState } from 'react';
import { exportGif, downloadBlob } from '@/lib/gifExporter';

export default function ExportGifButton({ animData, heightmap, tokenId }) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [sizeKb, setSizeKb] = useState(null);
  const [reducedRes, setReducedRes] = useState(null); // e.g. "572×826" when auto-shrunk
  const [error, setError] = useState(null);

  const onClick = async () => {
    if (!animData || !heightmap) return;
    setPhase('encoding');
    setProgress(0);
    setSizeKb(null);
    setReducedRes(null);
    setError(null);
    try {
      const result = await exportGif({
        animData,
        heightmap,
        tokenId,
        onProgress: (p) => setProgress(p),
        onRetry: () => {
          // First encode was over 15 MB — a smaller pass is starting.
          setPhase('retrying');
          setProgress(0);
        },
      });
      const { blob, width, height, reducedResolution } = result;
      setSizeKb(Math.round(blob.size / 1024));
      if (reducedResolution) setReducedRes(`${width}×${height}`);
      downloadBlob(blob, `mandala-${tokenId || 'preview'}.gif`);
      setPhase('done');
    } catch (err) {
      setError(err?.message || 'gif export failed');
      setPhase('error');
    }
  };

  const busy = phase === 'encoding' || phase === 'retrying';

  let label;
  if (phase === 'encoding') {
    label = `[encoding ${Math.round(progress * 100)}%…]`;
  } else if (phase === 'retrying') {
    label = `[reducing size — re-encoding ${Math.round(progress * 100)}%…]`;
  } else if (phase === 'done') {
    const sizeStr = sizeKb != null ? `${sizeKb}kb` : '';
    const resStr = reducedRes ? ` @ ${reducedRes}` : '';
    label = `[export gif — last: ${sizeStr}${resStr}]`;
  } else {
    label = '[export gif]';
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="btn-primary btn-sm text-xs"
        onClick={onClick}
        disabled={busy || !animData || !heightmap}
      >
        {label}
      </button>
      {reducedRes && phase === 'done' && (
        <p className="text-xs" style={{ color: '#94a3b8' }}>
          auto-reduced to {reducedRes} for Twitter (&lt;15 MB)
        </p>
      )}
      {error && (
        <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>
      )}
    </div>
  );
}
