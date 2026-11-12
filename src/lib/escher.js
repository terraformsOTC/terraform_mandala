// Escher-inspired heightmaps (James, 2026-11-12). Four full-canvas designs after M. C.
// Escher — whirlpools, path of life, droste, regular division — kept from a wider
// experiment and redrawn the same day with fine (one-cell) lines and ramps of heights
// rather than flat blocks: each height animates at its own phase, so a ramp makes the
// animation flow along the drawing. Ported from ~/ops/mandala-escher/escher3.py, which
// rendered every design through previewHtml.js on real parcels (stills and animated
// captures); tested cell for cell against it.
//
// Each design takes a few "tones" — line heights and the ends of its ramps — that the
// user can set, because contrast depends on the parcel's palette. 9 is an empty cell
// on-chain (dark): eyes and some segment lines use it.
//
// Geometry: a cell renders 10.6 x 16 px, so a row is 1.5 columns tall. Every design is
// drawn in "visual" units — x in columns (-16..16), y in columns too (-24..24) — so
// circles stay round. Nothing here is random: the seed is unused.

const SIDE = 32;
const ROW = 1.5;
const W = 16;
const H = 24;
const TAU = 2 * Math.PI;

// Python's floor-mod and fractional part, which the ported formulas rely on.
const mod = (a, n) => ((a % n) + n) % n;
const frac = (v) => v - Math.floor(v);
const clamp9 = (v) => Math.max(0, Math.min(9, v));

// t in [0,1) -> an integer height stepping from lo to hi inclusive (either direction).
function ramp(t, lo, hi) {
  const tt = Math.min(Math.max(t, 0), 0.999999);
  const step = Math.trunc(tt * (Math.abs(hi - lo) + 1));
  return hi >= lo ? lo + step : lo - step;
}

function render(fn) {
  const grid = [];
  for (let r = 0; r < SIDE; r++) {
    const row = new Array(SIDE);
    for (let c = 0; c < SIDE; c++) {
      const x = c + 0.5 - SIDE / 2;
      const y = (r + 0.5 - SIDE / 2) * ROW;
      row[c] = String(clamp9(fn(x, y)));
    }
    grid.push(row);
  }
  return grid;
}

// ─── spirals ─────────────────────────────────────────────────────────────────
// Whirlpools: two whirls, one in each half of the tall parcel, turning opposite ways.
// Fine spiral lines; between them a ramp of heights from each centre outward, so the
// animation streams around the whirls; a fainter counter-spiral crosses them like the
// water's texture; the two meet in a stream on the right.
function whirlpools([line, lo, hi, cross, eye]) {
  const arms = 5, twist = 1.25, w = 0.16, w2 = 0.08;
  return render((x, y) => {
    const top = y < 0;
    const cy = top ? -H / 2 : H / 2;
    const dx = x, dy = y - cy;
    const rad = Math.max(Math.hypot(dx, dy), 0.3);
    if (rad < 0.9) return eye;
    const th = Math.atan2(dy, dx) * (top ? 1 : -1);
    const lr = Math.log(rad);
    if (frac((arms * th) / TAU + twist * lr) < w) return line;
    if (frac(((arms + 3) * th) / TAU - 0.9 * twist * lr) < w2) return cross;
    return ramp(lr / Math.log(16), lo, hi);
  });
}

// Path of Life: six spiral arms like fish swimming out of the centre. Each arm is shaded
// across its width (alternate arms in two ranges), outlined by a fine line, and crossed
// by fine segment lines spaced ever closer toward the centre.
function pathOfLife([line, aLo, aHi, bLo, bHi]) {
  const arms = 6, twist = 1.6, seg = 7, w = 0.07;
  return render((x, y) => {
    const rad = Math.max(Math.hypot(x, y), 0.3);
    if (rad < 0.7) return 9;
    const th = Math.atan2(y, x);
    const lr = Math.log(rad);
    const phi = (arms * th) / TAU + ((twist * lr * arms) / TAU) * 2;
    const k = Math.floor(phi);
    const u = frac(phi);
    if (u < w) return line;
    if (frac((lr * seg) / Math.log(2)) < 0.09) return mod(k, 2) ? 9 : line - 2;
    return mod(k, 2) === 0 ? ramp((u - w) / (1 - w), aLo, aHi) : ramp((u - w) / (1 - w), bLo, bHi);
  });
}

