// The sunflower: the smaller flower sealed messages hide in, and the two parts of either flower
// (petals, bud) whose heights the seal maker can set. No imports, so mandala.js (the designer's
// preview) and sealCovers.js (the covers) can both use it.

/** The outer field: the 8s connected to the border (4-neighbour flood fill), one flag per cell. */
export function fieldOf(rows) {
  const g = rows.join('');
  const field = new Array(1024).fill(false);
  const stack = [];
  for (let i = 0; i < 32; i++) stack.push([0, i], [31, i], [i, 0], [i, 31]);
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r < 0 || r > 31 || c < 0 || c > 31) continue;
    const i = 32 * r + c;
    if (field[i] || g[i] !== '8') continue;
    field[i] = true;
    stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
  }
  return field;
}


export const MINI_FLOWER_ROWS = [
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888566888888888888',
  '88888888888888885566688888888888',
  '88888888887778885566688888888888',
  '88888888866666885555688888888888',
  '88888888866556775555688888888888',
  '88888888865555544455688888888888',
  '88888888885544444345555568888888',
  '88888888888554888844455568888888',
  '88888888888554888833455568888888',
  '88888887766544888874556668888888',
  '88888886655543888774566668888888',
  '88888886655545777734568888888888',
  '88888886665555443444555888888888',
  '88888888677665544555555588888888',
  '88888888888765555555556588888888',
  '88888888888765555855566588888888',
  '88888888888766555886666888888888',
  '88888888888866655888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
  '88888888888888888888888888888888',
];

// The small flower's variants: the hand-drawn flower with the tweaks James picked from on 2026-11-19
// (~/ops/mandala-explore/minitweak2, candidates a-j). Always: the hole's square corners rounded off
// with the ring's height (3); the outline's creases (7, the speckle's own height) turned to rim (6);
// every petal edge outlined (6). Then four choices, 4 x 2 x 2 x 4 = 64 drawings:
//   the upper-left petal (it was the smallest) grown: a row taller, a column wider, both, or both
//   with a pointed tip; the lower-right petal's spur kept or trimmed; the top petal's tip as drawn or
//   fuller; the petals' gradient: 4 near the centre and 5 further out, changing 5.6, 6.2 or 6.8 cell
//   widths from the hole's centre (rows count 1.45 wide), or 3 > 4 > 5 in three steps.
// Every one holds a 53-character sealed message (~/ops/mandala-seal/grain/test-site-covers.mjs).
export const MINI_FLOWER_VARIANTS = 64;
const ROUND_CENTRE = [[14, 14], [14, 17], [17, 14]];
const CRISP = [[9, 10], [9, 11], [9, 12], [11, 14], [11, 15], [16, 7], [16, 8], [20, 9], [20, 10], [21, 11], [22, 11], [23, 11]];
const UL_OLD_EDGE = [[9, 10], [9, 11], [9, 12], [10, 9], [10, 10], [10, 11], [10, 12], [11, 9], [11, 10], [12, 9]];
const UL_UP = [[8, 10], [8, 11], [8, 12], [9, 9], [9, 13]];
const UL_LEFT = [[10, 8], [11, 8], [12, 8], [13, 9]];
const UL_SHAPES = [
  [...UL_OLD_EDGE.slice(0, 7), ...UL_UP],                // a row taller
  [[10, 9], [11, 9], [12, 9], ...UL_LEFT],                // a column wider
  [...UL_OLD_EDGE, ...UL_UP, ...UL_LEFT],                 // both
  [...UL_OLD_EDGE, ...UL_UP, ...UL_LEFT, [7, 11]],        // both, with a pointed tip
];
const TOP_TIP = [[7, 16], [6, 17], [6, 18]];
const LR_SPUR = [[21, 23], [22, 23]];
const GRADIENTS = [
  (d) => (d < 5.6 ? '4' : '5'),
  (d) => (d < 6.2 ? '4' : '5'),
  (d) => (d < 6.8 ? '4' : '5'),
  (d) => (d < 4.9 ? '3' : d < 6.8 ? '4' : '5'),
];

/** Variant v (0-63) of the small flower, as 32 rows: the upper-left petal is v & 3, the spur bit 2,
 *  the top tip bit 3, the gradient bits 4-5. */
