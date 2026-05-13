'use client';

import { randomSeed } from '@/lib/seedrandom';

export default function MandalaControls({ params, onChange }) {
  const update = (patch) => onChange({ ...params, ...patch });
  const isClassic = params.algorithm === 'classic';
  const isRings = params.algorithm === 'rings';
  const isTemple = params.algorithm === 'temple';

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

      <Field label="pattern">
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary btn-sm text-sm flex-1"
            style={{ opacity: isClassic ? 1 : 0.5 }}
            onClick={() => update({ algorithm: 'classic' })}
          >
            classic
          </button>
          <button
            type="button"
            className="btn-primary btn-sm text-sm flex-1"
            style={{ opacity: isRings ? 1 : 0.5 }}
            onClick={() => update({ algorithm: 'rings' })}
          >
            rings
          </button>
          <button
            type="button"
            className="btn-primary btn-sm text-sm flex-1"
            style={{ opacity: isTemple ? 1 : 0.5 }}
            onClick={() => update({ algorithm: 'temple' })}
          >
            temple
          </button>
        </div>
      </Field>

      <div className="flex flex-col gap-2">
        <Slider
          label="peak height"
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

        {isRings && (
          <Slider
            label="ring count"
            value={params.ringCount}
            min={2}
            max={20}
            onChange={(ringCount) => update({ ringCount })}
          />
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

      {isClassic && (
        <Field label="rotational order">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.rotationalOrder === 2 ? 1 : 0.5 }}
              onClick={() => update({ rotationalOrder: 2 })}
            >
              2-fold
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.rotationalOrder === 4 ? 1 : 0.5 }}
              onClick={() => update({ rotationalOrder: 4 })}
            >
              4-fold
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.rotationalOrder === 8 ? 1 : 0.5 }}
              onClick={() => update({ rotationalOrder: 8 })}
            >
              8-fold
            </button>
          </div>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children, tight = false }) {
  return (
    <div className={`flex flex-col ${tight ? 'gap-0' : 'gap-1'}`}>
      <span className="text-xs opacity-60 uppercase tracking-wider">{label}</span>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, onChange }) {
  return (
    <Field label={`${label} — ${value}`} tight>
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
