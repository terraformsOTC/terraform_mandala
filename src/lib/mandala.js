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
  algorithm: 'walk',
  variance: 2,
  peakHeight: 9,
  startValue: 5,
  rotationalOrder: 4,
  minHeight: 0,
  bias: 0,
  ringCount: 6,
  smoothing: 0,
  invert: false,
};

export function generateMandala(opts = {}) {
  const seed = opts.seed ?? 'mandala';
  const algorithm = opts.algorithm === 'rings' ? 'rings' : 'walk';
  const peakHeight = clampInt(opts.peakHeight ?? DEFAULTS.peakHeight, 1, 9);
  const minHeight = clampInt(opts.minHeight ?? DEFAULTS.minHeight, 0, peakHeight - 1);
  const variance = clampInt(opts.variance ?? DEFAULTS.variance, 1, 4);
  const startValue = clampInt(opts.startValue ?? DEFAULTS.startValue, minHeight, peakHeight);
  const bias = clampInt(opts.bias ?? DEFAULTS.bias, -2, 2);
  const ringCount = clampInt(opts.ringCount ?? DEFAULTS.ringCount, 2, 16);
  const smoothing = clampInt(opts.smoothing ?? DEFAULTS.smoothing, 0, 3);
  const invert = !!opts.invert;
  const rotationalOrder = opts.rotationalOrder === 8 ? 8 : 4;

  const rng = makeRng(seed);

  let grid;
  if (algorithm === 'rings') {
    grid = generateRings(rng, ringCount, minHeight, peakHeight);
  } else {
    const quadrant = walkQuadrant(rng, variance, peakHeight, startValue, minHeight, bias);
    diagonalMirror(quadrant);
    if (rotationalOrder === 8) symmetrizeMainDiagonal(quadrant);
    grid = expandToFullGrid(quadrant);
  }

  if (smoothing > 0) grid = smoothGrid(grid, smoothing);
  if (invert) grid = invertGrid(grid, minHeight, peakHeight);

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

function walkQuadrant(rng, variance, peakHeight, startValue, minHeight, bias) {
  const q = Array.from({ length: QUADRANT }, () => Array(QUADRANT).fill(null));
  let last = startValue;
  for (let i = 0; i < QUADRANT; i++) {
    for (let j = 0; j < QUADRANT; j++) {
      if (QUADRANT - i - 1 <= j) {
        const step = Math.floor(rng() * (variance * 2 + 1)) - variance + bias;
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

// Per-cell reflection: keeps height inside [minHeight, peakHeight] by using
// the user's range as the pivot rather than the absolute 0..9 range.
function invertGrid(grid, minHeight, peakHeight) {
  const sum = minHeight + peakHeight;
  return grid.map((row) =>
    row.map((c) => String(Math.max(minHeight, Math.min(peakHeight, sum - Number(c))))),
  );
}
