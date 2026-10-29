import { makeRng } from './seedrandom.js';
import { validate } from './heightmap.js';

// 32x32 heightmap generator. Every pattern but two ring styles is D2-symmetric
// (horizontal + vertical mirror axes, 180° rotation); the wheel is 4-fold
// rotational (90° and 180°) with no mirror axis; horus is a copy of a dreamt
// image and has no symmetry at all. The check runs before return.
//
// The generators dispatched from generateMandala(opts):
//   classic   — port of d3l33t's mandala-gen2.js (a seeded random walk on one
//               quadrant, mirrored). rotationalOrder picks 2/4/8-fold variant.
//   rings/concentric — concentric Euclidean rings, per-ring height is a uniform draw.
//   temple/cathedral — Greek-cross plan, central crossing spire, gabled arms
//               with rib bays, pinnacle clusters, arm-tip turrets, flying
//               buttresses, cloister + precinct walls.
//   temple/wat — Quincunx 5-tower (Angkor) layout, nested Chebyshev galleries,
//               naga balustrade rhythm, cardinal causeways, outer enclosure.
//   temple/ziggurat — stacked Chebyshev tiers with multi-scale recessed niches,
//               corner buttresses, cardinal staircases, top shrine, precinct.
//   rings/wheel — after parcel #7463: hub, cone, a turning cross and seeded
//               spokes set off the radius. 4-fold ROTATIONAL symmetry only, no
//               mirror axis (see generateWheel).
//   rings/horus — the Eye of Horus heightmap dreamt by 0x1a86…a0cb, copied
//               line for line; its three heights (lines, edges, ground) are
//               set freely, its lines never move (see generateHorus).
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
  ringStyle: 'concentric',
  horusLine: 9,     // the dream's own heights: lines 9, their edges 6, ground 0
  horusEdge: 6,
  horusGround: 0,
  eye: 'horus',      // 'ra' is the mirror image
  halo: 0,
  grain: 0,
  spokeCount: 3,
  twist: 2,
  spin: 'ccw',   // #7463 turns counterclockwise
};

export const TEMPLE_STYLES = ['cathedral', 'wat', 'ziggurat'];
export const RING_STYLES = ['concentric', 'wheel', 'horus'];
export const HORUS_EYES = ['horus', 'ra'];
export const HALO_MAX = 8;   // rings; a halo can have at most |line - ground| - 1 of them

// How many halo rings fit between the eye's line height and its ground.
export function haloRoom(line, ground) {
  return Math.max(0, Math.abs(line - ground) - 1);
}

