// Escher-inspired heightmaps (James, 2026-11-12). Four full-canvas designs after M. C.
// Escher — whirlpools, path of life, droste, regular division — kept from a wider
// experiment and redrawn the same day with fine (one-cell) lines and ramps of heights
// rather than flat blocks: each height animates at its own phase, so a ramp makes the
// animation flow along the drawing. Ported from ~/ops/mandala-escher/escher3.py, which
// rendered every design through previewHtml.js on real parcels (stills and animated
// captures); tested cell for cell against it until two eye fixes (whirlpools,
// regular division) on 2026-11-12.
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
    // The centres fall between cells (the nearest cell centres are 0.90 away), so the eye
    // radius must clear that: < 0.9 drew nothing and the eyes slider did nothing (James,
    // 2026-11-12). 1.2 takes the 2 x 2 cells round each centre.
    if (rad < 1.2) return eye;
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

// Droste: the parcel's frame inside itself, turned. James (2026-11-12) asked for it back
// toward the first drawing — two broad bands spiralling in, one plain — keeping a little
// of the redraw: the other band carries a ramp across its width (so the animation still
// zooms inward) and a fine line on its leading edge. The corner diagonals are gone.
function droste([band, lo, hi, line]) {
  const turn = 1, bands = 2, base = 2, w = 0.1;
  return render((x, y) => {
    const u = x / W, v = y / H;
    const d = Math.max(Math.abs(u), Math.abs(v), 1e-6);
    const th = Math.atan2(v, u);
    const s = (Math.log(d) / Math.log(base) + (turn * th) / TAU) * bands;
    if (mod(Math.floor(s), 2) === 1) return band;
    const t = frac(s);
    if (t < w) return line;
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
    // The eye sits in the column just inside the head's base: further out (it was at
    // rho * 0.45) the head is too small at this scale for any cell there to clear the
    // outline test, so the eye never drew and its slider did nothing (James, 2026-11-12).
    if (Math.abs(x - ((i + 1) * P + 0.2)) < 0.6 && Math.abs(y - ((j + 0.5) * P - 0.5)) < 0.8) return eye;
    if (Math.abs(x - ((i + 1) * P - 0.6)) < 0.45 && Math.abs(y - ((j + 0.5) * P + 0.6)) < 2.0) return line - 1;
    const dist = Math.hypot(x - (i + 0.5) * P, y - (j + 0.5) * P) / (P * 0.75);
    return mod(i + j, 2) === 0 ? ramp(1 - dist, aLo, aHi) : ramp(1 - dist, bLo, bHi);
  });
}

// ─── tiling helpers ──────────────────────────────────────────────────────────
// The diamond rule: a segment is drawn through a cell when it crosses the diamond
// inscribed in the cell (half-width 0.5 across, 0.75 up — a row is 1.5 tall), which keeps
// lines one cell wide whatever their slope. The scaled L1 distance is piecewise linear
// along the segment, so its minimum is at an end or where dx or dy crosses zero.
function segHits(cx, cy, ax, ay, bx, by) {
  const f = (t) => Math.abs(ax + (bx - ax) * t - cx) / 0.5 + Math.abs(ay + (by - ay) * t - cy) / 0.75;
  let best = Math.min(f(0), f(1));
  if (bx !== ax) { const t = (cx - ax) / (bx - ax); if (t > 0 && t < 1) best = Math.min(best, f(t)); }
  if (by !== ay) { const t = (cy - ay) / (by - ay); if (t > 0 && t < 1) best = Math.min(best, f(t)); }
  return best <= 1;
}

function insideConvex(pts, x, y) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cr !== 0) {
      if (sign === 0) sign = Math.sign(cr);
      else if (Math.sign(cr) !== sign) return false;
    }
  }
  return true;
}

// A tiling of convex polygons ({ pts, stroke?, ... }) in visual units: edges drawn one
// cell wide in `line` (only edge indices in `stroke`, when given), each tile's inside
// shaded by shade(tile, x, y).
function renderTiles(tiles, line, shade) {
  for (const t of tiles) {
    t.x0 = Math.min(...t.pts.map((p) => p[0])); t.x1 = Math.max(...t.pts.map((p) => p[0]));
    t.y0 = Math.min(...t.pts.map((p) => p[1])); t.y1 = Math.max(...t.pts.map((p) => p[1]));
  }
  const near = tiles.filter((t) => t.x1 > -W - 2 && t.x0 < W + 2 && t.y1 > -H - 2 && t.y0 < H + 2);
  return render((x, y) => {
    let home = null;
    for (const t of near) {
      if (x < t.x0 - 0.6 || x > t.x1 + 0.6 || y < t.y0 - 0.8 || y > t.y1 + 0.8) continue;
      const p = t.pts;
      for (let i = 0; i < p.length; i++) {
        if (t.stroke && !t.stroke.includes(i)) continue;   // edges left to the shading
        const a = p[i], b = p[(i + 1) % p.length];
        if (segHits(x, y, a[0], a[1], b[0], b[1])) return line;
      }
      if (!home && insideConvex(p, x, y)) home = t;
    }
    return home ? shade(home, x, y) : line;
  });
}

// Position of (x, y) along a tile's axis from point a to point b, 0..1.
function along(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  return ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
}