// Droste: the parcel's frame inside itself, turned. Fine frame lines; between them a
// ramp of heights along the spiral, so the animation zooms inward without end; the
// frames' corners picked out on the diagonals.
function droste([line, lo, hi, corner]) {
  const turn = 1, bands = 3, base = 2, w = 0.13;
  return render((x, y) => {
    const u = x / W, v = y / H;
    const d = Math.max(Math.abs(u), Math.abs(v), 1e-6);
    const th = Math.atan2(v, u);
    const t = frac((Math.log(d) / Math.log(base) + (turn * th) / TAU) * bands);
    if (t < w) return line;
    if (Math.abs(Math.abs(u) - Math.abs(v)) < 0.035 && d > 0.04) return corner;
    return ramp((t - w) / (1 - w), lo, hi);
  });
}

// ─── tessellations ───────────────────────────────────────────────────────────
// Regular Division of the Plane: interlocking creatures — each square grows a head into
// its right neighbour and a fin into the one below — outlined by a fine line, shaded by
// a ramp out from each body's centre (one range per creature), with an eye and a gill.
function regularDivision([line, aLo, aHi, bLo, bHi, eye]) {
  const P = 10, rho = 2.6;
  const owner = (x, y) => {
    let i = Math.floor(x / P);
    let j = Math.floor(y / P);
    const lx = x - i * P, ly = y - j * P;
    if (Math.hypot(lx, ly - P * 0.5) < rho) i -= 1;
    else if (Math.hypot(lx - P * 0.5, ly) < rho * 0.8) j -= 1;
    return [i, j];
  };
  return render((x, y) => {
    const x0 = x + 0.3, y0 = y + 0.4;
    const [i, j] = owner(x0, y0);
    for (const [dx, dy] of [[0.85, 0], [0, 1.2], [-0.85, 0], [0, -1.2]]) {
      const [oi, oj] = owner(x0 + dx, y0 + dy);
      if (oi !== i || oj !== j) return line;
    }
    if (Math.abs(x - ((i + 1) * P + rho * 0.45)) < 0.6 && Math.abs(y - ((j + 0.5) * P - 0.5)) < 0.8) return eye;
    if (Math.abs(x - ((i + 1) * P - 0.6)) < 0.45 && Math.abs(y - ((j + 0.5) * P + 0.6)) < 2.0) return line - 1;
    const dist = Math.hypot(x - (i + 0.5) * P, y - (j + 0.5) * P) / (P * 0.75);
    return mod(i + j, 2) === 0 ? ramp(1 - dist, aLo, aHi) : ramp(1 - dist, bLo, bHi);
  });
}

// ─── catalogue ───────────────────────────────────────────────────────────────
// id -> { label, category, tones: default heights, toneLabels, draw }.
export const ESCHER_DESIGNS = {
  whirlpools: {
    label: 'whirlpools', category: 'spirals', draw: whirlpools,
    tones: [8, 1, 5, 6, 9], toneLabels: ['lines', 'gradient from', 'gradient to', 'cross-currents', 'eyes'],
  },
  'path-of-life': {
    label: 'path of life', category: 'spirals', draw: pathOfLife,
    tones: [8, 1, 3, 4, 7], toneLabels: ['lines', 'arms 1 from', 'arms 1 to', 'arms 2 from', 'arms 2 to'],
  },
  droste: {
    label: 'droste', category: 'spirals', draw: droste,
    tones: [8, 1, 6, 7], toneLabels: ['frames', 'gradient from', 'gradient to', 'corners'],
  },
  'regular-division': {
    label: 'regular division', category: 'tessellations', draw: regularDivision,
    tones: [8, 1, 4, 5, 7, 9], toneLabels: ['outlines', 'creature 1 from', 'creature 1 to', 'creature 2 from', 'creature 2 to', 'eyes'],
  },
};

export const ESCHER_CATEGORIES = ['spirals', 'tessellations'];
export const ESCHER_DEFAULT = 'whirlpools';

export function escherDesignsIn(category) {
  return Object.keys(ESCHER_DESIGNS).filter((id) => ESCHER_DESIGNS[id].category === category);
}

// The tones to draw with: the user's where given and valid, else the design's defaults.
// A list of the wrong length (a link from before a design was redrawn) is ignored.
export function escherTones(design, tones) {
  const def = ESCHER_DESIGNS[design].tones;
  if (!Array.isArray(tones) || tones.length !== def.length) return [...def];
  return def.map((d, i) => (Number.isInteger(tones[i]) && tones[i] >= 0 && tones[i] <= 9 ? tones[i] : d));
}

export function generateEscher(design, tones) {
  const id = ESCHER_DESIGNS[design] ? design : ESCHER_DEFAULT;
  return ESCHER_DESIGNS[id].draw(escherTones(id, tones));
}
