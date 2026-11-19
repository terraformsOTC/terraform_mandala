'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { generateMandala, DEFAULTS } from '@/lib/mandala';
import MandalaControls from './MandalaControls';
import HeightmapInspector from './HeightmapInspector';
import CommitPanel from './CommitPanel';
import ParcelPreview from './ParcelPreview';
import ExportGifButton from './ExportGifButton';
import { randomSeed } from '@/lib/seedrandom';
import { originGlyphSet, isOriginStatus } from '@/lib/originGlyphs';
import { antennaOf, withAntenna } from '@/lib/previewHtml';

// On-chain font shapes the BIOMECODE/BLADE glyphs into full-cell decorative
// forms. Without it, biomes whose BIOMECODE chars sit in obscure Unicode
// blocks (e.g. 33, 53) render as the system-font missing-glyph placeholder
// (□) in the meta panel.
const META_GLYPH_FONT = `'MathcastlesRemix-Regular', 'MathcastlesRemix-Extra', monospace`;

export default function MandalaDesigner({
  animData,
  params,
  onParamsChange,
  renderer,
  onRendererChange,
  antenna,
  onAntennaChange,
  walletAddress,
  variant = 'mandala',   // 'seal': the seal maker at /seal/make (the seal pattern alone)
}) {
  // The antenna shown: the user's choice, else the parcel's own. The preview and the GIF
  // export both get the parcel data with ANTENNA switched to match.
  const ownAntenna = antennaOf(animData);
  const shownAntenna = antenna ?? ownAntenna;
  const viewData = useMemo(() => withAntenna(animData, shownAntenna), [animData, shownAntenna]);
  // The renderer the parcel itself uses, as loaded, until a switch in the commit
  // panel changes it on-chain (then the panel reports the new one).
  const [parcelRenderer, setParcelRenderer] = useState(animData?.parcelRenderer);
  // The last commit made here ({ txHash, tokenId, heightmap }): a seal's reveal needs its transaction.
  const [lastCommit, setLastCommit] = useState(null);
  const onCommitted = useCallback((c) => setLastCommit(c), []);
  useEffect(() => setParcelRenderer(animData?.parcelRenderer), [animData?.tokenId, animData?.parcelRenderer]);
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
    <div
      className="grid gap-8 mt-2"
      // Left column is fixed at its compact width so the right column's content
      // (a long BLADE row in particular) can't push the grid around when the
      // selected parcel changes. The right column uses minmax(0, 1fr) so the
      // blade truncates via overflow-hidden instead of forcing the grid wider.
      style={{ gridTemplateColumns: '320px minmax(0, 1fr)' }}
    >
      <div className="flex flex-col gap-4">
        <h2 className="text-lg opacity-90">[animation controls]</h2>
        <MandalaControls params={params} onChange={onParamsChange} lastCommit={lastCommit} variant={variant} />
        <HeightmapInspector heightmap={generated.heightmap} />
        <CommitPanel
          tokenId={animData?.tokenId}
          heightmap={generated.heightmap}
          walletAddress={walletAddress}
          renderer={animData?.renderer}
          onRendererChange={onRendererChange}
          onParcelRendererChange={setParcelRenderer}
          onCommitted={onCommitted}
          note={params.algorithm === 'seal' && params.sealMode !== 'inscription'
            ? 'This drawing is a seal. Save its reveal file before you sign: once it is on-chain, nothing else can open or prove it.'
            : null}
        />
        {generated.error && (
          <p className="text-xs" style={{ color: '#f87171' }}>
            generator error: {generated.error}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3 items-start">
        <h2 className="text-lg opacity-90">[preview — #{animData?.tokenId}]</h2>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <RendererToggle renderer={renderer} own={parcelRenderer} onChange={onRendererChange} />
          {ownAntenna && (
            <AntennaToggle
              own={ownAntenna}
              shown={shownAntenna}
              onChange={(a) => onAntennaChange?.(a === ownAntenna ? null : a)}
            />
          )}
        </div>

        {animData && <ParcelMeta animData={animData} />}

        <ParcelPreview
          animData={viewData}
          heightmap={generated.heightmap}
        />
        <ExportGifButton
          animData={viewData}
          heightmap={generated.heightmap}
          tokenId={animData?.tokenId}
        />
      </div>
    </div>
  );
}

// Antenna on/off for the preview (v2 only). The parcel's own setting is on-chain; this
// only shows how the drawing would animate either way.
function AntennaToggle({ own, shown, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs opacity-50 uppercase tracking-wider">antenna:</span>
      <div className="flex gap-2">
        {['on', 'off'].map((a) => (
          <button
            key={a}
            type="button"
            className="btn-primary btn-sm text-xs"
            style={{ opacity: shown === a ? 1 : 0.5 }}
            disabled={shown === a}
            onClick={() => onChange?.(a)}
            title={a === own
              ? `this parcel's antenna is ${own}`
              : `preview with the antenna ${a} (this parcel's is ${own}; it is switched on-chain, see antenna info)`}
          >
            {a}
          </button>
        ))}
      </div>
      {shown !== own && <span className="text-xs opacity-50">(parcel&apos;s is {own})</span>}
    </div>
  );
}

// The renderer the preview draws with. Each parcel renders with one on-chain (`own`:
// v0, v1 or v2), and a mandala commits only under the preview of the parcel's own,
// so it looks on-chain as it did here; v0 commits since 2026-11-17 (James: some
// owners want to keep creating in the v0 style). v1 can't be previewed.
function RendererToggle({ renderer, own, onChange }) {
  const titles = {
    v0: 'the original renderer: a mandala committed to a parcel on v0 looks like this',
    v2: 'the v2 renderer: a mandala committed to a parcel on v2 looks like this',
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs opacity-50 uppercase tracking-wider">renderer:</span>
      <div className="flex gap-2">
        {['v0', 'v2'].map((r) => (
          <button
            key={r}
            type="button"
            className="btn-primary btn-sm text-xs"
            style={{ opacity: renderer === r ? 1 : 0.5 }}
            disabled={renderer === r}
            onClick={() => onChange?.(r)}
            title={own === r ? `${titles[r]} (this parcel renders with ${r})` : titles[r]}
          >
            {r}
          </button>
        ))}
      </div>
      {own && own !== renderer && <span className="text-xs opacity-50">(parcel&apos;s is {own})</span>}
    </div>
  );
}

// Describe the GLYPHS row for an origin parcel's seed-derived set. Returns
// { text, glyphFont } — glyphFont=true renders in the on-chain glyph font (real
// glyphs), false renders as plain type (a text label). Non-origin → null.
function originGlyphsRow(animData) {
  if (!isOriginStatus(animData.status)) return null;
  const seed = Number(animData.seed);
  // X-Seed parcels (seed > 9000, the on-chain isXSeed threshold) concatenate all
  // 28 unicode sets — hundreds of glyphs, far more than the row can show — so
  // label rather than list them. The 3 "godmode" origin parcels (#83/#124/#1955)
  // sit at seed >= 9970 and run the full set in overdrive; flag them distinctly.
  if (Number.isFinite(seed) && seed > 9000) {
    return { text: seed >= 9970 ? 'Godmode Full set' : 'Full set', glyphFont: false };
  }
  // seed <= 9000: a single seed-picked set — show the actual glyphs. Several uni
  // sets are Hebrew/diacritic ranges whose combining marks (\p{M}) render
  // zero-width and collapse onto their neighbours; they're blank cells in the
  // animation too, so strip them and show only the glyphs that paint. Fall back
  // to the raw set if it's entirely marks so the row never silently vanishes.
  const raw = originGlyphSet(animData.seed);
  const glyphs = raw ? (raw.replace(/\p{M}/gu, '') || raw) : null;
  return glyphs ? { text: glyphs, glyphFont: true } : null;
}

function ParcelMeta({ animData }) {
  if (!animData) return null;

  // Origin parcels (status 3 daydream / 4 terraformed) animate a seed-derived
  // glyph set in place of the blade — show it as the origin analog of the BLADE
  // row. See originGlyphsRow for the seed-range handling.
  const glyphsRow = originGlyphsRow(animData);

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
      {glyphsRow && (
        <div className="flex items-baseline gap-1.5 w-full overflow-hidden">
          <span className="opacity-50 uppercase tracking-wider shrink-0">GLYPHS:</span>
          <span
            className="opacity-80 whitespace-nowrap overflow-hidden"
            style={glyphsRow.glyphFont ? { fontFamily: META_GLYPH_FONT } : undefined}
          >
            {glyphsRow.text}
          </span>
        </div>
      )}
      {animData.zone && (
        <div className="flex items-baseline gap-1.5">
          <span className="opacity-50 uppercase tracking-wider shrink-0">ZONE:</span>
          <span className="opacity-80">{animData.zone.toUpperCase()}</span>
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
      {/* Origin parcels (status 3/4) swap the blade out for a seed-derived glyph
          set in their daydream/terraform animation, so the BLADE row above is
          real parcel metadata but never appears in the preview. Call it out. */}
      {isOriginStatus(animData.status) && (
        <p className="opacity-50 italic mt-1 w-full">
          please note that for origin daydream and origin terraform parcels, the blade
          characters do not appear in the v2 rendering and are replaced with a
          seed-derived custom glyph set.
        </p>
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
    ringStyle: DEFAULTS.ringStyle,
    glyphSet: DEFAULTS.glyphSet,
    glyphLine: DEFAULTS.glyphLine,
    glyphEdge: DEFAULTS.glyphEdge,
    glyphGround: DEFAULTS.glyphGround,
    glyphPupil: DEFAULTS.glyphPupil,
    figure: DEFAULTS.figure,
    escherDesign: DEFAULTS.escherDesign,
    escherTones: null,
    experimentalDesign: DEFAULTS.experimentalDesign,
    expShift: DEFAULTS.expShift,
    expReverse: DEFAULTS.expReverse,
    expGround: DEFAULTS.expGround,
    sealMode: DEFAULTS.sealMode,
    sealSalt: DEFAULTS.sealSalt,
    sealLayout: DEFAULTS.sealLayout,
    sealHeightmap: null,
    grain: DEFAULTS.grain,
    spokeCount: DEFAULTS.spokeCount,
    twist: DEFAULTS.twist,
    spin: DEFAULTS.spin,
  };
}
