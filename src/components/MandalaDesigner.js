'use client';

import { useMemo, useState } from 'react';
import { generateMandala, DEFAULTS } from '@/lib/mandala';
import MandalaControls from './MandalaControls';
import HeightmapInspector from './HeightmapInspector';
import ParcelPreview from './ParcelPreview';
import DreamActions from './DreamActions';
import { randomSeed } from '@/lib/seedrandom';

const PREVIEW_MODES = [
  { id: 'v0',        label: 'v0' },
  { id: 'v2',        label: 'v2' },
  { id: 'v2antenna', label: 'v2 + antenna' },
];

export default function MandalaDesigner({
  animData,
  params,
  onParamsChange,
  walletAddress,
  onTxConfirmed,
}) {
  const [previewMode, setPreviewMode] = useState('v2antenna');

  const generated = useMemo(() => {
    try {
      return generateMandala(params);
    } catch (err) {
      return { error: err.message, heightmap: null };
    }
  }, [params]);

  return (
    <div className="grid gap-8 mt-2" style={{ gridTemplateColumns: 'minmax(320px, 640px) 1fr' }}>
      <div className="flex flex-col gap-4">
        <h2 className="text-lg opacity-90">[animation controls]</h2>
        <MandalaControls params={params} onChange={onParamsChange} />
        <HeightmapInspector heightmap={generated.heightmap} />
        <DreamActions
          animData={animData}
          walletAddress={walletAddress}
          heightmap={generated.heightmap}
          onConfirmed={onTxConfirmed}
        />
        {generated.error && (
          <p className="text-xs" style={{ color: '#f87171' }}>
            generator error: {generated.error}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3 items-start">
        <h2 className="text-lg opacity-90">[preview — #{animData?.tokenId}]</h2>
        <p className="text-xs opacity-50">
          Rendered using the parcel&rsquo;s onchain zone, biome, and chroma traits. Terrain mode
          parcels are simulated in daydream mode.
        </p>

        <div className="flex flex-col gap-1">
          <span className="text-xs opacity-60 uppercase tracking-wider">renderer</span>
          <div className="flex gap-2">
            {PREVIEW_MODES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="btn-primary btn-sm text-xs"
                style={{ opacity: previewMode === id ? 1 : 0.5 }}
                onClick={() => setPreviewMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {animData?.hasV2Renderer === false && (
            <p className="text-xs opacity-40 mt-1">
              {animData?.isUnminted ? 'Unminted parcel uses' : 'This parcel uses'} the v0 onchain
              renderer — v2 modes preview the animation style only.
            </p>
          )}
        </div>

        <ParcelPreview
          animData={animData}
          heightmap={generated.heightmap}
          previewMode={previewMode}
        />
      </div>
    </div>
  );
}

export function defaultParams() {
  return {
    seed: randomSeed(),
    algorithm: DEFAULTS.algorithm,
    variance: DEFAULTS.variance,
    peakHeight: DEFAULTS.peakHeight,
    startValue: DEFAULTS.startValue,
    rotationalOrder: DEFAULTS.rotationalOrder,
    minHeight: DEFAULTS.minHeight,
    ringCount: DEFAULTS.ringCount,
    terraceCount: DEFAULTS.terraceCount,
    smoothing: DEFAULTS.smoothing,
  };
}
