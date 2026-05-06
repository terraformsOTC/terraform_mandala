'use client';

import { useEffect, useMemo, useState } from 'react';
import { generateMandala, DEFAULTS } from '@/lib/mandala';
import { validate } from '@/lib/heightmap';
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

  const validation = useMemo(
    () => (generated.heightmap ? validate(generated.heightmap) : null),
    [generated.heightmap],
  );

  return (
    <div className="grid gap-8 mt-2" style={{ gridTemplateColumns: 'minmax(280px, 360px) 1fr' }}>
      <div className="flex flex-col gap-4">
        <h2 className="text-lg opacity-90">[animation controls]</h2>
        <MandalaControls params={params} onChange={onParamsChange} />
        <HeightmapInspector heightmap={generated.heightmap} validation={validation || {}} />
        {generated.error && (
          <p className="text-xs" style={{ color: '#f87171' }}>
            generator error: {generated.error}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3 items-start">
        <h2 className="text-lg opacity-90">[preview — #{animData?.tokenId}]</h2>
        <p className="text-xs opacity-50 max-w-md">
          Rendered with this parcel&rsquo;s on-chain font and palette. Preview only — no on-chain
          action is taken.
        </p>
        <ParcelPreview animData={animData} heightmap={generated.heightmap} />
      </div>
    </div>
  );
}

export function defaultParams() {
  return {
    seed: randomSeed(),
    variance: DEFAULTS.variance,
    peakHeight: DEFAULTS.peakHeight,
    startValue: DEFAULTS.startValue,
    rotationalOrder: DEFAULTS.rotationalOrder,
  };
}
