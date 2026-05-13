'use client';

import { useMemo } from 'react';
import { generateMandala, DEFAULTS } from '@/lib/mandala';
import MandalaControls from './MandalaControls';
import HeightmapInspector from './HeightmapInspector';
import ParcelPreview from './ParcelPreview';
import DreamActions from './DreamActions';
import { randomSeed } from '@/lib/seedrandom';

export default function MandalaDesigner({
  animData,
  params,
  onParamsChange,
  walletAddress,
  onTxConfirmed,
}) {
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
        {/* DreamActions temporarily disabled with wallet connect */}
        {generated.error && (
          <p className="text-xs" style={{ color: '#f87171' }}>
            generator error: {generated.error}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3 items-start">
        <h2 className="text-lg opacity-90">[preview — #{animData?.tokenId}]</h2>
        <p className="text-xs opacity-50">
          Rendered using the parcel&rsquo;s onchain zone, biome, and chroma traits. Daydream mode
          with antenna, forced for all parcels regardless of on-chain renderer version.
        </p>

        {animData && <ParcelMeta animData={animData} />}

        <ParcelPreview
          animData={animData}
          heightmap={generated.heightmap}
        />
      </div>
    </div>
  );
}

function ParcelMeta({ animData }) {
  if (!animData) return null;

  return (
    <div className="flex flex-col gap-0.5 w-full text-xs" style={{ fontFamily: 'monospace' }}>
      {animData.blade && (
        <div className="flex items-baseline gap-1.5 w-full overflow-hidden">
          <span className="opacity-50 uppercase tracking-wider shrink-0">BLADE:</span>
          <span className="opacity-80 whitespace-nowrap overflow-hidden">{animData.blade}</span>
        </div>
      )}
      {animData.biomecode && (
        <div className="flex items-baseline gap-1.5">
          <span className="opacity-50 uppercase tracking-wider shrink-0">BIOMECODE:</span>
          <span className="opacity-80">{animData.biomecode}</span>
        </div>
      )}
      {animData.zone && (
        <div className="flex items-baseline gap-1.5">
          <span className="opacity-50 uppercase tracking-wider shrink-0">ZONE:</span>
          <span className="opacity-80">[{animData.zone.toUpperCase()}]</span>
        </div>
      )}
      {animData.biome != null && (
        <div className="flex items-baseline gap-1.5">
          <span className="opacity-50 uppercase tracking-wider shrink-0">BIOME:</span>
          <span className="opacity-80">{animData.biome},</span>
        </div>
      )}
      {animData.seed != null && (
        <div className="flex items-baseline gap-1.5">
          <span className="opacity-50 uppercase tracking-wider shrink-0">SEED:</span>
          <span className="opacity-80">{animData.seed},</span>
        </div>
      )}
      {animData.chroma && (
        <div className="flex items-baseline gap-1.5">
          <span className="opacity-50 uppercase tracking-wider shrink-0">CHROMA:</span>
          <span className="opacity-80">{animData.chroma}</span>
        </div>
      )}
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
    smoothing: 0,
  };
}
