'use client';

import { useMemo } from 'react';
import { generateMandala, DEFAULTS } from '@/lib/mandala';
import MandalaControls from './MandalaControls';
import HeightmapInspector from './HeightmapInspector';
import ParcelPreview from './ParcelPreview';
import { randomSeed } from '@/lib/seedrandom';

export default function MandalaDesigner({ animData, params, onParamsChange }) {
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
          parcels have been simulated in daydream mode to faithfully represent what they would
          look like if terraformed.
        </p>
        {animData?.status === 0 && animData?.hasV2Renderer === false && (
          <p className="text-xs opacity-50" style={{ color: '#f6c177' }}>
            Note:{' '}
            {animData?.isUnminted
              ? 'unminted parcels render with the v0 contract renderer by default,'
              : 'this parcel uses the v0 contract renderer,'}{' '}
            so the preview reverts to the legacy daydream animation rather than the distinctive
            v2 radial &ldquo;antenna&rdquo; pattern.{' '}
            {animData?.isUnminted
              ? 'Once minted, the owner can update to v2 at any time.'
              : 'The owner can update this parcel to v2 at any time.'}
          </p>
        )}
        <ParcelPreview animData={animData} heightmap={generated.heightmap} />
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
    smoothing: DEFAULTS.smoothing,
  };
}
