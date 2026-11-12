import { generateEscher, ESCHER_DEFAULT } from './escher.js';
import { makeRng } from './seedrandom.js';
import { validate } from './heightmap.js';

// 32x32 heightmap generator. Every pattern but the wheel and the glyphs is
// D2-symmetric (horizontal + vertical mirror axes, 180° rotation); the wheel is
// 4-fold rotational (90° and 180°) with no mirror axis; a glyph is a fixed drawing
// and has no symmetry at all. The check runs before return.
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
//   glyphs/horus — the Eye of Horus heightmap dreamt by 0x1a86…a0cb, copied
//               line for line; its three heights (lines, edges, ground) are
//               set freely, its lines never move (see generateGlyph).
//   glyphs/nazca — our own drawings of four Nazca geoglyphs, in the same three
//               heights (see NAZCA_DREAMS).
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
  glyphSet: 'hieroglyphs',
  glyphLine: 8,     // the lowest height that still draws. 9 is empty on-chain, which cuts the
                    // lines out of the ground; the Horus dream itself is 9 / 6 / 0
  glyphEdge: 6,
  glyphGround: 0,
  figure: 'horus',   // the glyph within the set; each set has its own (figureFor)
  escherDesign: ESCHER_DEFAULT,
  escherTones: null, // null = the design's own default heights (escher.js)
  grain: 0,          // 0 off, 1 on
  spokeCount: 3,
  twist: 2,
  spin: 'ccw',   // #7463 turns counterclockwise
};

export const TEMPLE_STYLES = ['cathedral', 'wat', 'ziggurat'];
export const RING_STYLES = ['concentric', 'wheel'];
// Glyph sets and the glyphs in each (James, 2026-11-12: the menu reads
// glyphs > hieroglyphs > eye of horus / eye of ra / ankh / moon god / frog, glyphs > nazca > condor...).
// 'horus' was the hieroglyph set's name until then; old links still open it.
export const GLYPH_SETS = ['hieroglyphs', 'nazca'];
export const HIEROGLYPHS = ['horus', 'ra', 'ankh', 'moon', 'frog'];
export const NAZCA_FIGURES = ['hummingbird', 'monkey', 'spider', 'condor'];
export const GLYPH_FIGURES = { hieroglyphs: HIEROGLYPHS, nazca: NAZCA_FIGURES };
export const FIGURE_LABELS = { horus: 'eye of horus', ra: 'eye of ra', ankh: 'ankh', moon: 'moon god', frog: 'frog' };
export const PATTERNS = ['classic', 'rings', 'temple', 'glyphs', 'escher'];

export function normalizeGlyphSet(set) {
  if (set === 'horus') return 'hieroglyphs';
  return GLYPH_SETS.includes(set) ? set : DEFAULTS.glyphSet;
}

// A glyph valid for the set, else the set's first (its default).
export function figureFor(set, figure) {
  const list = GLYPH_FIGURES[normalizeGlyphSet(set)];
  return list.includes(figure) ? figure : list[0];
}

