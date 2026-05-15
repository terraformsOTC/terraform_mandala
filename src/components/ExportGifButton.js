'use client';

import { useState } from 'react';
import { exportGif, downloadBlob } from '@/lib/gifExporter';

export default function ExportGifButton({ animData, heightmap, tokenId }) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [sizeKb, setSizeKb] = useState(null);
  const [error, setError] = useState(null);

  const onClick = async () => {
    if (!animData || !heightmap) return;
    setPhase('encoding');
    setProgress(0);
    setSizeKb(null);
    setError(null);
    try {
      const blob = await exportGif({
        animData,
        heightmap,
        tokenId,
        onProgress: (p) => setProgress(p),
      });
      setSizeKb(Math.round(blob.size / 1024));
      downloadBlob(blob, `mandala-${tokenId || 'preview'}.gif`);
      setPhase('done');
    } catch (err) {
      setError(err?.message || 'gif export failed');
      setPhase('error');
    }
  };

  const busy = phase === 'encoding';
  const label = busy
    ? `[encoding ${Math.round(progress * 100)}%…]`
    : phase === 'done'
      ? `[export gif — last: ${sizeKb}kb]`
      : '[export gif]';

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
      {error && (
        <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>
      )}
    </div>
  );
}