export function generateMandala(opts = {}) {
  const seed = opts.seed ?? 'mandala';
  const rawAlgo = opts.algorithm;
  const algorithm = ['rings', 'temple'].includes(rawAlgo) ? rawAlgo : 'classic';
  const ringStyle = RING_STYLES.includes(opts.ringStyle) ? opts.ringStyle : DEFAULTS.ringStyle;
  const isWheel = algorithm === 'rings' && ringStyle === 'wheel';
  const isHorus = algorithm === 'rings' && ringStyle === 'horus';
  const peakHeight = clampInt(opts.peakHeight ?? DEFAULTS.peakHeight, 1, 9);
  const minHeight = clampInt(opts.minHeight ?? DEFAULTS.minHeight, 0, peakHeight - 1);
  const variance = clampInt(opts.variance ?? DEFAULTS.variance, 1, 4);
  const startValue = clampInt(opts.startValue ?? DEFAULTS.startValue, minHeight, peakHeight);
  const ringCount = clampInt(opts.ringCount ?? DEFAULTS.ringCount, 2, 20);
  const terraceCount = clampInt(opts.terraceCount ?? DEFAULTS.terraceCount, 2, 12);
  const rotationalOrder = opts.rotationalOrder === 2 ? 2 : opts.rotationalOrder === 8 ? 8 : 4;
  const templeStyle = TEMPLE_STYLES.includes(opts.templeStyle) ? opts.templeStyle : DEFAULTS.templeStyle;
  const spokeCount = clampInt(opts.spokeCount ?? DEFAULTS.spokeCount, 1, 5);
  const twist = clampInt(opts.twist ?? DEFAULTS.twist, 0, 5);
  const spin = WHEEL_SPINS.includes(opts.spin) ? opts.spin : DEFAULTS.spin;
  const horusLine = clampInt(opts.horusLine ?? DEFAULTS.horusLine, 0, 9);
  const horusEdge = clampInt(opts.horusEdge ?? DEFAULTS.horusEdge, 0, 9);
  const horusGround = clampInt(opts.horusGround ?? DEFAULTS.horusGround, 0, 9);
  const eye = HORUS_EYES.includes(opts.eye) ? opts.eye : DEFAULTS.eye;
  const halo = clampInt(opts.halo ?? DEFAULTS.halo, 0, HALO_MAX);
  const grain = clampInt(opts.grain ?? DEFAULTS.grain, 0, 3);

  const rng = makeRng(seed);

  let grid;
  if (isHorus) {
    grid = generateHorus(rng, horusLine, horusEdge, horusGround, grain, eye, halo);
  } else if (isWheel) {
    grid = generateWheel(rng, spokeCount, twist, spin, minHeight, peakHeight);
  } else if (algorithm === 'rings') {
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
  const symmetric = isHorus
    ? true   // a copy of a dreamt image: no symmetry to check
    : isWheel
    ? isFourFold(heightmap)
    : v.vertical_sym && v.horizontal_sym && v.rotational_sym;
  if (!v.lengthOk || !v.allDigits || !symmetric) {
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
//  - generateWat: Thai/Khmer prang-style temple complex. Stepped pedestal
//    terraces support a central prang that tapers in discrete Chebyshev
//    steps to a needle finial at peakHeight. Each step is fringed with
//    crockets (cardinal+diagonal +1 bumps), wing-prangs project at
//    mid-height, four corner satellite prangs repeat the stepped-and-
//    crocketed pattern at smaller scale, cardinal mini-prangs and an
//    outer chedi ring fill the precinct, with naga balustrades on every
//    tier rim and cardinal causeway depressions for entry paths.
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

  // ── 1. Pedestal terraces (Mount Meru base) ──
  // Stepped Chebyshev pyramid from outer perimeter inward. Total rise capped
  // at ~30% of range so there's plenty of vertical room for the spires above.
  const pedTiers = Math.max(1, Math.min(terraceCount, 3 + Math.floor(rng() * 2)));
  const pedRise = Math.max(1, Math.min(pedTiers, Math.round(range * 0.30)));
  const pedTierH = Math.max(1, Math.floor(pedRise / pedTiers));
  const pedMaxCheb = 13.0;
  const pedTopH = minHeight + 1 + pedTierH * pedTiers;
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
      if (cheb >= pedMaxCheb) continue;
      const idx = Math.floor((1 - cheb / pedMaxCheb) * pedTiers);
      raw[i][j] = Math.max(raw[i][j], Math.min(peakHeight, minHeight + 1 + idx * pedTierH));
    }
  }

  // ── 2. Tier-rim ridges (+1 right at each terrace boundary) ──
  for (let t = 1; t <= pedTiers; t++) {
    const rimCheb = pedMaxCheb * (1 - t / pedTiers);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
        if (Math.abs(cheb - rimCheb) < 0.55) {
          raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
        }
      }
    }
  }

  // ── 3. Naga balustrade — rhythmic +1 every 2 cells along each tier rim ──
  for (let t = 1; t <= pedTiers; t++) {
    const rimCheb = pedMaxCheb * (1 - t / pedTiers);
    const phase = Math.floor(rng() * 2);
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const di = Math.abs(i - cx), dj = Math.abs(j - cx);
        const cheb = Math.max(di, dj);
        if (Math.abs(cheb - rimCheb) >= 1.0) continue;
        const running = di > dj ? dj : di;
        if ((Math.floor(running) + phase) % 2 === 0) {
          raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
        }
      }
    }
  }

  // ── 4. Courtyard tile relief — checkerboard +1 breaks any wide flat patches ──
  // Applied only on the open pedestal floor (outside the prang footprint).
  const tilePhase = Math.floor(rng() * 2);
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
      if (cheb < 5.0 || cheb >= pedMaxCheb) continue;
      const di = Math.floor(Math.abs(i - cx)), dj = Math.floor(Math.abs(j - cx));
      if ((di + dj + tilePhase) % 2 === 0) {
        raw[i][j] = Math.min(peakHeight, raw[i][j] + 1);
      }
    }
  }

  // ── 5. CENTRAL PRANG — stepped tapering spire to needle finial ──
  // Discrete Chebyshev tiers narrow inward; quantization gives the silhouette
  // its characteristic stair-stepped Thai/Khmer prang profile. Each tier sits
  // at a distinct height level, so the spire has a fractal, layered look
  // rather than a smooth Gaussian bell.
  const prangBase = 4.0 + (terraceCount - 4) * 0.18 + rng() * 0.5;
  const prangSteps = 5 + Math.floor(rng() * 3);  // 5–7 discrete tiers
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const cheb = Math.max(Math.abs(i - cx), Math.abs(j - cx));
      if (cheb > prangBase) continue;
      const frac = 1 - cheb / prangBase;
      const stepIdx = Math.min(prangSteps, Math.floor(frac * (prangSteps + 0.5)));
      const h = Math.round(pedTopH + (peakHeight - pedTopH) * (stepIdx / prangSteps));
      raw[i][j] = Math.max(raw[i][j], Math.min(peakHeight, h));
    }
  }
  // Pin the four center cells to peakHeight — the needle tip
  raw[15][15] = raw[15][16] = raw[16][15] = raw[16][16] = peakHeight;

  // ── 5b. Crocket rings on each prang step (the studded Wat Arun silhouette) ──
  // Eight small +1 bumps at cardinal + diagonal positions on each tier's rim.
  for (let s = 1; s < prangSteps; s++) {
    const sCheb = prangBase * (1 - s / prangSteps);
    const diagR = sCheb * 0.707;
    placeGaussiansAt(raw, [
      [cx - sCheb, cx], [cx + sCheb, cx],
      [cx, cx - sCheb], [cx, cx + sCheb],
      [cx - diagR, cx - diagR], [cx - diagR, cx + diagR],
      [cx + diagR, cx - diagR], [cx + diagR, cx + diagR],
    ], 1, 0.32, peakHeight);
  }

  // ── 6. Wing-prangs — 4 mid-height cardinal protrusions from the prang base ──
  // Creates the cross-shape silhouette at intermediate height, like the wings
  // off Wat Arun's central tower. Each is a small Gaussian column.
  const wingDist = prangBase * (0.55 + rng() * 0.15);
  const wingTopFrac = 0.45 + rng() * 0.15;
  const wingTopH = pedTopH + Math.floor((peakHeight - pedTopH) * wingTopFrac);
  placeGaussiansAt(raw, [
    [cx - wingDist, cx], [cx + wingDist, cx],
    [cx, cx - wingDist], [cx, cx + wingDist],
  ], Math.max(1, wingTopH - minHeight), 0.55, peakHeight);
  // Wing finial crockets (+1 on top of each wing)
  placeGaussiansAt(raw, [
    [cx - wingDist, cx], [cx + wingDist, cx],
    [cx, cx - wingDist], [cx, cx + wingDist],
  ], 1, 0.25, peakHeight);

  // ── 7. SATELLITE PRANGS — 4 corner mini-spires (recursive stepped pattern) ──
  // Each is its own stepped prang at smaller scale, sitting on the pedestal top.
  const satDist = 7.0 + rng() * 1.2;
  const satBase = 1.9 + rng() * 0.5;
  const satSteps = 3 + Math.floor(rng() * 2);
  const satTopH = pedTopH + Math.max(2, Math.floor((peakHeight - pedTopH) * (0.65 + rng() * 0.15)));
  const corners = [
    [cx - satDist, cx - satDist], [cx - satDist, cx + satDist],
    [cx + satDist, cx - satDist], [cx + satDist, cx + satDist],
  ];
  for (const [tr, tc] of corners) {
    for (let i = 0; i < SIDE; i++) {
      for (let j = 0; j < SIDE; j++) {
        const cheb = Math.max(Math.abs(i - tr), Math.abs(j - tc));
        if (cheb > satBase) continue;
        const frac = 1 - cheb / satBase;
        const stepIdx = Math.min(satSteps, Math.floor(frac * (satSteps + 0.5)));
        const h = Math.round(pedTopH + (satTopH - pedTopH) * (stepIdx / satSteps));
        raw[i][j] = Math.max(raw[i][j], Math.min(peakHeight, h));
      }
    }
  }
  // Crockets ringing each satellite spire (level-2 fractal detail)
  for (let s = 1; s < satSteps; s++) {
    const sCheb = satBase * (1 - s / satSteps);
    const diagR = sCheb * 0.707;
    for (const [tr, tc] of corners) {
      placeGaussiansAt(raw, [
        [tr - sCheb, tc], [tr + sCheb, tc],
        [tr, tc - sCheb], [tr, tc + sCheb],
        [tr - diagR, tc - diagR], [tr - diagR, tc + diagR],
        [tr + diagR, tc - diagR], [tr + diagR, tc + diagR],
      ], 1, 0.28, peakHeight);
    }
  }

  // ── 8. Cardinal mini-prangs — 4 medium spires on the axes between satellites ──
  if (rng() > 0.30) {
    const cardR = satDist * (0.95 + rng() * 0.15);
    const cardH = pedTopH + Math.floor((satTopH - pedTopH) * 0.55);
    placeGaussiansAt(raw, [
      [cx - cardR, cx], [cx + cardR, cx], [cx, cx - cardR], [cx, cx + cardR],
    ], Math.max(1, cardH - minHeight), 0.55, peakHeight);
    placeGaussiansAt(raw, [
      [cx - cardR, cx], [cx + cardR, cx], [cx, cx - cardR], [cx, cx + cardR],
    ], 1, 0.25, peakHeight);
  }

  // ── 9. Outer chedi ring — 8 tiny finials near the pedestal perimeter ──
  if (range >= 4) {
    const ringR = pedMaxCheb * 0.86;
    const diagR = ringR * 0.707;
    const chediAmp = Math.max(2, Math.floor(range * 0.22));
    placeGaussiansAt(raw, [
      [cx - ringR, cx], [cx + ringR, cx],
      [cx, cx - ringR], [cx, cx + ringR],
      [cx - diagR, cx - diagR], [cx - diagR, cx + diagR],
      [cx + diagR, cx - diagR], [cx + diagR, cx + diagR],
    ], chediAmp, 0.4, peakHeight);
    // Crocket tip on each chedi
    placeGaussiansAt(raw, [
      [cx - ringR, cx], [cx + ringR, cx],
      [cx, cx - ringR], [cx, cx + ringR],
      [cx - diagR, cx - diagR], [cx - diagR, cx + diagR],
      [cx + diagR, cx - diagR], [cx + diagR, cx + diagR],
    ], 1, 0.22, peakHeight);
  }

  // ── 10. Cardinal causeway depressions (entry paths from outer to satellite ring) ──
  const cwDepth = 1;
  const cwWidth = 0.55 + rng() * 0.25;
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const di = Math.abs(i - cx), dj = Math.abs(j - cx);
      if (dj < cwWidth && di > satDist + 0.8 && di < pedMaxCheb - 0.3) {
        raw[i][j] = Math.max(minHeight, raw[i][j] - cwDepth);
      }
      if (di < cwWidth && dj > satDist + 0.8 && dj < pedMaxCheb - 0.3) {
        raw[i][j] = Math.max(minHeight, raw[i][j] - cwDepth);
      }
    }
  }

  // ── 11. Outer enclosure wall (precinct perimeter) ──
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

  // ── 12. Final D2 averaging pass ──
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