export function generateMandala(opts = {}) {
  const seed = opts.seed ?? 'mandala';
  const rawAlgo = opts.algorithm;
  const algorithm = PATTERNS.includes(rawAlgo) ? rawAlgo : 'classic';
  const ringStyle = RING_STYLES.includes(opts.ringStyle) ? opts.ringStyle : DEFAULTS.ringStyle;
  const isWheel = algorithm === 'rings' && ringStyle === 'wheel';
  const isGlyph = algorithm === 'glyphs';
  const isEscher = algorithm === 'escher';
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
  const glyphSet = normalizeGlyphSet(opts.glyphSet);
  const glyphLine = clampInt(opts.glyphLine ?? DEFAULTS.glyphLine, 0, 9);
  const glyphEdge = clampInt(opts.glyphEdge ?? DEFAULTS.glyphEdge, 0, 9);
  const glyphGround = clampInt(opts.glyphGround ?? DEFAULTS.glyphGround, 0, 9);
  const figure = figureFor(glyphSet, opts.figure);
  const grain = clampInt(opts.grain ?? DEFAULTS.grain, 0, 1);

  const rng = makeRng(seed);

  let grid;
  if (isGlyph) {
    const dream = glyphSet === 'nazca' ? NAZCA_DREAMS[figure] : HIEROGLYPH_DREAMS[figure] ?? HORUS_DREAM;
    const mirrored = glyphSet === 'hieroglyphs' && figure === 'ra';
    grid = generateGlyph(rng, dream, mirrored, glyphLine, glyphEdge, glyphGround, grain);
  } else if (isEscher) {
    grid = generateEscher(opts.escherDesign, opts.escherTones);
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
  const symmetric = isGlyph || isEscher
    ? true   // a fixed drawing, or an Escher design (spirals, tessellations): no symmetry to check
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
// Horus, a glyph: the Eye of Horus heightmap dreamt by
// 0x1a86c1b2727cb9f5f077b47314312bb036f1a0cb (terraformexplorer.xyz/heightmaps/
// a0488f38…d940), copied cell for cell (James, 2026-10-29). It is drawn in three
// heights — 9 the lines, 6 their soft edges, 0 the ground — and each is set freely
// (line, edge, ground: 9/6/0 is the dream exactly); the lines never move. Dreams of
// the same eye use other heights — lines 3 with edges 4 over grounds of 0, 1 or 6 —
// so edges may sit above the lines and the ground above both (the eye cut in).
// Eye 'ra' is the mirror image (the Eye of Ra faces the other way). Grain (off/on,
// seeded) speckles the ground one height either side of it, never onto the line or
// edge height, so the eye stays clean. No symmetry: it is a copy.
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

// Nazca, the second glyph set: our own drawings of four Nazca geoglyphs, placed cell
// by cell over aerial photographs (James, 2026-11-05), in the same three codes as
// HORUS_DREAM. One row renders 1.5 columns tall, so a circle is 1.5 times as many
// columns as rows. Each figure is turned to fill the tall parcel; a line needs a gap
// of at least one cell to read as a line. Originals, so the footer credits no one.
// Gradients (James, 2026-11-12: "increase their complexity ... by adding more gradients.
// Don't go too far"): the lines are untouched; each area a line closes (body, head,
// the monkey's spiral) is shaded by a ramp from its edge (2) to its middle (5), the open
// desert left bare. ~/ops/mandala-nazca/round5/nazca_grad.py (`fill`; `echo` halos round
// every line swamped the drawings).
const NAZCA_DREAMS = {
  hummingbird: [
    '00000000000000060000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000696000000000000000',
    '00000000000000929000000000000000',
    '06999900000009242900000009999600',
    '00000099990009242900099990000000',
    '00000000009999242999900000000000',
    '00000699992229242922299996000000',
    '00000000009999242999900000000000',
    '00000006992229242922299600000000',
    '00000000009999242999900000000000',
    '00000000000009222900000000000000',
    '00000909099999999999990909000000',
    '00006090900909090909009090600000',
    '00000000000909090909000000000000',
    '00000000000909090909000000000000',
    '00000000000609090906000000000000',
    '00000000000009090900000000000000',
    '00000000000006090600000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000060000000000000000',
  ].join(''),
  monkey: [
    '00000000000000000000000000000000',
    '00000009999999999999900000000000',
    '00000092222290909090900000000000',
    '00000929999900606060600000000000',
    '00000929000000000000000000000000',
    '00669999000000060606060600000000',
    '00092222900000090909090900000000',
    '00924444299000099999999900000000',
    '00924444292990092290000000000000',
    '00092222992229922900000000000000',
    '00009999009922229000000000000000',
    '00000092900099990000000000000000',
    '00000092900000000000000606060000',
    '00000092299900000999999999900000',
    '00000009222299909222222222290000',
    '00000000999222292429999999900000',
    '00000000000999224292222222260600',
    '00000000000000992229999999999900',
    '00000000000000009992222222222290',
    '00000000000000000009999999999900',
    '00000000000000000000922900000000',
    '00000009999999990000092290000000',
    '00000990000000009900092290000000',
    '00009000999999900090092290000000',
    '00009009000000090090092290000000',
    '00090090099990090090092290000000',
    '00090090092290090090092290000000',
    '00090090009999900090092290000000',
    '00090009000000000900092290000000',
    '00009000999999999000922900000000',
    '00000900000000000009229000000000',
    '00000099999999999999990000000000',
  ].join(''),
  spider: [
    '00060060000000000000000000000000',
    '00090090000000000000000060060000',
    '00090090000000000000000090090000',
    '00009009000000000090000090090000',
    '00000900900090000929000900900000',
    '00000900900929000092909009000000',
    '00000900909290090092909009000000',
    '00009009009290929092900909000000',
    '00090090000999999999000092900000',
    '00090009000009222900000923290000',
    '00090000999999232999999233290000',
    '00009000000092343292222222900000',
    '00000999999992343299999999000000',
    '00000000000092333290000000000000',
    '00009999999999222999999999900000',
    '00090000000000999000000000090000',
    '00900009999999090999999900009000',
    '00900090000000090000000090009000',
    '00900900000009999900000009009000',
    '00900900000992222299000009009000',
    '00090090009223333322900090090000',
    '00009009092334444433290900900000',
    '00009009092345555543290900900000',
    '00009009092334444433290900900000',
    '00009009009223333322900900900000',
    '00090090000992222299000090090000',
    '00900900000009999900000009009000',
    '00900900000000090000000009009000',
    '00900900000000090000000009009000',
    '00900900000000090000000009009000',
    '00900900000000090000000009009000',
    '00600600000000060000000006006000',
  ].join(''),
  condor: [
    '00000000000000060000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000090000000000000000',
    '00000000000000999000000000000000',
    '00000000000009222900000000000000',
    '00000000000009222900000000000000',
    '00000000000000999000000000000000',
    '00000000000000929000000000000000',
    '69990000000000929000000000099960',
    '00009999900009232900009999900000',
    '00000000099992343299990000000000',
    '00000000000092343290000000000000',
    '69999999999992343299999999999960',
    '00000000000092343290000000000000',
    '00000000009992343299900000000000',
    '00000009990092343290099900000000',
    '00009990000999232999000099900000',
    '00990000099009232900990000099000',
    '06000009900000929000009900000600',
    '00000090000099999990000090000000',
    '00000600000909090909000006000000',
    '00000000009009090900900000000000',
    '00000699990009090900099996000000',
    '00000000090090090090090000000000',
    '00006999990090090090099999600000',
    '00000000090090090090090000000000',
    '00000699990060060060099996000000',
  ].join(''),
};

// The Ankh (James, 2026-11-12). Fourth drawing, the same day, after the moon god: traced
// from the Noto Sans Egyptian Hieroglyphs Ankh by the moon god's method
// (~/ops/mandala-nazca/ankh4/ankh4.py, `depth`; tracer ../trace.py) — framed to fill the
// parcel's height, the glyph's own double lines one to two cells wide (9, 6 where a
// stroke grazes), a ramp inside each part (loop lit at its crown and darkening down both
// sides, crossbar lit at the middle, shaft darkening to the foot), widened 1.3x, and
// extruded up and right three steps like the third drawing's relief (side faces 4..2,
// rimmed in 6). Earlier drawings: ankh.py, ankh2.py (relief in perspective), ankh3.py
// (outline only against the ground).
const ANKH_DREAM = [
    '00000000063333333333333360000000',
    '00000006999999999999994336600000',
    '00000699986999999968899943366000',
    '00009967999666000699997996436000',
    '00069769946000000000099799433600',
    '00099799436000000000009679643600',
    '00099799436000000000009679646000',
    '00069569433600000000069569436000',
    '00009959943360000000099599460000',
    '00006965964336000000995994600000',
    '00000994696433600009946943600000',
    '00000099469643360099469646000000',
    '00000009936964336993696460000000',
    '00000000993996439936964600000000',
    '00000000099399699369666000000000',
    '00066666629966993996600066666660',
    '09999664333696699943366669994336',
    '09966999999999999999999996696436',
    '09936699999999999999999966396660',
    '09999966600009994336066699996000',
    '00000000000009999436000000000000',
    '00000000000009699436000000000000',
    '00000000000069599436000000000000',
    '00000000000099569433600000000000',
    '00000000000099449643600000000000',
    '00000000000099449943600000000000',
    '00000000000096339943600000000000',
    '00000000000693339943600000000000',
    '00000000000993336943360000000000',
    '00000000000992222964360000000000',
    '00000000000992222994660000000000',
    '00000000000999999996000000000000',
].join('');

// The moon god, Gardiner C22 𓁳 (U+13073): a seated falcon-headed god wearing the moon, a
// crescent holding the full disk (James, 2026-11-12, in place of the Sower tried earlier
// the same day: "copy the eye of horus for inspiration about how to frame the composition
// and the line width"). Framed like the Eye of Horus — the figure fills the parcel's
// height — in lines one to two cells wide (9), 6 where a stroke only grazes a cell, as
// Horus uses it. A line drawing like Horus: the spaces the lines enclose are ground (0)
// (James, 2026-11-12, after a version with ramps inside). Traced from the Noto Sans
// Egyptian Hieroglyphs glyph (SIL OFL) by ~/ops/mandala-nazca/moon/moon.py (`lines`).
const MOON_DREAM = [
    '00000000000000009999600000000000',
    '00000000000000996000990000000000',
    '00000000069006900000099009600000',
    '00000000009909900000069099900000',
    '00000000009996900000099999000000',
    '00000000000999999606999996000000',
    '00000000000069999999999900000000',
    '00000000000006999999999000000000',
    '00000000000699990009909990000000',
    '00000000009960990006900099000000',
    '00000000099990000009900009900000',
    '00000000000996000009600000900000',
    '00000000000009900099000000960000',
    '00000000000000699960000000990000',
    '00000000000000009606996000690000',
    '00000000000000096099669960690000',
    '00000000000000690960000096690000',
    '00000000000000999900000069690000',
    '00000000000000969900000009690000',
    '00000699960000999000000009990000',
    '00006900099000009000000009000000',
    '00006900009900069000000009000000',
    '00000900000696099000000009000000',
    '00000960000009999000000009000000',
    '00000990000000996000000009000000',
    '00000090000000090000000009000000',
    '00000099000000000000000009000000',
    '00000069000000000000000009000000',
    '00000009600000000000000009000000',
    '00009999000000000000000009990000',
    '00996000000000000000000000069900',
    '00999999999999999999999999999900',
].join('');

// The frog, Gardiner I7 𓆏 (U+1318F), Heqet's sign (James, 2026-11-12: "add a drawing for
// 𓆏 like the falcon head god"). Traced like the moon god from the Noto Sans Egyptian
// Hieroglyphs glyph (~/ops/mandala-nazca/frog/frog.py): wider than tall, so it fills the
// parcel's width, stretched 1.3x in height; its strokes are finer than a cell at this
// size, so lower ink thresholds keep them whole. Ramps: body lit from head and back to the
// belly, the head lit round the eye, the haunch from the knee; the eye placed by hand.
const FROG_DREAM = [
    '00000000000000000000000000000000',
    '00000000000000000000000000000000',
    '00000000000000000000000000000000',
    '00000000000000000000000000000000',
    '00000000000000000000000000000000',
    '09999999990000000000000000000000',
    '99577766599000000000000000000000',
    '99777777559990000000000000000000',
    '99999977755599990000000000000000',
    '09989897775544499990000000000000',
    '06999997775544444469960000000000',
    '00998799755544444444499000000000',
    '00099777555444444444439900000000',
    '00009555554444444333333696000000',
    '00006955444443333333333339600000',
    '00000944433333333333333333960000',
    '00000993333333333333333393396000',
    '00000093333333333333333369229000',
    '00000099393333333333332222966900',
    '00000009996393333322222222296900',
    '00000000999393222222223333339690',
    '00000000099292222222999994439990',
    '00000000069292222229934499943996',
    '00000000096692222229936995996999',
    '00009000092969926296994499949999',
    '06999996999900999999699944999299',
    '09999699929000999996999999939999',
    '99999999990000699999999999926990',
    '00009900000000000696000009999000',
    '00000000000000000000000000000000',
    '00000000000000000000000000000000',
    '00000000000000000000000000000000',
].join('');

const HIEROGLYPH_DREAMS = { horus: HORUS_DREAM, ra: HORUS_DREAM, ankh: ANKH_DREAM, moon: MOON_DREAM, frog: FROG_DREAM };

// A glyph digit: 9 the line, 6 the edge, 0 the ground, and any other digit d a step of a
// ramp between them — ground + (line - ground) * d / 8 — so at the default heights (line
// 8, ground 0) a ramp digit is its own height, and the ramps follow the sliders. The Ankh,
// the frog and the Nazca figures (their enclosed areas, since 2026-11-12) use ramp
// digits; Horus and the moon god are 9/6/0 throughout.
function glyphHeight(c, line, edge, ground) {
  if (c === '9') return line;
  if (c === '6') return edge;
  if (c === '0') return ground;
  return Math.max(0, Math.min(9, Math.round(ground + ((line - ground) * Number(c)) / 8)));
}

function generateGlyph(rng, dream, mirrored, line, edge, ground, grain) {
  const code = (i, j) => dream[i * SIDE + (mirrored ? SIDE - 1 - j : j)];
  // Heights the ground may speckle to: within `grain` of it, never the line or edge height.
  const speckle = [];
  for (let v = Math.max(0, ground - grain); v <= Math.min(9, ground + grain); v++) {
    if (v !== line && v !== edge) speckle.push(v);
  }
  const grid = Array.from({ length: SIDE }, () => new Array(SIDE));
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const c = code(i, j);
      let v = glyphHeight(c, line, edge, ground);
      if (c === '0' && grain > 0 && speckle.length) v = speckle[Math.floor(rng() * speckle.length)];
      grid[i][j] = String(v);
    }
  }
  return grid;
}

