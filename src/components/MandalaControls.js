'use client';

import { randomSeed } from '@/lib/seedrandom';

export default function MandalaControls({ params, onChange }) {
  const update = (patch) => onChange({ ...params, ...patch });

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

      <Slider
        label="variance"
        value={params.variance}
        min={1}
        max={4}
        onChange={(variance) => update({ variance })}
        hint="step size of the random walk"
      />
      <Slider
        label="peak height"
        value={params.peakHeight}
        min={1}
        max={9}
        onChange={(peakHeight) => update({ peakHeight })}
        hint="max value (caps tallest cells)"
      />
      <Slider
        label="start value"
        value={params.startValue}
        min={0}
        max={9}
        onChange={(startValue) => update({ startValue })}
        hint="where the walk begins"
      />

      <Field label="rotational order">
        <div className="flex gap-2">
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

function Slider({ label, value, min, max, onChange, hint }) {
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
      {hint && <span className="text-xs opacity-40">{hint}</span>}
    </Field>
  );
}