// ───────────────────────────────────────────────────────────────────────────
// Wheel, a ring style: after parcel #7463's dream (James, 2026-10-29) — a spoked wheel seen from
// above. A cone falls from the hub to the rim, a low hub sits at the centre, a
// cross of tallest spokes runs one cell off each axis (so the cross itself turns),
// thin diagonal spokes reach in from the corners, and spokeCount seeded spokes per
// quarter run in from the rim, each at its own height and length, twist cells off
// the radius so the wheel spins one way.
//
// Spin reads like a spiral galaxy's: the spokes trail the turn, so on a 'cw' wheel
// each spoke's inner end sits clockwise of its outer end — the cross and the seeded
// spokes alike. #7463 turns 'ccw' (the default). 'ccw' is drawn as the mirror image
// of 'cw'.
//
// The only pattern without mirror axes: a wheel that spins has 4-fold ROTATIONAL
// symmetry (90°, and so 180°) but no mirror line, as #7463 does. One quarter is
// drawn and turned into the other three, so the symmetry is exact by construction;
// the mirror image is still 4-fold.
// ───────────────────────────────────────────────────────────────────────────

export const WHEEL_SPINS = ['cw', 'ccw'];

// The quarter-turn the wheel is built on: cell (i, j) → (j, 31 − i), which in
// centred coordinates (x right, y down) is (x, y) → (−y, x).
const turn = ([x, y]) => [-y, x];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function generateWheel(rng, spokeCount, twist, spin, minHeight, peakHeight) {
  const c = (SIDE - 1) / 2;            // 15.5: the centre falls between cells
  const lo = minHeight, hi = peakHeight;
  const span = hi - lo;
  const clamp = (v) => Math.max(lo, Math.min(hi, Math.round(v)));
  const rimR = c;                       // half the side: where the cone reaches the rim
  const hubR = 2.1;

  // Spokes of one quarter (the sector from straight up, -90°, round to the left,
  // -180°), as segments in centred coordinates with a height; turned three times.
  const quarter = [];
  const at = (deg, r) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
  // The tallest spoke runs straight up, half a cell clockwise (right) of the vertical
  // axis, so the cross trails the turn the same way the seeded spokes do.
  quarter.push({ a: [0.5, -c], b: [0.5, -(hubR + 0.5)], h: hi });
  // A thin diagonal spoke from the corner in to three quarters of the rim radius.
  const diagH = clamp(lo + span * 0.55);
  quarter.push({ a: [-c + 0.5, -c + 0.5], b: at(-135, rimR * 0.75), h: diagH });
  // Seeded spokes spread across the quarter, between the cross and the diagonal and
  // beyond it, each off the radius by `twist` cells (the pinwheel), with its own
  // height and inner end.
  const used = new Set([hi, diagH]);
  for (let k = 0; k < spokeCount; k++) {
    const slot = (k + 0.5 + (rng() - 0.5) * 0.6) / spokeCount;   // 0..1 across the quarter
    const deg = -98 - slot * 76;                                  // keep clear of both axes
    let h = clamp(lo + span * (0.45 + rng() * 0.45));
    for (let tries = 0; used.has(h) && tries < 4; tries++) h = clamp(lo + span * (0.4 + rng() * 0.5));
    used.add(h);
    const inner = [hubR + 1, rimR * 0.4, rimR * 0.6][Math.floor(rng() * 3)];
    const off = twist * 0.35;                                     // cells off the radius
    const perp = at(deg + 90, off);
    const a = at(deg, rimR * 1.25), b = at(deg, inner);
    quarter.push({ a: [a[0] + perp[0], a[1] + perp[1]], b: [b[0] + perp[0], b[1] + perp[1]], h });
  }
  // Draw low spokes first so taller ones cross over them.
  quarter.sort((s, t) => s.h - t.h);
  const spokes = [];
  for (let k = 0; k < 4; k++) {
    for (const s of quarter) {
      let a = s.a, b = s.b;
      for (let n = 0; n < k; n++) { a = turn(a); b = turn(b); }
      spokes.push({ a, b, h: s.h });
    }
  }

  // Rasterise the top-left quarter only; every other cell is a turn of one of these.
  const q = Array.from({ length: QUADRANT }, () => new Array(QUADRANT));
  for (let i = 0; i < QUADRANT; i++) {
    for (let j = 0; j < QUADRANT; j++) {
      const x = j - c, y = i - c;
      const r = Math.hypot(x, y);
      // Cone: highest just outside the hub, one step down every two cells, lowest
      // past the rim (the corners).
      let v = clamp(hi - ((r - hubR - 1) * (span - 1)) / (rimR - hubR - 1));
      if (rng() < 0.1) v = clamp(v + (rng() < 0.5 ? -1 : 1));   // #7463's grain
      for (const s of spokes) {
        if (distToSegment(x, y, s.a[0], s.a[1], s.b[0], s.b[1]) <= 0.5) v = s.h;
      }
      if (r < hubR) v = clamp(lo + span * 0.25);                 // the hub
      q[i][j] = v;
    }
  }

  const grid = Array.from({ length: SIDE }, () => new Array(SIDE));
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      let a = i, b = j;
      while (a >= QUADRANT || b >= QUADRANT) [a, b] = [31 - b, a];   // turn back into the quarter
      grid[i][j] = String(q[a][b]);
    }
  }
  return spin === 'ccw' ? grid.map((row) => [...row].reverse()) : grid;
}

