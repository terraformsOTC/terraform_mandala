'use client';

import { randomSeed } from '@/lib/seedrandom';

export default function MandalaControls({ params, onChange }) {
  const update = (patch) => onChange({ ...params, ...patch });
  const isWalk = params.algorithm === 'walk';
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
            style={{ opacity: isWalk ? 1 : 0.5 }}
            onClick={() => update({ algorithm: 'walk' })}
          >
            walk
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

      {isWalk && (
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
          max={16}
          onChange={(ringCount) => update({ ringCount })}
        />
      )}

      {isTemple && (
        <Slider
          label="terrace count"
          value={params.terraceCount}
          min={2}
          max={9}
          onChange={(terraceCount) => update({ terraceCount })}
        />
      )}

      <Slider
        label="smoothing"
        value={params.smoothing}
        min={0}
        max={3}
        onChange={(smoothing) => update({ smoothing })}
      />

      {isWalk && (
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

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs opacity-60 uppercase tracking-wider">{label}</span>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, onChange }) {
  return (
    <Field label={`${label} — ${value}`}>
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
