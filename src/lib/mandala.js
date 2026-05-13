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

// Temple generator: multi-scale fractal stepped pyramid. Layers of detail from
// full-grid terraces down to single-pixel micro-steps, all 4-fold symmetric.
//
// Pipeline:
//  1. Blended Chebyshev+Euclidean distance with dual-frequency star shaping
//  2. Variable-width terraces with seed-driven height drops
//  3. Sub-terrace half-steps inside every terrace band
//  4. Angular modulation rings at 3–5 radial bands × 2–3 frequencies
//  5. Dense ridge walls on every terrace boundary
//  6. Multi-octave trig noise (3 harmonics, edge-weighted so center stays clean)
//  7. Radial spoke ridges (4/8/12-fold)
//  8. Multiple moat rings
//  9. Recursive tower clusters: 1–3 levels, each with 4 mini-towers
// 10. Dense stupa rings on every intermediate terrace
// 11. Satellite spire clusters at 2–3 radii
// 12. Crenellations on multiple terrace edges
// 13. Cardinal + diagonal gateway channels
// 14. Central 3–5-tier Gaussian spire (guarantees center = peakHeight)
// 15. Final 4-fold symmetry averaging pass
function generateTemple(rng, terraceCount, minHeight, peakHeight) {
  const cx = (SIDE - 1) / 2; // 15.5
  const range = peakHeight - minHeight;
  const maxRadius = cx + 0.5; // 16

  // ── 1. Dual-frequency distance metric ──
  const octMix = rng() * 0.70;
  const starAmp = (rng() > 0.5 ? 1 : -1) * (0.06 + rng() * 0.22);
  const star2Amp = (rng() > 0.5 ? 1 : -1) * (0.03 + rng() * 0.12);

  function effDist(i, j) {
    const di = i - cx, dj = j - cx;
    const cheby = Math.max(Math.abs(di), Math.abs(dj));
    const eucl = Math.hypot(di, dj);
    const angle = Math.atan2(di, dj);
    const d = cheby * (1 - octMix) + eucl * octMix;
    const mod = 1 + starAmp * Math.cos(4 * angle) + star2Amp * Math.cos(8 * angle);
    return d / Math.max(0.3, mod);
  }

  // ── 2. Terrace layout ──
  const weights = Array.from({ length: terraceCount }, () => 0.35 + rng() * 1.3);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const radii = [];
  let acc = 0;
  for (let t = 0; t < terraceCount; t++) {
    acc += weights[t];
    radii.push((acc / totalW) * maxRadius);
  }

  const terraceHeights = [];
  let h = peakHeight;
  for (let t = 0; t < terraceCount; t++) {
    terraceHeights.push(h);
    if (t < terraceCount - 1) {
      const remaining = terraceCount - t - 1;
      const drop = Math.max(1, Math.round(((h - minHeight) / (remaining + 1)) * (0.5 + rng() * 1.0)));
      h = Math.max(minHeight, h - drop);
    }
  }

  const raw = Array.from({ length: SIDE }, (_, i) =>
    Array.from({ length: SIDE }, (_, j) => {
      const d = effDist(i, j);
      let t = 0;
      while (t < terraceCount - 1 && d > radii[t]) t++;
      return terraceHeights[t];
    })
  );

  // ── 3. Sub-terrace half-steps: a +1 band in the inner half of every terrace ──
  for (let t = 0; t < terraceCount - 1; t++) {
    const innerR = t > 0 ? radii[t - 1] : 0;
    const outerR = radii[t];
    const midR = innerR + (outerR - innerR) * (0.3 + rng() * 0.4);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const d = effDist(i, j);
        if (d >= innerR && d < midR) {
          raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
        }
      }
    }
  }

  // ── 4. Angular modulation bands: sinusoidal ripples at multiple scales ──
  // Frequencies must be multiples of 4 to preserve 4-fold symmetry.
  const angFreqs = [4, 8, 12, 16, 20];
  const angLayerCount = 3 + Math.floor(rng() * 3);
  for (let layer = 0; layer < angLayerCount; layer++) {
    const freq = angFreqs[Math.floor(rng() * angFreqs.length)];
    const innerR = rng() * maxRadius * 0.25;
    const outerR = innerR + maxRadius * (0.12 + rng() * 0.55);
    const amp = range >= 3 ? (1 + Math.floor(rng() * 2)) : 1;
    const phase = Math.floor(rng() * 4) * (Math.PI / 2); // 0/90/180/270 keeps 4-fold
    const fadeDist = Math.max(0.5, (outerR - innerR) * 0.18);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const d = Math.hypot(i - cx, j - cx);
        if (d < innerR || d > outerR) continue;
        const angle = Math.atan2(i - cx, j - cx);
        const wave = (Math.cos(freq * angle + phase) + 1) * 0.5;
        const fadeIn = Math.min(1, (d - innerR) / fadeDist);
        const fadeOut = Math.min(1, (outerR - d) / fadeDist);
        raw[i][j] = Math.min(peakHeight, Math.max(minHeight,
          raw[i][j] + Math.round(amp * wave * Math.min(fadeIn, fadeOut))
        ));
      }
    }
  }

  // ── 5. Ridge walls on every terrace boundary ──
  const ridgeBoost = 1 + Math.floor(rng() * 2);
  const ridgeBand = 0.55 + rng() * 0.4;
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

  // ── 6. Multi-octave trig noise (3 harmonics, edge-weighted) ──
  // Generated in first quadrant and mirrored for exact symmetry.
  if (range >= 2) {
    const nScale = 0.28 + rng() * 0.45;
    const nAmp = 1 + Math.floor(rng() * 2);
    const phX = rng() * 80, phY = rng() * 80;
    for (let i = 0; i <= 15; i++) {
      for (let j = 0; j <= 15; j++) {
        const n = (
          Math.sin((i + phX) * nScale) * Math.cos((j + phY) * nScale) +
          Math.sin((i + phX) * nScale * 2.17) * Math.cos((j + phY) * nScale * 2.17) * 0.5 +
          Math.sin((i + phX) * nScale * 4.31) * Math.cos((j + phY) * nScale * 4.31) * 0.25
        ) / 1.75;
        const d = Math.hypot(i - cx, j - cx);
        const edgeW = Math.min(1, d / (maxRadius * 0.3)); // zero at center, full at edge
        const val = Math.round(nAmp * n * edgeW);
        for (const [ii, jj] of [[i, j], [31 - i, j], [i, 31 - j], [31 - i, 31 - j]]) {
          raw[ii][jj] = Math.min(peakHeight, Math.max(minHeight, raw[ii][jj] + val));
        }
      }
    }
  }

  // ── 7. Radial spoke ridges ──
  if (rng() > 0.25) {
    const spokeCount = 4 * (1 + Math.floor(rng() * 3));
    const spokeWidth = 0.25 + rng() * 0.55;
    const spokeBoost = 1 + Math.floor(rng() * 2);
    const innerProtect = 2.5;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = i - cx, dj = j - cx;
        const d = Math.hypot(di, dj);
        if (d < innerProtect) continue;
        const angle = Math.atan2(di, dj);
        let near = false;
        for (let s = 0; s < spokeCount; s++) {
          const sa = (s / spokeCount) * Math.PI * 2;
          let diff = Math.abs(angle - sa);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff * d < spokeWidth) { near = true; break; }
        }
        if (near) raw[i][j] = Math.min(peakHeight, raw[i][j] + spokeBoost);
      }
    }
  }

  // ── 8. Multiple moat rings ──
  const moatCount = 1 + Math.floor(rng() * 3);
  for (let m = 0; m < moatCount; m++) {
    if (range < 2) break;
    const moatR = maxRadius * (0.25 + m * 0.22 + rng() * 0.12);
    const moatSig = 0.5 + rng() * 1.0;
    const moatDepth = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const dist = Math.hypot(i - cx, j - cx) - moatR;
        raw[i][j] = Math.max(minHeight,
          raw[i][j] - Math.round(moatDepth * Math.exp(-(dist ** 2) / (2 * moatSig ** 2)))
        );
      }
    }
  }

  // ── 9. Recursive tower clusters: 1–3 levels, each with 4 mini-towers ──
  const towerLevels = 1 + Math.floor(rng() * Math.min(3, terraceCount - 1));
  for (let level = 0; level < towerLevels; level++) {
    const tR = radii[level] * (0.65 + rng() * 0.3);
    const dDiag = tR / Math.sqrt(2);
    const tSig = 0.55 + rng() * 1.1;
    const tAmp = range * (0.12 + rng() * 0.35);
    const eightFold = rng() > 0.35;
    const tPos = [
      [cx - dDiag, cx - dDiag], [cx - dDiag, cx + dDiag],
      [cx + dDiag, cx - dDiag], [cx + dDiag, cx + dDiag],
    ];
    if (eightFold) tPos.push(
      [cx, cx - tR], [cx, cx + tR], [cx - tR, cx], [cx + tR, cx]
    );
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        let bump = 0;
        for (const [ri, ci] of tPos) {
          bump += tAmp * Math.exp(-((i - ri) ** 2 + (j - ci) ** 2) / (2 * tSig ** 2));
        }
        raw[i][j] = Math.min(peakHeight, raw[i][j] + Math.round(bump));
      }
    }
    // Mini-towers orbiting each main tower
    if (rng() > 0.3) {
      const mR = tSig * 1.8;
      const mSig = 0.35 + rng() * 0.55;
      const mAmp = tAmp * 0.45;
      for (const [ri, ci] of tPos) {
        const mPos = [
          [ri - mR * 0.7, ci - mR * 0.7], [ri - mR * 0.7, ci + mR * 0.7],
          [ri + mR * 0.7, ci - mR * 0.7], [ri + mR * 0.7, ci + mR * 0.7],
        ];
        for (let i = 0; i < SIDE; i++) {
          for (let j = 0; j < SIDE; j++) {
            let bump = 0;
            for (const [mri, mci] of mPos) {
              bump += mAmp * Math.exp(-((i - mri) ** 2 + (j - mci) ** 2) / (2 * mSig ** 2));
            }
            raw[i][j] = Math.min(peakHeight, raw[i][j] + Math.round(bump));
          }
        }
      }
    }
  }

  // ── 10. Stupa rings on every intermediate terrace ──
  for (let t = 1; t < terraceCount; t++) {
    if (rng() > 0.55) continue;
    const sR = t < terraceCount - 1 ? (radii[t - 1] + radii[t]) / 2 : radii[t - 1] * 1.1;
    if (sR < 1.5) continue;
    const sSig = 0.4 + rng() * 0.85;
    const sAmp = range * (0.1 + rng() * 0.22);
    const eightFold = rng() > 0.4;
    const dDiag = sR / Math.sqrt(2);
    const sPos = [
      [cx - dDiag, cx - dDiag], [cx - dDiag, cx + dDiag],
      [cx + dDiag, cx - dDiag], [cx + dDiag, cx + dDiag],
    ];
    if (eightFold) sPos.push(
      [cx, cx - sR], [cx, cx + sR], [cx - sR, cx], [cx + sR, cx]
    );
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        let bump = 0;
        for (const [ri, ci] of sPos) {
          bump += sAmp * Math.exp(-((i - ri) ** 2 + (j - ci) ** 2) / (2 * sSig ** 2));
        }
        raw[i][j] = Math.min(peakHeight, raw[i][j] + Math.round(bump));
      }
    }
  }

  // ── 11. Satellite spire clusters at 2–3 radii ──
  const satLayers = 2 + Math.floor(rng() * 2);
  for (let sl = 0; sl < satLayers && sl < terraceCount - 1; sl++) {
    const satR = radii[sl] * (0.35 + rng() * 0.55);
    const satSig = 0.55 + rng() * 1.0;
    const satAmp = range * (0.14 + rng() * 0.28);
    const dDiag = satR / Math.sqrt(2);
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

  // ── 12. Crenellations on multiple terrace edges ──
  const crenCount = Math.floor(rng() * Math.min(3, terraceCount - 1));
  for (let c = 0; c < crenCount; c++) {
    const crenT = 1 + Math.floor(rng() * Math.max(1, terraceCount - 2));
    const crenBand = 0.4 + rng() * 0.45;
    const crenStep = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        if (Math.abs(effDist(i, j) - radii[crenT]) < crenBand && (i + j) % 2 === 0) {
          raw[i][j] = Math.min(peakHeight, raw[i][j] + crenStep);
        }
      }
    }
  }

  // ── 13. Gateway channels (cardinal + diagonal) ──
  if (rng() > 0.2) {
    const nDepth = 1 + Math.floor(rng() * 2);
    const nWidth = 0.4 + rng() * 0.8;
    const innerP = 3 + Math.floor(rng() * 3);
    const outerL = radii[terraceCount - 1] - 0.3;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const dx = Math.abs(j - cx), dy = Math.abs(i - cx);
        if ((dx < nWidth || dy < nWidth) && Math.max(dx, dy) > innerP && Math.max(dx, dy) < outerL) {
          raw[i][j] = Math.max(minHeight, raw[i][j] - nDepth);
        }
      }
    }
  }
  if (rng() > 0.3) {
    const dDepth = 1 + Math.floor(rng() * 2);
    const dWidth = 0.35 + rng() * 0.6;
    const innerP = 3;
    const outerL = radii[terraceCount - 1] * 0.9;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = Math.abs(i - cx), dj = Math.abs(j - cx);
        const d = Math.hypot(i - cx, j - cx);
        if (Math.abs(di - dj) < dWidth && d > innerP && d < outerL) {
          raw[i][j] = Math.max(minHeight, raw[i][j] - dDepth);
        }
      }
    }
  }

  // ── 14. Central spire (3–5 stacked Gaussians) — applied last so center = peakHeight ──
  const tierCount = 3 + Math.floor(rng() * 3);
  for (let tier = 0; tier < tierCount; tier++) {
    const sigma = 3.8 - tier * 0.55;
    const amp = Math.round(range * (0.10 + tier * 0.14 + rng() * 0.12));
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const d2 = (i - cx) ** 2 + (j - cx) ** 2;
        raw[i][j] = Math.min(peakHeight,
          raw[i][j] + Math.round(amp * Math.exp(-d2 / (2 * sigma ** 2)))
        );
      }
    }
  }

  // ── 15. Enforce exact 4-fold symmetry ──
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