// 4-fold rotational symmetry: every cell equals the one a quarter-turn away.
export function isFourFold(hm) {
  const s = String(hm);
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      if (s[i * SIDE + j] !== s[j * SIDE + (SIDE - 1 - i)]) return false;
    }
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Horus, a ring style: the Eye of Horus heightmap dreamt by
// 0x1a86c1b2727cb9f5f077b47314312bb036f1a0cb (terraformexplorer.xyz/heightmaps/
// a0488f38…d940), copied cell for cell (James, 2026-10-29). It is drawn in three
// heights — 9 the lines, 6 their soft edges, 0 the ground — and each is set freely
// (line, edge, ground: 9/6/0 is the dream exactly); the lines never move. Dreams of
// the same eye use other heights — lines 3 with edges 4 over grounds of 0, 1 or 6 —
// so edges may sit above the lines and the ground above both (the eye cut in).
// Eye 'ra' is the mirror image (the Eye of Ra faces the other way). Halo steps
// the ground down from the lines one height per cell — line 9 gives rings of 8, 7,
// 6… — for as many rings as the slider asks and the gap to the ground allows
// (haloRoom); it climbs instead when the ground is above the lines. Grain (0-3,
// seeded) speckles the ground beyond the halo, never onto the line or edge height,
// so the eye stays clean. No symmetry: it is a copy.
// ───────────────────────────────────────────────────────────────────────────

