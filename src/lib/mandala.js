import { makeRng } from './seedrandom.js';
import { validate } from './heightmap.js';

// Port of d3l33t's mandala-gen2.js. Generates a 32x32 symmetric heightmap.
//
// Pipeline:
//  1. Walk the lower-right triangle (anti-diagonal) of a 16x16 quadrant with
//     a seeded random walk: each cell is the previous cell ± variance, clamped
//     to [0, peakHeight].
//  2. Mirror across the anti-diagonal to fill the upper-left triangle of the
//     quadrant. Result: a 16x16 quadrant symmetric about its anti-diagonal.
//  3. (rotationalOrder=8 only) Symmetrize across the main diagonal too, by
//     averaging q[i][j] and q[j][i]. Adds D4 octagonal symmetry.
//  4. Mirror each quadrant row horizontally to produce 16 rows of 32 chars.
//  5. Prepend the same 16 rows in reverse vertical order to produce 32x32.
//
// Output is a 1024-char digit string + 32x32 grid. Always passes
// vertical/horizontal/180° symmetry checks; throws if not.

const QUADRANT = 16;
const SIDE = 32;

export const DEFAULTS = {
  algorithm: 'classic',
  variance: 2,
  peakHeight: 9,
  startValue: 5,
  rotationalOrder: 4,
  minHeight: 0,
  ringCount: 6,
  smoothing: 0,
  terraceCount: 5,
};

export function generateMandala(opts = {}) {
  const seed = opts.seed ?? 'mandala';
  const rawAlgo = opts.algorithm;
  const algorithm = rawAlgo === 'rings' ? 'rings' : rawAlgo === 'temple' ? 'temple' : 'classic';
  const peakHeight = clampInt(opts.peakHeight ?? DEFAULTS.peakHeight, 1, 9);
  const minHeight = clampInt(opts.minHeight ?? DEFAULTS.minHeight, 0, peakHeight - 1);
  const variance = clampInt(opts.variance ?? DEFAULTS.variance, 1, 4);
  const startValue = clampInt(opts.startValue ?? DEFAULTS.startValue, minHeight, peakHeight);
  const ringCount = clampInt(opts.ringCount ?? DEFAULTS.ringCount, 2, 16);
  const terraceCount = clampInt(opts.terraceCount ?? DEFAULTS.terraceCount, 2, 9);
  const smoothing = clampInt(opts.smoothing ?? DEFAULTS.smoothing, 0, 3);
  const rotationalOrder = opts.rotationalOrder === 2 ? 2 : opts.rotationalOrder === 8 ? 8 : 4;

  const rng = makeRng(seed);

  let grid;
  if (algorithm === 'rings') {
    grid = generateRings(rng, ringCount, minHeight, peakHeight);
  } else if (algorithm === 'temple') {
    grid = generateTemple(rng, terraceCount, minHeight, peakHeight);
  } else {
    let quadrant;
    if (rotationalOrder === 2) {
      quadrant = walkQuadrantFull(rng, variance, peakHeight, startValue, minHeight);
    } else {
      quadrant = walkQuadrant(rng, variance, peakHeight, startValue, minHeight);
      diagonalMirror(quadrant);
      if (rotationalOrder === 8) symmetrizeMainDiagonal(quadrant);
    }
    grid = expandToFullGrid(quadrant);
  }

  if (smoothing > 0) grid = smoothGrid(grid, smoothing);

  const heightmap = grid.map((row) => row.join('')).join('');

  const v = validate(heightmap);
  if (!v.lengthOk || !v.allDigits || !v.vertical_sym || !v.horizontal_sym || !v.rotational_sym) {
    throw new Error(`generateMandala produced asymmetric output: ${JSON.stringify(v)}`);
  }
  return { heightmap, grid };
}

function clampInt(n, lo, hi) {
  const i = Math.round(Number(n));
  if (Number.isNaN(i)) return lo;
  return Math.max(lo, Math.min(hi, i));
}

// 2-fold variant: walks the entire 16x16 quadrant freely (no anti-diagonal constraint).
// expandToFullGrid then gives H/V/180° symmetry, but the quadrant itself has no internal
// symmetry so the full pattern feels bilateral rather than radially mandala-like.
function walkQuadrantFull(rng, variance, peakHeight, startValue, minHeight) {
  const q = Array.from({ length: QUADRANT }, () => new Array(QUADRANT));
  let last = startValue;
  for (let i = 0; i < QUADRANT; i++) {
    for (let j = 0; j < QUADRANT; j++) {
      const step = Math.floor(rng() * (variance * 2 + 1)) - variance;
      last = Math.max(minHeight, Math.min(peakHeight, last + step));
      q[i][j] = last;
    }
  }
  return q;
}

