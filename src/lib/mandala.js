import { makeRng } from './seedrandom.js';
import { validate } from './heightmap.js';

// 32x32 symmetric heightmap generator. All outputs are D2-symmetric (horizontal
// + vertical mirror axes, 180° rotation) and validate() must pass before return.
//
// Five generators are dispatched from generateMandala(opts):
//   classic   — port of d3l33t's mandala-gen2.js (a seeded random walk on one
//               quadrant, mirrored). rotationalOrder picks 2/4/8-fold variant.
//   rings     — concentric Euclidean rings, per-ring height is a uniform draw.
//   temple/cathedral — Greek-cross plan, central crossing spire, gabled arms
//               with rib bays, pinnacle clusters, arm-tip turrets, flying
//               buttresses, cloister + precinct walls.
//   temple/wat — Quincunx 5-tower (Angkor) layout, nested Chebyshev galleries,
//               naga balustrade rhythm, cardinal causeways, outer enclosure.
//   temple/ziggurat — stacked Chebyshev tiers with multi-scale recessed niches,
//               corner buttresses, cardinal staircases, top shrine, precinct.
//
// terraceCount drives complexity for the three temple variants. seed is the
// RNG input via mulberry32+FNV-1a; identical seed → identical output.

const QUADRANT = 16;
const SIDE = 32;

export const DEFAULTS = {
  algorithm: 'classic',
  variance: 2,
  peakHeight: 9,
  startValue: 5,
  rotationalOrder: 4,
  minHeight: 0,
  ringCount: 10,
  terraceCount: 5,
  templeStyle: 'wat',
};

export const TEMPLE_STYLES = ['cathedral', 'wat', 'ziggurat'];

export function generateMandala(opts = {}) {
  const seed = opts.seed ?? 'mandala';
  const rawAlgo = opts.algorithm;
  const algorithm = rawAlgo === 'rings' ? 'rings' : rawAlgo === 'temple' ? 'temple' : 'classic';
  const peakHeight = clampInt(opts.peakHeight ?? DEFAULTS.peakHeight, 1, 9);
  const minHeight = clampInt(opts.minHeight ?? DEFAULTS.minHeight, 0, peakHeight - 1);
  const variance = clampInt(opts.variance ?? DEFAULTS.variance, 1, 4);
  const startValue = clampInt(opts.startValue ?? DEFAULTS.startValue, minHeight, peakHeight);
  const ringCount = clampInt(opts.ringCount ?? DEFAULTS.ringCount, 2, 20);
  const terraceCount = clampInt(opts.terraceCount ?? DEFAULTS.terraceCount, 2, 12);
  const rotationalOrder = opts.rotationalOrder === 2 ? 2 : opts.rotationalOrder === 8 ? 8 : 4;
  const templeStyle = TEMPLE_STYLES.includes(opts.templeStyle) ? opts.templeStyle : DEFAULTS.templeStyle;

  const rng = makeRng(seed);

  let grid;
  if (algorithm === 'rings') {
    grid = generateRings(rng, ringCount, minHeight, peakHeight);
  } else if (algorithm === 'temple') {
    if (templeStyle === 'cathedral') {
      grid = generateCathedral(rng, terraceCount, minHeight, peakHeight);
    } else if (templeStyle === 'ziggurat') {
      grid = generateZiggurat(rng, terraceCount, minHeight, peakHeight);
    } else {
      grid = generateWat(rng, terraceCount, minHeight, peakHeight);
    }
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

// ───────────────────────────────────────────────────────────────────────────
// Temple generators: three architectural sub-styles. Each produces a D2-
// symmetric heightmap (horizontal + vertical mirror axes, 180° rotation).
//
//  - generateCathedral: Greek-cross plan, central crossing spire, gabled
//    arms with rib bays, pinnacle clusters at the crossing, arm-tip turrets,
//    diagonal flying buttresses, cloister wall.
//
//  - generateWat: quincunx 5-tower layout (central sikhara + 4 corner
//    sikharas), nested Chebyshev galleries with naga balustrade rhythm,
//    cardinal causeway depressions, mini-stupa ring.
//
//  - generateZiggurat: stacked Chebyshev tiers with recessed-niche fluting on
//    every tier face (multi-scale), corner buttresses on each tier, cardinal
//    staircase channels, small top temple. Strongly orthogonal silhouette.
//
// Design rules followed throughout:
//  • Every "surface" gets multi-scale relief — no large constant-height patches.
//  • Features are placed at all 4 mirror positions so the final D2 averaging
//    pass doesn't blur them.
//  • terraceCount is the primary complexity dial (matches existing UI knob).
// ───────────────────────────────────────────────────────────────────────────

function enforceD2(raw, minHeight, peakHeight) {
  for (let i = 0; i <= 15; i++) {
    for (let j = 0; j <= 15; j++) {
      const i2 = 31 - i, j2 = 31 - j;
      const v = Math.max(minHeight, Math.min(peakHeight,
        Math.round((raw[i][j] + raw[i2][j] + raw[i][j2] + raw[i2][j2]) / 4)
      ));
      raw[i][j] = raw[i2][j] = raw[i][j2] = raw[i2][j2] = v;
    }
  }
}

// Add a Gaussian bump at each [row, col] position to every cell of `raw`,
// clipped to peakHeight. Caller is responsible for placing positions in
// D2-symmetric configurations (the final enforceD2 pass will average otherwise).
function placeGaussiansAt(raw, positions, amp, sigma, peakHeight) {
  const twoSig2 = 2 * sigma * sigma;
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      let bump = 0;
      for (const [ri, ci] of positions) {
        bump += amp * Math.exp(-((i - ri) ** 2 + (j - ci) ** 2) / twoSig2);
      }
      raw[i][j] = Math.min(peakHeight, raw[i][j] + Math.round(bump));
    }
  }
}