const HORUS_DREAM = [
  '00000000000000066000000000000000',
  '00000000000999999999900000000000',
  '00000006999999999999999900000000',
  '00000099990000000000099999000000',
  '00000999000000000000000099990000',
  '00099900000000000000000000999000',
  '00990000000000000000000000009900',
  '00900000006699999900000000000000',
  '09000000069999999999999000000000',
  '60000000999999999999999900000000',
  '00000009999099999000069999000000',
  '00000999900099999900000099900000',
  '00999990000099999900000000990000',
  '69990000000099999900000000099900',
  '00996000000099999900000000990900',
  '00069990000009999000000099900000',
  '00000999999000990000999990000000',
  '00000009999999999999990000000000',
  '00000009999990690000000000000000',
  '00000009999990000000000000000000',
  '00000009600999000000000000000000',
  '00000009000999000000000000000000',
  '00000099000099000000000000999000',
  '00000699000009900000000099969990',
  '00000099000009990000000090000099',
  '00000009000000996000000990000009',
  '00000009000000099000000990090009',
  '00000009000000009990000090090009',
  '00000009000000000099000009900009',
  '00000009000000000009990000000099',
  '00000000000000000009999900009990',
  '00000000000000000000009999999900',
].join('');

function generateHorus(rng, line, edge, ground, grain, eye = 'horus', halo = 0) {
  const code = (i, j) => HORUS_DREAM[i * SIDE + (eye === 'ra' ? SIDE - 1 - j : j)];
  // Heights the ground may speckle to: within `grain` of it, never the line or edge height.
  const speckle = [];
  for (let v = Math.max(0, ground - grain); v <= Math.min(9, ground + grain); v++) {
    if (v !== line && v !== edge) speckle.push(v);
  }
  // Halo: ring d (the cells d steps from the nearest line or edge cell, counting
  // diagonals as one) sits d below the line height, or d above it when the ground
  // is higher — never past the ground.
  const rings = Math.min(halo, haloRoom(line, ground));
  const away = Math.sign(ground - line);
  const ringOf = (i, j) => {
    for (let d = 1; d <= rings; d++) {
      for (let a = Math.max(0, i - d); a <= Math.min(SIDE - 1, i + d); a++) {
        for (let b = Math.max(0, j - d); b <= Math.min(SIDE - 1, j + d); b++) {
          if (code(a, b) !== '0') return d;
        }
      }
    }
    return 0;
  };
  const grid = Array.from({ length: SIDE }, () => new Array(SIDE));
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const c = code(i, j);
      let v = c === '9' ? line : c === '6' ? edge : ground;
      if (c === '0') {
        const d = rings > 0 ? ringOf(i, j) : 0;
        if (d > 0) v = line + away * d;
        else if (grain > 0 && speckle.length) v = speckle[Math.floor(rng() * speckle.length)];
      }
      grid[i][j] = String(v);
    }
  }
  return grid;
}

