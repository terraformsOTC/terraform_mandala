'use client';

import { randomSeed } from '@/lib/seedrandom';

export default function MandalaControls({ params, onChange }) {
  const update = (patch) => onChange({ ...params, ...patch });
  const isClassic = params.algorithm === 'classic';
  const isRings = params.algorithm === 'rings';
  const isTemple = params.algorithm === 'temple';
  const isWheel = isRings && params.ringStyle === 'wheel';
  const isHorus = isRings && params.ringStyle === 'horus';

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
        {/* The eye sets its own three heights below; peak and min do not apply to it. */}
        {!isHorus && (
          <>
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
          </>
        )}

        {isHorus && (
          <>
            <Slider label="line height" value={params.horusLine} min={0} max={9} onChange={(horusLine) => update({ horusLine })} />
            <Slider label="edge height" value={params.horusEdge} min={0} max={9} onChange={(horusEdge) => update({ horusEdge })} />
            <Slider label="ground height" value={params.horusGround} min={0} max={9} onChange={(horusGround) => update({ horusGround })} />
          </>
        )}

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

        {isRings && !isWheel && !isHorus && (
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

      {isRings && (
        <Field label="ring style">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: !isWheel && !isHorus ? 1 : 0.5 }}
              onClick={() => update({ ringStyle: 'concentric' })}
            >
              concentric
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: isWheel ? 1 : 0.5 }}
              onClick={() => update({ ringStyle: 'wheel' })}
              title="after parcel #7463: a spoked wheel, 4-fold rotational symmetry"
            >
              wheel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: isHorus ? 1 : 0.5 }}
              onClick={() => update({ ringStyle: 'horus' })}
              title="the Eye of Horus, copied from a dreamt heightmap"
            >
              horus
            </button>
          </div>
        </Field>
      )}

      {isHorus && (
        <Field label="grain">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.grain === 0 ? 1 : 0.5 }}
              onClick={() => update({ grain: 0 })}
            >
              off
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.grain === 1 ? 1 : 0.5 }}
              onClick={() => update({ grain: 1 })}
            >
              on
            </button>
          </div>
        </Field>
      )}

      {isHorus && (
        <Field label="eye">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.eye === 'horus' ? 1 : 0.5 }}
              onClick={() => update({ eye: 'horus' })}
            >
              horus
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.eye === 'ra' ? 1 : 0.5 }}
              onClick={() => update({ eye: 'ra' })}
              title="the mirror image: the Eye of Ra faces the other way"
            >
              ra
            </button>
          </div>
        </Field>
      )}

      {isWheel && (
        <Field label="spin">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.spin === 'ccw' ? 1 : 0.5 }}
              onClick={() => update({ spin: 'ccw' })}
            >
              left
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.spin === 'cw' ? 1 : 0.5 }}
              onClick={() => update({ spin: 'cw' })}
            >
              right
            </button>
          </div>
        </Field>
      )}

      {isTemple && (
        <Field label="architectural inspiration">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.templeStyle === 'cathedral' ? 1 : 0.5 }}
              onClick={() => update({ templeStyle: 'cathedral' })}
            >
              cathedral
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.templeStyle === 'wat' ? 1 : 0.5 }}
              onClick={() => update({ templeStyle: 'wat' })}
            >
              wat
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-sm flex-1"
              style={{ opacity: params.templeStyle === 'ziggurat' ? 1 : 0.5 }}
              onClick={() => update({ templeStyle: 'ziggurat' })}
            >
              ziggurat
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