function generateCathedral(rng, terraceCount, minHeight, peakHeight) {
  const cx = (SIDE - 1) / 2;
  const range = peakHeight - minHeight;
  const raw = Array.from({ length: SIDE }, () => new Array(SIDE).fill(minHeight));

  // Greek-cross arm half-width grows with terraceCount (2-12 → ~2.3-5.5).
  const armW = 2.0 + (terraceCount - 2) * 0.32 + rng() * 0.5;
  // Push the precinct closer to the parcel edge so corner zones are full.
  const precinctR = 14.0 + rng() * 0.8;
  const cloisterOuter = 11.5 + rng() * 1.5;
  const naveBase = minHeight + Math.max(1, Math.round(range * 0.22));
  const courtBase = minHeight + Math.max(1, Math.round(range * 0.10));
  const groundBase = minHeight + (range >= 4 ? 1 : 0);

  // ── 1. Lift the entire interior above min-ground so corners aren't barren ──
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
      if (cheb < precinctR) raw[i][j] = groundBase;
    }
  }

  // ── 2. Cloister courtyard in the diagonal corner regions ──
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if (di > armW && dj > armW && Math.max(di, dj) < cloisterOuter) {
        raw[i][j] = Math.max(raw[i][j], courtBase);
      }
    }
  }

  // ── 3. Greek-cross floor plan ──
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if ((di < armW || dj < armW) && Math.max(di, dj) < 15.0) {
        raw[i][j] = Math.max(raw[i][j], naveBase);
      }
    }
  }

  // ── 4. Gable roof ridges along each arm ──
  const ridgePeak = naveBase + Math.max(2, Math.round(range * 0.40));
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if (Math.max(di, dj) >= 15.0) continue;
      if (dj < armW && di < 14) {
        const r = 1 - (dj / armW) * 0.85;
        raw[i][j] = Math.max(raw[i][j], naveBase + Math.round((ridgePeak - naveBase) * r));
      }
      if (di < armW && dj < 14) {
        const r = 1 - (di / armW) * 0.85;
        raw[i][j] = Math.max(raw[i][j], naveBase + Math.round((ridgePeak - naveBase) * r));
      }
    }
  }

  // ── 5. Bay ribs across each arm — alternating +1 along arm length ──
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if (dj < armW && di > armW * 0.6 && di < 14) {
        if (Math.floor(di) % 2 === 0) raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
      }
      if (di < armW && dj > armW * 0.6 && dj < 14) {
        if (Math.floor(dj) % 2 === 0) raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
      }
    }
  }

  // ── 6. Central crossing spire — multi-tier Gaussian, sharp ──
  const spireTiers = 3 + Math.floor(rng() * 2);
  for (let t = 0; t < spireTiers; t++) {
    const sigma = 2.3 - t * 0.5;
    const amp = Math.round(range * (0.16 + t * 0.10 + rng() * 0.04));
    placeGaussiansAt(raw, [[cx, cx]], amp, sigma, peakHeight);
  }

  // ── 7. Arm-tip turrets ──
  const tipDist = 12.5 + rng() * 1.5;
  const tipSig = 0.85 + rng() * 0.25;
  const tipAmp = range * (0.26 + rng() * 0.15);
  placeGaussiansAt(raw, [
    [cx - tipDist, cx], [cx + tipDist, cx],
    [cx, cx - tipDist], [cx, cx + tipDist],
  ], tipAmp, tipSig, peakHeight);

  // ── 8. Pinnacle clusters at the inner corners of the crossing ──
  const pinDist = armW + 1.7 + rng() * 0.4;
  const pinSig = 0.55 + rng() * 0.25;
  const pinAmp = range * (0.20 + rng() * 0.15);
  placeGaussiansAt(raw, [
    [cx - pinDist, cx - pinDist], [cx - pinDist, cx + pinDist],
    [cx + pinDist, cx - pinDist], [cx + pinDist, cx + pinDist],
  ], pinAmp, pinSig, peakHeight);

  // ── 9. Side-chapel cross-protrusions (only when terraceCount allows) ──
  if (terraceCount >= 4) {
    const sOff = 4.5 + Math.floor(rng() * 4);
    const sExt = armW + 1.2;
    placeGaussiansAt(raw, [
      [cx - sOff, cx - sExt], [cx - sOff, cx + sExt],
      [cx + sOff, cx - sExt], [cx + sOff, cx + sExt],
      [cx - sExt, cx - sOff], [cx + sExt, cx - sOff],
      [cx - sExt, cx + sOff], [cx + sExt, cx + sOff],
    ], range * (0.13 + rng() * 0.10), 0.6, peakHeight);
  }

  // ── 10. Corner chapel houses — fill the diagonal courtyard with small buildings ──
  // Four square chapels in the deep corners, each with a low pyramidal roof.
  const chapelR = cloisterOuter * 0.65 + rng() * 0.8;
  const chapelHalf = 1.5 + rng() * 0.6;
  const chapelH = courtBase + 1 + Math.floor(rng() * 2);
  const chapelCenters = [
    [cx - chapelR, cx - chapelR], [cx - chapelR, cx + chapelR],
    [cx + chapelR, cx - chapelR], [cx + chapelR, cx + chapelR],
  ];
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      for (const [cr, cc] of chapelCenters) {
        const dr = Math.abs(i - cr), dc = Math.abs(j - cc);
        if (dr < chapelHalf && dc < chapelHalf) {
          const peak = chapelH + 1;
          const r = 1 - Math.max(dr, dc) / chapelHalf;
          raw[i][j] = Math.max(raw[i][j], chapelH + Math.round((peak - chapelH) * r));
        }
      }
    }
  }

  // ── 11. Flying buttress ribs in the diagonal courtyard zones ──
  const buttressBoost = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if (di < armW + 0.5 || dj < armW + 0.5) continue;
      if (Math.max(di, dj) > cloisterOuter - 0.5) continue;
      const diff = Math.abs(di - dj);
      if (diff < 0.45 || (diff > 2.4 && diff < 3.05)) {
        raw[i][j] = Math.min(peakHeight, raw[i][j] + buttressBoost);
      }
    }
  }

  // ── 12. Cloister outer wall ridge ──
  if (range >= 3) {
    const wallH = courtBase + 1 + Math.floor(rng() * 2);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = Math.abs(i - cx), dj = Math.abs(j - cx);
        if (di < armW || dj < armW) continue;
        const cheb = Math.max(di, dj);
        if (Math.abs(cheb - (cloisterOuter - 0.5)) < 0.55) {
          raw[i][j] = Math.max(raw[i][j], wallH);
        }
      }
    }
  }

  // ── 13. Precinct perimeter wall (outer boundary of the cathedral grounds) ──
  if (range >= 3) {
    const periH = groundBase + 1;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
        if (Math.abs(cheb - precinctR) < 0.55) {
          raw[i][j] = Math.max(raw[i][j], periH);
        }
      }
    }
  }

  // ── 14. Final D2 averaging pass ──
  enforceD2(raw, minHeight, peakHeight);

  return raw.map((row) => row.map(String));
}