export function miniFlowerRows(v) {
  if (!Number.isInteger(v) || v < 0 || v >= MINI_FLOWER_VARIANTS) throw new Error(`a small-flower variant is 0-${MINI_FLOWER_VARIANTS - 1}`);
  const g = MINI_FLOWER_ROWS.map((r) => [...r]);
  const put = (cells, h) => { for (const [r, c] of cells) g[r][c] = h; };
  put(ROUND_CENTRE, '3');
  put(CRISP, '6');
  put(UL_SHAPES[v & 3], '5');
  if (v & 8) put(TOP_TIP, '5');
  if (v & 4) put(LR_SPUR, '8');
  const field = fieldOf(g.map((r) => r.join('')));
  const isField = (r, c) => r < 0 || r > 31 || c < 0 || c > 31 || field[32 * r + c];
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) {
    if (!field[32 * r + c] && '345'.includes(g[r][c]) && (isField(r - 1, c) || isField(r + 1, c) || isField(r, c - 1) || isField(r, c + 1))) g[r][c] = '6';
  }
  const shade = GRADIENTS[(v >> 4) & 3];
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) if (g[r][c] === '5') g[r][c] = shade(Math.hypot(c - 16, (r - 15.5) * 1.45));
  return g.map((r) => r.join(''));
}

// The flowers' two parts (James, 2026-11-19: "change the heights of the flower glyph for the seal
// drawing ... toggle the petal and central seed bud heights separately"). The bud is the hole and
// what rings it: from the enclosed 8s outwards through the ring (3), base (4) and crease (7) cells,
// found on the drawing before any gradient (so a petal's gradient 4s are not taken for it); every
// other cell that is not the field is petal.
export function budOf(rows) {
  const field = fieldOf(rows), g = rows.join(''), bud = new Array(1024).fill(false), stack = [];
  for (let i = 0; i < 1024; i++) if (g[i] === '8' && !field[i]) { bud[i] = true; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), r = Math.floor(i / 32), c = i % 32;
    for (const [y, x] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (y < 0 || y > 31 || x < 0 || x > 31) continue;
      const j = 32 * y + x;
      if (!bud[j] && !field[j] && '347'.includes(g[j])) { bud[j] = true; stack.push(j); }
    }
  }
  return bud;
}
// The sunflower's bud, from the hand-drawn flower with its always-on tweaks (every variant shares it).
export const SUNFLOWER_BUD = (() => {
  const g = MINI_FLOWER_ROWS.map((r) => [...r]);
  for (const [r, c] of ROUND_CENTRE) g[r][c] = '3';
  for (const [r, c] of CRISP) g[r][c] = '6';
  return budOf(g.map((r) => r.join('')));
})();

/** The highest height of each part in a drawing: what the seal maker's sliders show "as drawn". */
export function partTops(rows, bud) {
  const field = fieldOf(rows), g = rows.join('');
  let petal = 0, budTop = 0;
  for (let i = 0; i < 1024; i++) {
    if (field[i]) continue;
    if (bud[i]) budTop = Math.max(budTop, Number(g[i])); else petal = Math.max(petal, Number(g[i]));
  }
  return { petal, bud: budTop };
}

/**
 * A drawing with its petals and/or bud raised or lowered: each part moves by (wanted top - its own
 * top), so its rims and gradient keep their steps until they reach 0 (or 9). null leaves a part as
 * drawn. The field is never touched (field: the drawing's own, before any change), so a grain seal's
 * room is the same at any heights.
 */
export function withHeights(rows, field, bud, { petal = null, bud: budH = null } = {}) {
  if (petal == null && budH == null) return rows;
  const tops = partTops(rows, bud);
  const g = rows.join('').split('');
  for (let i = 0; i < 1024; i++) {
    if (field[i]) continue;
    const want = bud[i] ? budH : petal;
    if (want == null) continue;
    g[i] = String(Math.max(0, Math.min(9, Number(g[i]) - ((bud[i] ? tops.bud : tops.petal) - want))));
  }
  return Array.from({ length: 32 }, (_, r) => g.slice(32 * r, 32 * r + 32).join(''));
}
