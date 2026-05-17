'use client';

import { useEffect, useMemo } from 'react';
import { generateMandala, DEFAULTS } from '@/lib/mandala';
import MandalaControls from './MandalaControls';
import HeightmapInspector from './HeightmapInspector';
import ParcelPreview from './ParcelPreview';
import ExportGifButton from './ExportGifButton';
import { randomSeed } from '@/lib/seedrandom';

// On-chain font shapes the BIOMECODE/BLADE glyphs into full-cell decorative
// forms. Without it, biomes whose BIOMECODE chars sit in obscure Unicode
// blocks (e.g. 33, 53) render as the system-font missing-glyph placeholder
// (□) in the meta panel.
const META_GLYPH_FONT = `'MathcastlesRemix-Regular', 'MathcastlesRemix-Extra', monospace`;

export default function MandalaDesigner({ animData, params, onParamsChange }) {
  const generated = useMemo(() => {
    try {
      return generateMandala(params);
    } catch (err) {
      return { error: err.message, heightmap: null };
    }
  }, [params]);

  // Make MathcastlesRemix-Regular/Extra available to the meta panel by
  // extracting the @font-face rules from the parcel's HTML and injecting
  // them into document.head. Idempotent per parcel — re-injection replaces
  // any prior data URL so unminted-vs-minted (which carry slightly different
  // font bytes) stay in sync with whatever parcel is currently selected.
  useEffect(() => {
    if (!animData?.html) return;
    injectParcelFonts(animData.html);
  }, [animData?.html]);

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
          These previews are generated using the parcel&rsquo;s onchain zone, biome, and chroma
          traits with the v2 contracts and antenna on as presets, regardless of the onchain
          settings the parcel uses. This means your parcel may look different here.
        </p>

        {animData && <ParcelMeta animData={animData} />}

        <ParcelPreview
          animData={animData}
          heightmap={generated.heightmap}
        />
        <ExportGifButton
          animData={animData}
          heightmap={generated.heightmap}
          tokenId={animData?.tokenId}
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
          <span
            className="opacity-80 whitespace-nowrap overflow-hidden"
            style={{ fontFamily: META_GLYPH_FONT }}
          >
            {animData.blade}
          </span>
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
          <span className="opacity-80">
            {animData.biomecode ? (
              <>
                <span style={{ fontFamily: META_GLYPH_FONT }}>{animData.biomecode}</span>
                {` (${animData.biome})`}
              </>
            ) : animData.biome}
          </span>
        </div>
      )}
      {animData.seed != null && (
        <div className="flex items-baseline gap-1.5">
          <span className="opacity-50 uppercase tracking-wider shrink-0">SEED:</span>
          <span className="opacity-80">{animData.seed}</span>
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

// Pull every @font-face declaration out of the parcel HTML (both the static
// CSS one for MathcastlesRemix-Regular and the script-template-literal one
// for MathcastlesRemix-Extra) and write them into a single style tag in the
// document head. Format hint is dropped — the on-chain HTML declares woff
// but the bytes are woff2, and strict browsers reject the mismatch.
const FONT_FACE_RE = /@font-face\s*\{([^}]+)\}/g;
const FONT_FAMILY_RE = /font-family\s*:\s*['"]?([^'";]+)['"]?/;
const FONT_URL_RE = /url\(\s*(data:[^)]+)\s*\)/;
function injectParcelFonts(html) {
  if (typeof document === 'undefined') return;
  const faces = [];
  for (const match of html.matchAll(FONT_FACE_RE)) {
    const body = match[1];
    const fam = body.match(FONT_FAMILY_RE);
    const url = body.match(FONT_URL_RE);
    if (fam && url && !faces.some((f) => f.family === fam[1].trim())) {
      faces.push({ family: fam[1].trim(), url: url[1].trim() });
    }
  }
  if (!faces.length) return;
  let el = document.getElementById('parcel-fonts');
  if (!el) {
    el = document.createElement('style');
    el.id = 'parcel-fonts';
    document.head.appendChild(el);
  }
  el.textContent = faces
    .map((f) => `@font-face{font-family:'${f.family}';font-display:block;src:url(${f.url});}`)
    .join('\n');
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
    templeStyle: DEFAULTS.templeStyle,
  };
}