function walkQuadrant(rng, variance, peakHeight, startValue, minHeight) {
  const q = Array.from({ length: QUADRANT }, () => Array(QUADRANT).fill(null));
  let last = startValue;
  for (let i = 0; i < QUADRANT; i++) {
    for (let j = 0; j < QUADRANT; j++) {
      if (QUADRANT - i - 1 <= j) {
        const step = Math.floor(rng() * (variance * 2 + 1)) - variance;
        let v = last + step;
        v = Math.max(minHeight, Math.min(peakHeight, v));
        last = v;
        q[i][j] = v;
      }
    }
  }
  return q;
}

function diagonalMirror(q) {
  for (let i = 0; i < QUADRANT; i++) {
    for (let j = 0; j < QUADRANT; j++) {
      if (q[i][j] === null) {
        q[i][j] = q[QUADRANT - 1 - j][QUADRANT - 1 - i];
      }
    }
  }
}

function symmetrizeMainDiagonal(q) {
  for (let i = 0; i < QUADRANT; i++) {
    for (let j = i + 1; j < QUADRANT; j++) {
      const v = q[i][j];
      q[j][i] = v;
    }
  }
}

function expandToFullGrid(quadrant) {
  const halfRows = quadrant.map((row) => {
    const left = row.map(String);
    const right = [...left].reverse();
    return [...left, ...right];
  });
  const top = [...halfRows].reverse();
  const bot = halfRows;
  return [...top, ...bot];
}

// Concentric ring generator. Inherently D4-symmetric (8-fold dihedral) because
// every cell at the same Euclidean distance from (15.5, 15.5) gets the same
// height. Ring widths divide the radial range evenly; per-ring heights are
// sampled uniformly from [minHeight, peakHeight].
function generateRings(rng, ringCount, minHeight, peakHeight) {
  const heights = new Array(ringCount);
  for (let i = 0; i < ringCount; i++) {
    heights[i] = minHeight + Math.floor(rng() * (peakHeight - minHeight + 1));
  }
  const cx = (SIDE - 1) / 2;
  const maxDist = Math.hypot(cx, cx);
  const grid = Array.from({ length: SIDE }, () => new Array(SIDE));
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const d = Math.hypot(i - cx, j - cx);
      const idx = Math.min(ringCount - 1, Math.floor((d / maxDist) * ringCount));
      grid[i][j] = String(heights[idx]);
    }
  }
  return grid;
}

