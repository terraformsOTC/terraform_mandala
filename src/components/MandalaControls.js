'use client';

import { randomSeed } from '@/lib/seedrandom';
import {
  PATTERNS, RING_STYLES, TEMPLE_STYLES, GLYPH_SETS, GLYPH_FIGURES, FIGURE_LABELS,
  figureFor, normalizeGlyphSet,
} from '@/lib/mandala';
import { ESCHER_DESIGNS, ESCHER_CATEGORIES, escherDesignsIn, escherTones } from '@/lib/escher';

export default function MandalaControls({ params, onChange }) {
  const update = (patch) => onChange({ ...params, ...patch });
  const isClassic = params.algorithm === 'classic';
  const isRings = params.algorithm === 'rings';
  const isTemple = params.algorithm === 'temple';
  const isWheel = isRings && params.ringStyle === 'wheel';
  const isGlyphs = params.algorithm === 'glyphs';
  const isEscher = params.algorithm === 'escher';
  const escher = ESCHER_DESIGNS[params.escherDesign] ? params.escherDesign : Object.keys(ESCHER_DESIGNS)[0];
  const tones = escherTones(escher, params.escherTones);

  return (
    <div className="flex flex-col gap-4">
      <Field label="seed">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={params.seed}
            onChange={(e) => update({ seed: e.target.value })}
            className="flex-1 min-w-0"
          />
          <button
            type="button"
            className="btn-primary btn-sm text-xs"
            onClick={() => update({ seed: randomSeed() })}
            title="random seed"
          >
            ⚄
          </button>
        </div>
      </Field>

      <PatternMenu params={params} update={update} escher={escher} />

      <div className="flex flex-col gap-2">
        {/* Glyphs and Escher designs set their own heights below; peak and min do not apply. */}
        {!isGlyphs && !isEscher && (
          <>
            <Slider
              label="peak height"
              isHeight
              value={params.peakHeight}
              min={1}
              max={9}
              onChange={(peakHeight) => update({ peakHeight })}
            />
            <Slider
              label="min height"
              value={params.minHeight}
              min={0}
              max={Math.max(0, params.peakHeight - 1)}
              onChange={(minHeight) => update({ minHeight })}
            />
          </>
        )}

        {isGlyphs && (
          <>
            <Slider label="line height" isHeight value={params.glyphLine} min={0} max={9} onChange={(glyphLine) => update({ glyphLine })} />
            <Slider label="edge height" isHeight value={params.glyphEdge} min={0} max={9} onChange={(glyphEdge) => update({ glyphEdge })} />
            <Slider label="ground height" isHeight value={params.glyphGround} min={0} max={9} onChange={(glyphGround) => update({ glyphGround })} />
          </>
        )}

        {/* Contrast depends on the parcel's palette, so every tone is the user's to set. */}
        {isEscher && ESCHER_DESIGNS[escher].toneLabels.map((label, i) => (
          <Slider
            key={`${escher}-${i}`}
            label={`${label} height`}
            isHeight
            value={tones[i]}
            min={0}
            max={9}
            onChange={(v) => update({ escherTones: tones.map((t, k) => (k === i ? v : t)) })}
          />
        ))}

        {isClassic && (
          <>
            <Slider
              label="variance"
              value={params.variance}
              min={1}
              max={4}
              onChange={(variance) => update({ variance })}
            />
            <Slider
              label="start value"
              value={params.startValue}
              min={params.minHeight}
              max={params.peakHeight}
              onChange={(startValue) => update({ startValue })}
            />
          </>
        )}

        {isRings && !isWheel && (
          <Slider
            label="ring count"
            value={params.ringCount}
            min={2}
            max={20}
            onChange={(ringCount) => update({ ringCount })}
          />
        )}

        {isWheel && (
          <>
            <Slider
              label="spokes per quarter"
              value={params.spokeCount}
              min={1}
              max={5}
              onChange={(spokeCount) => update({ spokeCount })}
            />
            <Slider
              label="twist"
              value={params.twist}
              min={0}
              max={5}
              onChange={(twist) => update({ twist })}
            />
          </>
        )}

        {isTemple && (
          <Slider
            label="terrace count"
            value={params.terraceCount}
            min={2}
            max={12}
            onChange={(terraceCount) => update({ terraceCount })}
          />
        )}
      </div>

      {isGlyphs && (
        <Field label="grain">
          <Toggle
            options={[[0, 'off'], [1, 'on']]}
            value={params.grain}
            onSelect={(grain) => update({ grain })}
          />
        </Field>
      )}

      {isWheel && (
        <Field label="spin">
          <Toggle
            options={[['ccw', 'left'], ['cw', 'right']]}
            value={params.spin}
            onSelect={(spin) => update({ spin })}
          />
        </Field>
      )}
    </div>
  );
}

