// Escher-inspired heightmaps (James, 2026-11-12): full-canvas designs after M. C.
// Escher's mathematical work — fractals, limits, spirals and tessellations. Ported from
// the experiment in ~/ops/mandala-escher (escher.py / escher2.py), which rendered every
// design through previewHtml.js on real parcels; tested cell for cell against it.
//
// Each design draws with a few "tones": the heights its regions take. Contrast depends
// on the parcel (each height takes its palette colour, and the palette cycles), so the
// tones are user-settable; defaults are ~5 apart (1 and 6), which read on most parcels.
// 9 is an empty cell on-chain (dark), useful for holes and eyes.
//
// Geometry: a cell renders 10.6 x 16 px, so a row is 1.5 columns tall. Every design is
// drawn in "visual" units — x in columns (-16..16), y in columns too (-24..24) — so
// circles stay round and squares square. Nothing here is random: the seed is unused.

const SIDE = 32;
const ROW = 1.5;
const W = 16;
const H = 24;
const TAU = 2 * Math.PI;

// Python's floor-mod, which the ported formulas rely on for negative operands.
const mod = (a, n) => ((a % n) + n) % n;
const clamp9 = (v) => Math.max(0, Math.min(9, v));

function render(fn) {
  const grid = [];
  for (let r = 0; r < SIDE; r++) {
    const row = new Array(SIDE);
    for (let c = 0; c < SIDE; c++) {
      const x = c + 0.5 - SIDE / 2;
      const y = (r + 0.5 - SIDE / 2) * ROW;
      row[c] = String(fn(x, y));
    }
    grid.push(row);
  }
  return grid;
}