function generateWat(rng, terraceCount, minHeight, peakHeight) {
  const cx = (SIDE - 1) / 2;
  const range = peakHeight - minHeight;
  const raw = Array.from({ length: SIDE }, () => new Array(SIDE).fill(minHeight));

  const galleryCount = terraceCount;
  // Outermost gallery starts at min+1 (not 0) so the outer band still has architecture.
  const galleryRamp = 0.45 + rng() * 0.20;
  // Seed picks corner-tower placement: closer-in vs further-out.
  const cornerR = 5.0 + (terraceCount - 4) * 0.25 + rng() * 1.2;

  // ── 1. Nested Chebyshev galleries; height ramps inward toward center ──
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
      const frac = cheb / 15.5;
      const idx = Math.min(galleryCount - 1, Math.floor(frac * galleryCount));
      const inward = (galleryCount - 1 - idx) / Math.max(1, galleryCount - 1);
      raw[i][j] = minHeight + 1 + Math.round(inward * range * galleryRamp);
    }
  }

  // ── 1b. Courtyard tile relief — checkerboard +1 breaks up flat gallery floors ──
  // Phase varies by seed so the tile pattern doesn't always align identically.
  const tilePhase = Math.floor(rng() * 2);
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      // Don't relief the immediate center (would break the central tower base).
      if (Math.max(di, dj) < 1.0) continue;
      if ((Math.floor(di) + Math.floor(dj) + tilePhase) % 2 === 0) {
        raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
      }
    }
  }

  // ── 2. Gallery wall ridges at each gallery boundary ──
  const wallBoost = 1 + (rng() > 0.65 ? 1 : 0);
  for (let g = 1; g < galleryCount; g++) {
    const wallCheb = 15.5 * (g / galleryCount);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
        if (Math.abs(cheb - wallCheb) < 0.55) {
          raw[i][j] = Math.min(peakHeight, raw[i][j] + wallBoost);
        }
      }
    }
  }

  // ── 3. Naga balustrade — rhythmic +1 every 2 cells along each gallery wall ──
  // Seed-driven phase shift makes each seed's naga rhythm different.
  for (let g = 1; g < galleryCount; g++) {
    const wallCheb = 15.5 * (g / galleryCount);
    const phase = Math.floor(rng() * 2);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = Math.abs(i - cx), dj = Math.abs(j - cx);
        const cheb = Math.max(di, dj);
        if (Math.abs(cheb - wallCheb) >= 1.0) continue;
        const running = di > dj ? dj : di;
        if ((Math.floor(running) + phase) % 2 === 0) {
          raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
        }
      }
    }
  }

  // ── 4. Quincunx sikharas: central + 4 corner towers ──
  // Central tower is the tallest. Corner towers boosted so they read clearly
  // against the gallery base. Each tower is a multi-tier corbeled stack.
  const cornerScale = 0.78 + rng() * 0.12;
  const placeTower = (tr, tc, scale, sharpness) => {
    const ttiers = 4 + Math.floor(rng() * 3);
    for (let t = 0; t < ttiers; t++) {
      const sigma = (2.4 - t * 0.42) * scale * sharpness;
      const amp = Math.round(range * scale * (0.13 + t * 0.09));
      placeGaussiansAt(raw, [[tr, tc]], amp, sigma, peakHeight);
    }
  };
  placeTower(cx, cx, 1.0, 1.0);
  placeTower(cx - cornerR, cx - cornerR, cornerScale, 0.95);
  placeTower(cx - cornerR, cx + cornerR, cornerScale, 0.95);
  placeTower(cx + cornerR, cx - cornerR, cornerScale, 0.95);
  placeTower(cx + cornerR, cx + cornerR, cornerScale, 0.95);

  // ── 5. Cardinal mini-prangs (4 small towers between the corner towers) ──
  // Sits on the cardinal axes at roughly cornerR — creates an 8-spire cross-quincunx
  // when present. Seed gate so not every wat has them.
  if (rng() > 0.35) {
    const cardR = cornerR * (0.85 + rng() * 0.25);
    const cardSig = 0.55 + rng() * 0.2;
    const cardAmp = range * (0.18 + rng() * 0.12);
    placeGaussiansAt(raw, [
      [cx - cardR, cx], [cx + cardR, cx], [cx, cx - cardR], [cx, cx + cardR],
    ], cardAmp, cardSig, peakHeight);
  }

  // ── 6. Mini-stupa ring just inside the innermost gallery ──
  if (galleryCount >= 3) {
    const stupaR = 15.5 * (1 / galleryCount) * (1.3 + rng() * 0.5);
    const diag = stupaR * 0.707;
    placeGaussiansAt(raw, [
      [cx - stupaR, cx], [cx + stupaR, cx],
      [cx, cx - stupaR], [cx, cx + stupaR],
      [cx - diag, cx - diag], [cx - diag, cx + diag],
      [cx + diag, cx - diag], [cx + diag, cx + diag],
    ], range * (0.09 + rng() * 0.06), 0.4, peakHeight);
  }

  // ── 7. Cardinal causeway depressions (4 channels into the heart) ──
  const cwDepth = 1;
  const cwWidth = 0.5 + rng() * 0.3;
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if (dj < cwWidth && di > 2 && di < 14) {
        raw[i][j] = Math.max(minHeight, raw[i][j] - cwDepth);
      }
      if (di < cwWidth && dj > 2 && dj < 14) {
        raw[i][j] = Math.max(minHeight, raw[i][j] - cwDepth);
      }
    }
  }

  // ── 8. Diagonal causeways to corner towers (subtle uplift ridge) ──
  if (rng() > 0.35) {
    const diagBoost = 1;
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = Math.abs(i - cx), dj = Math.abs(j - cx);
        if (Math.abs(di - dj) < 0.5 && di > 1.5 && di < cornerR - 0.5) {
          raw[i][j] = Math.min(peakHeight, raw[i][j] + diagBoost);
        }
      }
    }
  }

  // ── 9. Outer enclosure wall (the famous Angkor Wat outer perimeter) ──
  if (range >= 3) {
    const encloseR = 14.0;
    const encH = minHeight + 1 + Math.floor(rng() * 2);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
        if (Math.abs(cheb - encloseR) < 0.55) {
          raw[i][j] = Math.max(raw[i][j], encH);
        }
      }
    }
  }

  // ── 10. Final D2 averaging pass ──
  enforceD2(raw, minHeight, peakHeight);

  return raw.map((row) => row.map(String));
}