// The pattern menu (James, 2026-11-12): the button rows had filled the column, so the
// choices are now up to three dropdowns, each narrowing the one before —
//   classic  › symmetry (2-, 4-, 8-fold)
//   rings    › concentric / wheel
//   temple   › cathedral / wat / ziggurat
//   glyphs   › hieroglyphs › eye of horus / eye of ra / ankh / moon god / frog
//            › nazca       › hummingbird / monkey / spider / condor
//   escher   › spirals / tessellations › design
// Picking a higher level resets the levels under it to their first choice.
function PatternMenu({ params, update, escher }) {
  const opts = (values, label = (v) => v) => values.map((v) => ({ value: String(v), label: label(v) }));
  const levels = [{
    label: 'pattern',
    value: params.algorithm,
    options: opts(PATTERNS),
    onChange: (algorithm) => update({ algorithm }),
  }];

  if (params.algorithm === 'classic') {
    levels.push({
      label: 'symmetry',
      value: String(params.rotationalOrder),
      options: opts([2, 4, 8], (n) => `${n}-fold`),
      onChange: (v) => update({ rotationalOrder: Number(v) }),
    });
  } else if (params.algorithm === 'rings') {
    levels.push({
      label: 'ring style',
      value: params.ringStyle,
      options: opts(RING_STYLES),
      onChange: (ringStyle) => update({ ringStyle }),
    });
  } else if (params.algorithm === 'temple') {
    levels.push({
      label: 'architecture',
      value: params.templeStyle,
      options: opts(TEMPLE_STYLES),
      onChange: (templeStyle) => update({ templeStyle }),
    });
  } else if (params.algorithm === 'glyphs') {
    const set = normalizeGlyphSet(params.glyphSet);
    levels.push({
      label: 'glyph set',
      value: set,
      options: opts(GLYPH_SETS),
      onChange: (glyphSet) => update({ glyphSet, figure: figureFor(glyphSet, null) }),
    });
    levels.push({
      label: set === 'nazca' ? 'figure' : 'glyph',
      value: figureFor(set, params.figure),
      options: opts(GLYPH_FIGURES[set], (f) => FIGURE_LABELS[f] ?? f),
      onChange: (figure) => update({ figure }),
    });
  } else if (params.algorithm === 'escher') {
    const category = ESCHER_DESIGNS[escher].category;
    levels.push({
      label: 'category',
      value: category,
      options: opts(ESCHER_CATEGORIES),
      onChange: (c) => update({ escherDesign: escherDesignsIn(c)[0], escherTones: null }),
    });
    levels.push({
      label: 'design',
      value: escher,
      options: opts(escherDesignsIn(category), (id) => ESCHER_DESIGNS[id].label),
      onChange: (escherDesign) => update({ escherDesign, escherTones: null }),
    });
  }

  return (
    // Each dropdown is as wide as its longest choice and the row wraps, so no label is
    // cut short ("path of life", "hieroglyphs") in the narrow controls column.
    <div className="flex flex-wrap gap-2 items-end">
      {levels.map((level, i) => (
        <Field key={level.label} label={`${i > 0 ? '› ' : ''}${level.label}`} style={{ flex: '1 1 auto' }}>
          <select
            value={level.value}
            onChange={(e) => level.onChange(e.target.value)}
            aria-label={level.label}
            className="w-full min-w-0"
          >
            {level.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      ))}
    </div>
  );
}

function Toggle({ options, value, onSelect }) {
  return (
    <div className="flex gap-2">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          className="btn-primary btn-sm text-sm flex-1"
          style={{ opacity: value === v ? 1 : 0.5 }}
          onClick={() => onSelect(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children, tight = false, style }) {
  return (
    <div className={`flex flex-col ${tight ? 'gap-0' : 'gap-1'} min-w-0`} style={style}>
      <span className="text-xs opacity-60 uppercase tracking-wider truncate">{label}</span>
      {children}
    </div>
  );
}

// Height 9 draws nothing on-chain, so the label says so wherever a height can reach it.
function Slider({ label, value, min, max, onChange, isHeight = false }) {
  return (
    <Field label={`${label} — ${value}${isHeight && value === 9 ? ' (empty)' : ''}`} tight>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </Field>
  );
}