// Temple generator: a heavily featured stepped pyramid with per-seed variation
// in terrace shape, spire type, and decorative elements (corner towers, moat
// rings, crenellations, satellite spires, cardinal and diagonal channels).
//
// Distance metric is a seed-driven blend of Chebyshev (square terraces) and
// Euclidean (round terraces) with a 4-fold star modulation on the boundary —
// so terraces range from near-circular through square to star/cross-shaped.
//
// All features are 4-fold symmetric by construction. A final averaging pass
// enforces exact pixel-level symmetry and guarantees validate().
function generateTemple(rng, terraceCount, minHeight, peakHeight) {
  const cx = (SIDE - 1) / 2; // 15.5
  const range = peakHeight - minHeight;
  const maxRadius = cx + 0.5; // 16

  // ── Distance metric: blended Chebyshev+Euclidean with 4-fold star shaping ──
  // octMix=0 → square terraces; octMix=0.55 → near-circular
  const octMix = rng() * 0.55;
  // starAmp>0 → cross/plus shape; starAmp<0 → star/diamond shape
  const starAmp = (rng() > 0.5 ? 1 : -1) * (0.05 + rng() * 0.18);

  function effDist(i, j) {
    const di = i - cx, dj = j - cx;
    const chebyD = Math.max(Math.abs(di), Math.abs(dj));
    const euclidD = Math.hypot(di, dj);
    const d = chebyD * (1 - octMix) + euclidD * octMix;
    const mod = 1 + starAmp * Math.cos(4 * Math.atan2(di, dj));
    return d / Math.max(0.3, mod);
  }

  // ── Variable terrace widths: weights in [0.4, 1.6] for more irregular stacking ──
  const weights = Array.from({ length: terraceCount }, () => 0.4 + rng() * 1.2);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const radii = [];
  let acc = 0;
  for (let t = 0; t < terraceCount; t++) {
    acc += weights[t];
    radii.push((acc / totalWeight) * maxRadius);
  }

  // ── Variable terrace heights: strictly decreasing, varied step sizes ──
  const terraceHeights = [];
  let h = peakHeight;
  for (let t = 0; t < terraceCount; t++) {
    terraceHeights.push(h);
    if (t < terraceCount - 1) {
      const remaining = terraceCount - t - 1;
      const targetDrop = (h - minHeight) / (remaining + 1);
      const jitter = 0.6 + rng() * 0.8;
      const drop = Math.max(1, Math.round(targetDrop * jitter));
      h = Math.max(minHeight, h - drop);
    }
  }

  // ── Build pyramid base using blended distance metric ──
  const raw = Array.from({ length: SIDE }, (_, i) =>
    Array.from({ length: SIDE }, (_, j) => {
      const d = effDist(i, j);
      let tIdx = 0;
      while (tIdx < terraceCount - 1 && d > radii[tIdx]) tIdx++;
      return terraceHeights[tIdx];
    })
  );

  // ── Ridge walls along terrace edges (65% of seeds) ──
  if (rng() > 0.35) {
    const ridgeBoost = 1 + Math.floor(rng() * 2);
    const ridgeBand = 0.65;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const d = effDist(i, j);
        for (let t = 0; t < terraceCount - 1; t++) {
          if (Math.abs(d - radii[t]) < ridgeBand) {
            raw[i][j] = Math.min(peakHeight, raw[i][j] + ridgeBoost);
            break;
          }
        }
      }
    }
  }

  // ── Crenellations on one terrace edge (45%): alternating +1 teeth ──
  if (rng() > 0.55 && terraceCount > 2) {
    const crenTerrace = 1 + Math.floor(rng() * (terraceCount - 2));
    const crenBand = 0.5;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        if (Math.abs(effDist(i, j) - radii[crenTerrace]) < crenBand) {
          if ((i + j) % 2 === 0) {
            raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
          }
        }
      }
    }
  }

  // ── Moat depression ring (40%): Gaussian trough between outer terraces ──
  if (rng() > 0.6 && range >= 2) {
    const moatRadius = radii[terraceCount - 1] * (0.55 + rng() * 0.30);
    const moatSigma = 1.0 + rng() * 1.2;
    const moatDepth = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const distToRing = Math.hypot(i - cx, j - cx) - moatRadius;
        const drop = Math.round(moatDepth * Math.exp(-(distToRing ** 2) / (2 * moatSigma ** 2)));
        raw[i][j] = Math.max(minHeight, raw[i][j] - drop);
      }
    }
  }

  // ── Multi-tier central spire (2 or 3 stacked Gaussians) ──
  const tierCount = 2 + Math.floor(rng() * 2);
  for (let tier = 0; tier < tierCount; tier++) {
    const sigma = 2.8 - tier * 0.8;
    const amp = Math.round(range * (0.18 + tier * 0.18 + rng() * 0.14));
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const d2 = (i - cx) ** 2 + (j - cx) ** 2;
        raw[i][j] = Math.min(peakHeight,
          raw[i][j] + Math.round(amp * Math.exp(-d2 / (2 * sigma ** 2)))
        );
      }
    }
  }

  // ── Corner towers (55%): raised Gaussian bumps at 4 diagonal corners
  //    of one terrace level — Angkor Wat style ──
  if (rng() > 0.45 && terraceCount > 1) {
    const towerTerrace = Math.floor(rng() * (terraceCount - 1));
    const towerR = radii[towerTerrace];
    const dDiag = towerR / Math.sqrt(2);
    const towerSig = 0.8 + rng() * 0.9;
    const towerAmp = range * (0.15 + rng() * 0.30);
    const corners = [
      [cx - dDiag, cx - dDiag], [cx - dDiag, cx + dDiag],
      [cx + dDiag, cx - dDiag], [cx + dDiag, cx + dDiag],
    ];
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        let bump = 0;
        for (const [ri, ci] of corners) {
          bump += towerAmp * Math.exp(-((i - ri) ** 2 + (j - ci) ** 2) / (2 * towerSig ** 2));
        }
        raw[i][j] = Math.min(peakHeight, raw[i][j] + Math.round(bump));
      }
    }
  }

  // ── Borobudur-style mini-stupas around inner terraces ──
  for (let t = 1; t < terraceCount - 1; t++) {
    if (rng() > 0.5) continue;
    const stupaR = (radii[t - 1] + radii[t]) / 2;
    if (stupaR < 1.5) continue;
    const eightFold = rng() > 0.5;
    const stupaSig = 0.5 + rng() * 0.6;
    const stupaAmp = range * (0.12 + rng() * 0.22);
    const dDiag = stupaR / Math.sqrt(2);
    const positions = [
      [cx - dDiag, cx - dDiag], [cx - dDiag, cx + dDiag],
      [cx + dDiag, cx - dDiag], [cx + dDiag, cx + dDiag],
    ];
    if (eightFold) positions.push(
      [cx, cx - stupaR], [cx, cx + stupaR],
      [cx - stupaR, cx], [cx + stupaR, cx],
    );
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        let bump = 0;
        for (const [ri, ci] of positions) {
          bump += stupaAmp * Math.exp(-((i - ri) ** 2 + (j - ci) ** 2) / (2 * stupaSig ** 2));
        }
        raw[i][j] = Math.min(peakHeight, raw[i][j] + Math.round(bump));
      }
    }
  }

  // ── Satellite spires at mid-radius diagonals (35%): 4 secondary peaks ──
  if (rng() > 0.65 && terraceCount >= 3) {
    const satRadius = radii[Math.floor(terraceCount / 2)] * (0.55 + rng() * 0.3);
    const satSig = 0.9 + rng() * 0.8;
    const satAmp = range * (0.22 + rng() * 0.30);
    const dDiag = satRadius / Math.sqrt(2);
    const satPos = [
      [cx - dDiag, cx - dDiag], [cx - dDiag, cx + dDiag],
      [cx + dDiag, cx - dDiag], [cx + dDiag, cx + dDiag],
    ];
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        let bump = 0;
        for (const [ri, ci] of satPos) {
          bump += satAmp * Math.exp(-((i - ri) ** 2 + (j - ci) ** 2) / (2 * satSig ** 2));
        }
        raw[i][j] = Math.min(peakHeight, raw[i][j] + Math.round(bump));
      }
    }
  }

  // ── Cardinal gateway notches (50%): lower channels along N/S/E/W ──
  if (rng() > 0.5) {
    const notchDepth = 1 + Math.floor(rng() * 2);
    const notchWidth = 0.55 + rng() * 0.75;
    const innerProtect = 4;
    const outerLimit = radii[terraceCount - 1] - 0.5;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const dx = Math.abs(j - cx), dy = Math.abs(i - cx);
        const onAxis = dx < notchWidth || dy < notchWidth;
        if (onAxis && Math.max(dx, dy) > innerProtect && Math.max(dx, dy) < outerLimit) {
          raw[i][j] = Math.max(minHeight, raw[i][j] - notchDepth);
        }
      }
    }
  }

  // ── Diagonal gateway channels (35%): lower channels along NE/SW/NW/SE ──
  if (rng() > 0.65) {
    const dNotchDepth = 1 + Math.floor(rng() * 2);
    const dNotchWidth = 0.45 + rng() * 0.55;
    const innerProtect = 3;
    const outerLimit = radii[terraceCount - 1] * 0.85;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = Math.abs(i - cx), dj = Math.abs(j - cx);
        const onDiag = Math.abs(di - dj) < dNotchWidth;
        const dCenter = Math.hypot(i - cx, j - cx);
        if (onDiag && dCenter > innerProtect && dCenter < outerLimit) {
          raw[i][j] = Math.max(minHeight, raw[i][j] - dNotchDepth);
        }
      }
    }
  }

  // ── Enforce exact 4-fold symmetry (handles all float-rounding drift) ──
  for (let i = 0; i <= 15; i++) {
    for (let j = 0; j <= 15; j++) {
      const i2 = 31 - i, j2 = 31 - j;
      const v = Math.max(minHeight, Math.min(peakHeight,
        Math.round((raw[i][j] + raw[i2][j] + raw[i][j2] + raw[i2][j2]) / 4)
      ));
      raw[i][j] = raw[i2][j] = raw[i][j2] = raw[i2][j2] = v;
    }
  }

  return raw.map((row) => row.map(String));
}

// 4-neighbour box blur, applied N times. Preserves all three symmetries
// because averaging respects symmetric boundary conditions: if the input is
// symmetric across an axis, neighbour sums at mirrored cells are equal too.
function smoothGrid(grid, iterations) {
  let cur = grid.map((row) => row.map(Number));
  for (let n = 0; n < iterations; n++) {
    const next = Array.from({ length: SIDE }, () => new Array(SIDE));
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        let sum = cur[i][j];
        let count = 1;
        if (i > 0) { sum += cur[i - 1][j]; count++; }
        if (i < SIDE - 1) { sum += cur[i + 1][j]; count++; }
        if (j > 0) { sum += cur[i][j - 1]; count++; }
        if (j < SIDE - 1) { sum += cur[i][j + 1]; count++; }
        next[i][j] = Math.round(sum / count);
      }
    }
    cur = next;
  }
  return cur.map((row) => row.map(String));
}