function generateZiggurat(rng, terraceCount, minHeight, peakHeight) {
  const cx = (SIDE - 1) / 2;
  const range = peakHeight - minHeight;
  const raw = Array.from({ length: SIDE }, () => new Array(SIDE).fill(minHeight));

  const tiers = terraceCount;
  // Seed-driven base/top dimensions and tier shrink curve.
  const baseHalfW = 13.8 + rng() * 1.0;
  const minHalfW = 1.4 + rng() * 0.9;
  // Power < 1 → tiers shrink faster at the bottom (broad base, pointy top).
  // Power > 1 → tiers stay wide longer (squat). Seed picks one of three feels.
  const shrinkPow = 0.65 + rng() * 0.75;

  const tierWidths = [];
  const tierHeights = [];
  for (let k = 0; k < tiers; k++) {
    const fraction = tiers === 1 ? 0 : k / (tiers - 1);
    const shrunk = Math.pow(fraction, shrinkPow);
    tierWidths.push(baseHalfW - (baseHalfW - minHalfW) * shrunk);
    tierHeights.push(minHeight + Math.round(((k + 1) / tiers) * range * 0.9));
  }

  // ── 1. Stack tier squares; later (smaller, taller) tiers override earlier ──
  for (let k = 0; k < tiers; k++) {
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
        if (cheb < tierWidths[k]) raw[i][j] = Math.max(raw[i][j], tierHeights[k]);
      }
    }
  }

  // ── 2. Wall-edge cornice ridge on each tier rim ──
  const corniceBoost = 1 + (rng() > 0.7 ? 1 : 0);
  for (let k = 0; k < tiers; k++) {
    const wallCheb = tierWidths[k];
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
        if (Math.abs(cheb - wallCheb) < 0.55) {
          raw[i][j] = Math.min(peakHeight, raw[i][j] + corniceBoost);
        }
      }
    }
  }

  // ── 3. Recessed niche fluting — the defining ziggurat feature ──
  // Seed picks niche period (2 or 3 cells) and phase per tier.
  const nichePeriod = rng() > 0.55 ? 2 : 3;
  const nicheDeep = 1 + (rng() > 0.65 ? 1 : 0);
  for (let k = 0; k < tiers; k++) {
    const outerHalfW = tierWidths[k];
    const innerHalfW = k < tiers - 1 ? tierWidths[k + 1] : 0;
    if (outerHalfW - innerHalfW < 0.5) continue;
    const phase = Math.floor(rng() * nichePeriod);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = Math.abs(i - cx), dj = Math.abs(j - cx);
        const cheb = Math.max(di, dj);
        if (cheb >= outerHalfW || cheb < innerHalfW) continue;
        const running = di > dj ? dj : di;
        if ((Math.floor(running) + phase) % nichePeriod === 0) {
          raw[i][j] = Math.max(minHeight, raw[i][j] - nicheDeep);
        }
      }
    }
  }

  // ── 4. Secondary fluting: a +1 buttress strip in mid-annulus of each tier ──
  // Adds a second rhythm at half the niche frequency for fractal feel.
  const subPeriod = nichePeriod * 2;
  for (let k = 0; k < tiers; k++) {
    const outerHalfW = tierWidths[k];
    const innerHalfW = k < tiers - 1 ? tierWidths[k + 1] : 0;
    if (outerHalfW - innerHalfW < 1.5) continue;
    const phase = Math.floor(rng() * subPeriod);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = Math.abs(i - cx), dj = Math.abs(j - cx);
        const cheb = Math.max(di, dj);
        if (cheb >= outerHalfW || cheb < innerHalfW) continue;
        const depthFrac = (cheb - innerHalfW) / Math.max(0.5, outerHalfW - innerHalfW);
        if (depthFrac > 0.30 && depthFrac < 0.70) {
          const running = di > dj ? dj : di;
          if ((Math.floor(running) + phase) % subPeriod === 0) {
            raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
          }
        }
      }
    }
  }

  // ── 5. Cardinal staircase ramps — depressed channel along each axis ──
  const stairWidth = 0.55 + rng() * 0.35;
  const stairDepth = 1 + (rng() > 0.7 ? 1 : 0);
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if (dj < stairWidth && di < tierWidths[0] - 0.3 && di > tierWidths[tiers - 1]) {
        raw[i][j] = Math.max(minHeight, raw[i][j] - stairDepth);
      }
      if (di < stairWidth && dj < tierWidths[0] - 0.3 && dj > tierWidths[tiers - 1]) {
        raw[i][j] = Math.max(minHeight, raw[i][j] - stairDepth);
      }
    }
  }

  // ── 6. Corner buttress bumps on each tier (some seeds skip; others stack) ──
  const cornerStrength = 0.7 + rng() * 0.7;
  for (let k = 0; k < tiers; k++) {
    const off = tierWidths[k] - 0.6;
    if (off < 1) continue;
    placeGaussiansAt(raw, [
      [cx - off, cx - off], [cx - off, cx + off],
      [cx + off, cx - off], [cx + off, cx + off],
    ], cornerStrength, 0.45, peakHeight);
  }

  // ── 7. Optional cardinal pylon bumps (mid-face turrets, every other tier) ──
  if (rng() > 0.45) {
    const pylonStride = 1 + Math.floor(rng() * 2);
    for (let k = 0; k < tiers - 1; k += pylonStride) {
      const off = tierWidths[k] - 0.5;
      if (off < 1) continue;
      placeGaussiansAt(raw, [
        [cx - off, cx], [cx + off, cx], [cx, cx - off], [cx, cx + off],
      ], 1.1, 0.55, peakHeight);
    }
  }

  // ── 8. Top shrine — small block at the apex ──
  const shrineExtent = rng() > 0.5 ? 1.0 : 1.5;
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if (di < shrineExtent && dj < shrineExtent) {
        raw[i][j] = peakHeight;
      } else if (di < shrineExtent + 0.7 && dj < shrineExtent + 0.7) {
        raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
      }
    }
  }

  // ── 9. Surrounding precinct wall (breaks up h=0 ground around base) ──
  if (range >= 3) {
    const precinctR = baseHalfW + 1.0;
    if (precinctR < 15.5) {
      const precinctH = minHeight + 1;
      for (let i = 0; i < SIDE; i++) {
        for (let j = 0; j < SIDE; j++) {
          const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
          if (Math.abs(cheb - precinctR) < 0.55) {
            raw[i][j] = Math.max(raw[i][j], precinctH);
          }
        }
      }
    }
  }

  // ── 10. Final D2 averaging pass ──
  enforceD2(raw, minHeight, peakHeight);

  return raw.map((row) => row.map(String));
}