// ─── fractals ────────────────────────────────────────────────────────────────
function inside(p, a, b, c) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b);
  const d2 = s(p, b, c);
  const d3 = s(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// 0 if p is on the gasket down to `depth`, else the level (1 = biggest) of its hole.
function sierLevel(p, tri, depth) {
  let [a, b, c] = tri;
  for (let level = 1; level <= depth; level++) {
    const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    const ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
    if (inside(p, a, ab, ca)) { b = ab; c = ca; }
    else if (inside(p, ab, b, bc)) { a = ab; c = bc; }
    else if (inside(p, ca, bc, c)) { a = ca; b = bc; }
    else return level;
  }
  return 0;
}

// Up- and down-pointing triangles of the given base and height tiling the plane, an
// up-triangle's apex at the top centre: the corners left beside it are halves of its
// upside-down neighbours, so the gasket covers the whole parcel.
function triangleOf(x, y, base, height) {
  const y0 = -H;
  const j = Math.floor((y - y0) / height);
  const top = y0 + j * height;
  const bot = top + height;
  const t = (y - top) / height;
  let cx = Math.round(x / base) * base;
  if (Math.abs(x - cx) <= (t * base) / 2) return [[cx, top], [cx - base / 2, bot], [cx + base / 2, bot]];
  cx += x > cx ? base / 2 : -base / 2;
  return [[cx - base / 2, top], [cx + base / 2, top], [cx, bot]];
}

const sierpinski = (rows, depth) => (tones) => render((x, y) => {
  const lv = sierLevel([x, y], triangleOf(x, y, 2 * W, (2 * H) / rows), depth);
  return tones[Math.min(lv, tones.length - 1)];
});

const carpet = (depth) => (tones) => render((x, y) => {
  const u = (x + W) / (2 * W);
  const v = (y + H) / (2 * H);
  for (let k = 1; k <= depth; k++) {
    if (Math.floor(u * 3 ** k) % 3 === 1 && Math.floor(v * 3 ** k) % 3 === 1) return tones[Math.min(k, tones.length - 1)];
  }
  return tones[0];
});

// Rule 90 (each cell = XOR of its neighbours) from one cell at the top, wrapping at the
// sides, so the Sierpinski cone folds back over the whole parcel. Simulated 33 wide and
// shown 32: on exactly 32 cells the XOR cancels out at row 16 and the rest goes blank.
function rule90([on, off]) {
  const width = SIDE + 1;
  let row = Array.from({ length: width }, (_, c) => (c === 16 ? 1 : 0));
  const grid = [];
  for (let r = 0; r < SIDE; r++) {
    grid.push(row.slice(0, SIDE).map((v) => String(v ? on : off)));
    row = row.map((_, c) => row[mod(c - 1, width)] ^ row[mod(c + 1, width)]);
  }
  return grid;
}

// ─── limits ──────────────────────────────────────────────────────────────────
// Square Limit: rings halving in width toward the edge, each ring split into twice as
// many tiles as the one inside it. The outermost ring (under a cell wide) takes each
// tone one step toward the other.
function squareLimit([hi, lo]) {
  const maxLevel = 4;
  return render((x, y) => {
    const u = x / W;
    const v = y / H;
    const d = Math.max(Math.abs(u), Math.abs(v));
    const level = Math.min(Math.trunc(-Math.log2(Math.max(1e-9, 1 - d))), maxLevel);
    const horiz = Math.abs(u) >= Math.abs(v);
    const t = horiz ? v : u;
    const n = 2 ** (level + 1);
    const idx = Math.min(Math.trunc(((t + 1) / 2) * n), n - 1);
    const par = (idx + level + (horiz ? 0 : 1)) % 2;
    if (level < maxLevel) return [hi, lo][par];
    return [clamp9(hi - 1), clamp9(lo + 1)][par];
  });
}

// Smaller and Smaller: square rings halving toward the CENTRE, the same number of
// tiles in each, so the tiles shrink without end into the middle.
function smallerAndSmaller([hi, lo]) {
  const perSide = 4;
  const maxLevel = 6;
  return render((x, y) => {
    const u = x / W;
    const v = y / H;
    const d = Math.max(Math.abs(u), Math.abs(v), 1e-6);
    const level = Math.min(Math.trunc(-Math.log2(d)), maxLevel);
    const horiz = Math.abs(u) >= Math.abs(v);
    const t = (horiz ? v : u) / d;
    const idx = Math.min(Math.trunc(((t + 1) / 2) * perSide), perSide - 1);
    const side = (horiz ? 0 : 1) + ((horiz ? u : v) > 0 ? 0 : 2);
    return [hi, lo][(idx + level + side) % 2];
  });
}

// ─── spirals ─────────────────────────────────────────────────────────────────
// Print Gallery: a logarithmic spiral chequerboard repeating itself into the centre.
function printGallery([hi, lo]) {
  const n1 = 7, n2 = 4, base = 1.6;
  return render((x, y) => {
    const rad = Math.max(Math.hypot(x, y), 0.35);
    const th = Math.atan2(y, x);
    const lr = Math.log(rad) / Math.log(base);
    const U = (n1 * th) / TAU + lr;
    const V = (n2 * th) / TAU - lr;
    return mod(Math.floor(U) + Math.floor(V), 2) === 0 ? hi : lo;
  });
}

// Path of Life: six logarithmic spiral arms, each in its own tone.
function pathOfLife(tones) {
  const arms = 6, twist = 1.6;
  return render((x, y) => {
    const rad = Math.max(Math.hypot(x, y), 0.35);
    const th = Math.atan2(y, x);
    const k = Math.floor((arms * th) / TAU + ((twist * Math.log(rad) * arms) / TAU) * 2);
    return tones[mod(k, tones.length)];
  });
}

// Whirlpools: two whirls, one in each half of the tall parcel, turning opposite ways.
function whirlpools(tones) {
  const arms = 4, twist = 1.5;
  return render((x, y) => {
    const top = y < 0;
    const cy = top ? -H / 2 : H / 2;
    const rad = Math.max(Math.hypot(x, y - cy), 0.35);
    const th = Math.atan2(y - cy, x) * (top ? 1 : -1);
    const k = Math.floor((arms * th) / TAU + (twist * Math.log(rad) * arms) / Math.PI);
    return tones[mod(k, tones.length)];
  });
}

// Droste: the parcel's own frame repeated inside itself, smaller and turned.
function droste([hi, lo]) {
  const turn = 1, bands = 2, base = 2;
  return render((x, y) => {
    const d = Math.max(Math.abs(x) / W, Math.abs(y) / H, 1e-6);
    const th = Math.atan2(y / H, x / W);
    const s = Math.log(d) / Math.log(base) + (turn * th) / TAU;
    return mod(Math.floor(s * bands), 2) === 0 ? hi : lo;
  });
}

// ─── tessellations ───────────────────────────────────────────────────────────
// Regular Division of the Plane: interlocking creatures — each square grows a head into
// its right neighbour and a fin into the one below — chequered, each with an eye.
function regularDivision([hi, lo, eye]) {
  const P = 10, rho = 2.6;
  const owner = (x, y) => {
    let i = Math.floor(x / P);
    let j = Math.floor(y / P);
    const lx = x - i * P;
    const ly = y - j * P;
    if (Math.hypot(lx, ly - P * 0.5) < rho) i -= 1;
    else if (Math.hypot(lx - P * 0.5, ly) < rho * 0.8) j -= 1;
    return [i, j];
  };
  return render((x, y) => {
    const [i, j] = owner(x + 0.3, y + 0.4);
    const ex = (i + 1) * P + rho * 0.45;
    const ey = (j + 0.5) * P - 0.5;
    if (Math.abs(x - ex) < 0.6 && Math.abs(y - ey) < 0.8) return eye;
    return mod(i + j, 2) === 0 ? hi : lo;
  });
}

// Metamorphosis: a plain chessboard at the top whose squares grow heads and fins row
// by row until the bottom rows interlock.
function metamorphosis([hi, lo]) {
  const P = 8, rhoMax = 2.4;
  return render((x, y) => {
    const rho = rhoMax * Math.min(1, Math.max(0, ((y + H) / (2 * H)) * 1.25 - 0.1));
    let i = Math.floor(x / P);
    let j = Math.floor(y / P);
    const lx = x - i * P;
    const ly = y - j * P;
    if (rho > 0.2 && Math.hypot(lx, ly - P / 2) < rho) i -= 1;
    else if (rho > 0.2 && Math.hypot(lx - P / 2, ly) < rho * 0.8) j -= 1;
    return mod(i + j, 2) === 0 ? hi : lo;
  });
}

// ─── catalogue ───────────────────────────────────────────────────────────────
// id -> { label, category, tones: default heights, toneLabels, draw }.
export const ESCHER_DESIGNS = {
  sierpinski: { label: 'sierpinski', category: 'fractals', tones: [1, 6], toneLabels: ['gasket', 'holes'], draw: sierpinski(2, 4) },
  'sierpinski-whole': { label: 'sierpinski, one triangle', category: 'fractals', tones: [1, 6, 8, 4, 3], toneLabels: ['gasket', 'largest hole', 'second holes', 'third holes', 'smallest holes'], draw: sierpinski(1, 5) },
  carpet: { label: 'carpet', category: 'fractals', tones: [1, 6, 8, 4, 9], toneLabels: ['carpet', 'largest hole', 'second holes', 'third holes', 'smallest holes'], draw: carpet(4) },
  'rule-90': { label: 'rule 90', category: 'fractals', tones: [6, 1], toneLabels: ['cells', 'ground'], draw: rule90 },
  'square-limit': { label: 'square limit', category: 'limits', tones: [6, 1], toneLabels: ['tone 1', 'tone 2'], draw: squareLimit },
  'smaller-and-smaller': { label: 'smaller and smaller', category: 'limits', tones: [1, 6], toneLabels: ['tone 1', 'tone 2'], draw: smallerAndSmaller },
  'print-gallery': { label: 'print gallery', category: 'spirals', tones: [1, 6], toneLabels: ['tone 1', 'tone 2'], draw: printGallery },
  'path-of-life': { label: 'path of life', category: 'spirals', tones: [1, 6, 3, 8, 4, 9], toneLabels: ['arm 1', 'arm 2', 'arm 3', 'arm 4', 'arm 5', 'arm 6'], draw: pathOfLife },
  whirlpools: { label: 'whirlpools', category: 'spirals', tones: [1, 6], toneLabels: ['tone 1', 'tone 2'], draw: whirlpools },
  droste: { label: 'droste', category: 'spirals', tones: [1, 6], toneLabels: ['tone 1', 'tone 2'], draw: droste },
  'regular-division': { label: 'regular division', category: 'tessellations', tones: [1, 6, 9], toneLabels: ['creature 1', 'creature 2', 'eyes'], draw: regularDivision },
  metamorphosis: { label: 'metamorphosis', category: 'tessellations', tones: [1, 6], toneLabels: ['tone 1', 'tone 2'], draw: metamorphosis },
};

export const ESCHER_CATEGORIES = ['fractals', 'limits', 'spirals', 'tessellations'];
export const ESCHER_DEFAULT = 'sierpinski';

export function escherDesignsIn(category) {
  return Object.keys(ESCHER_DESIGNS).filter((id) => ESCHER_DESIGNS[id].category === category);
}

// The tones to draw with: the user's where given and valid, else the design's defaults.
export function escherTones(design, tones) {
  const def = ESCHER_DESIGNS[design].tones;
  return def.map((d, i) => (Number.isInteger(tones?.[i]) && tones[i] >= 0 && tones[i] <= 9 ? tones[i] : d));
}

export function generateEscher(design, tones) {
  const id = ESCHER_DESIGNS[design] ? design : ESCHER_DEFAULT;
  return ESCHER_DESIGNS[id].draw(escherTones(id, tones));
}