// ─── more tessellations (James, 2026-11-12: "be brave and experimental"; of four tried
// he kept penrose and cubes — alhambra stars and weave were removed the same day) ──
// Penrose rhombs: the aperiodic tiling of thick (72°) and thin (36°) rhombs, built by de
// Bruijn's pentagrid — every crossing of two of five families of parallel lines becomes a
// rhomb. Never repeats, yet five-fold everywhere. Each rhomb is shaded along its long
// diagonal (thick and thin in their own ranges), so the ten orientations make the plane
// read as stacked, tilted faces and the animation runs a different way in each.
function penrose([line, aLo, aHi, bLo, bHi]) {
  const L = 6.4;                                          // edge length, visual units
  const gam = [0.2, 0.2, 0.2, 0.2, 0.2];                  // equal offsets: five-fold about the centre
  const e = [0, 1, 2, 3, 4].map((j) => [Math.cos((TAU * j) / 5 + Math.PI / 2), Math.sin((TAU * j) / 5 + Math.PI / 2)]);
  const tiles = [];
  const R = 7;
  for (let r = 0; r < 5; r++) {
    for (let s = r + 1; s < 5; s++) {
      const [a1, b1] = e[r], [a2, b2] = e[s];
      const det = a1 * b2 - a2 * b1;
      for (let kr = -R; kr <= R; kr++) {
        for (let ks = -R; ks <= R; ks++) {
          const c1 = kr - gam[r], c2 = ks - gam[s];
          const px = (c1 * b2 - c2 * b1) / det, py = (a1 * c2 - a2 * c1) / det;
          const K = e.map(([ex, ey], j) => Math.ceil(px * ex + py * ey + gam[j]));
          K[r] = kr; K[s] = ks;
          const vert = (dr, ds) => {
            let vx = 0, vy = 0;
            for (let j = 0; j < 5; j++) {
              const kj = K[j] + (j === r ? dr : 0) + (j === s ? ds : 0);
              vx += kj * e[j][0]; vy += kj * e[j][1];
            }
            return [vx * L, vy * L];
          };
          const pts = [vert(0, 0), vert(1, 0), vert(1, 1), vert(0, 1)];
          tiles.push({ pts, thick: s - r === 1 || s - r === 4 });
        }
      }
    }
  }
  // centre the tiling's middle on the parcel
  return renderTiles(tiles, line, (t, x, y) => {
    const u = along(x, y, t.pts[0], t.pts[2]);
    return t.thick ? ramp(u, aLo, aHi) : ramp(u, bLo, bHi);
  });
}

// Cubes: tumbling blocks — a hexagonal tiling split into rhombs so every hexagon is a
// cube seen from above its corner, Escher's favourite space-filling solid. Each face has
// its own light: the top lit and fading to the front edge, the left mid-tone and the
// right in shade, each a ramp, so the stack reads in perspective and the faces animate
// out of step.
function cubes([line, tLo, tHi, lLo, lHi, rLo, rHi]) {
  const sz = 8;                                           // centre to corner, visual units
  const dx = Math.sqrt(3) * sz;
  const tiles = [];
  for (let j = -5; j <= 5; j++) {
    for (let i = -3; i <= 3; i++) {
      const cx = i * dx + (mod(j, 2) ? dx / 2 : 0), cy = j * 1.5 * sz;
      const v = (deg) => [cx + sz * Math.cos((deg * Math.PI) / 180), cy - sz * Math.sin((deg * Math.PI) / 180)];
      const c = [cx, cy];
      // only the hexagon's outline is drawn; the three inner edges are left to the light
      tiles.push({ face: 'top', pts: [c, v(30), v(90), v(150)], stroke: [1, 2], a: v(90), b: c });
      tiles.push({ face: 'left', pts: [c, v(150), v(210), v(270)], stroke: [1, 2], a: v(150), b: v(270) });
      tiles.push({ face: 'right', pts: [c, v(270), v(330), v(30)], stroke: [1, 2], a: v(30), b: v(270) });
    }
  }
  return renderTiles(tiles, line, (t, x, y) => {
    const u = along(x, y, t.a, t.b);
    if (t.face === 'top') return ramp(u, tHi, tLo);
    if (t.face === 'left') return ramp(u, lHi, lLo);
    return ramp(u, rHi, rLo);
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
    tones: [6, 1, 3, 8], toneLabels: ['plain band', 'gradient from', 'gradient to', 'edge line'],
  },
  'regular-division': {
    label: 'regular', category: 'tessellations', draw: regularDivision,
    tones: [8, 1, 4, 5, 7, 9], toneLabels: ['outlines', 'creature 1 from', 'creature 1 to', 'creature 2 from', 'creature 2 to', 'eyes'],
  },
  penrose: {
    label: 'penrose', category: 'tessellations', draw: penrose,
    tones: [8, 1, 4, 5, 7], toneLabels: ['edges', 'thick from', 'thick to', 'thin from', 'thin to'],
  },
  cubes: {
    label: 'cubes', category: 'tessellations', draw: cubes,
    tones: [9, 7, 8, 4, 5, 1, 2], toneLabels: ['edges', 'tops from', 'tops to', 'left faces from', 'left faces to', 'right faces from', 'right faces to'],
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
