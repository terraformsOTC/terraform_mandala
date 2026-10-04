// Heightmap utilities — port of initial context import files/heightmap_validate.py.
//
// Heightmap is 1024 chars (digits 0–9), arranged as a 32x32 grid (row-major).
// Encodes as uint256[16] for commitDreamToCanvas: each uint is two rows read as
// one 64-digit DECIMAL number, top-left first. The renderer recovers the cells
// by repeated mod 10 over the zero-padded 64 digits, so leading zeros can drop
// out of the number without losing anything. Verified 2026-10-04 by decoding
// through both on-chain renderers' tokenHeightmapIndices (1024/1024 cells) and
// against the stored canvas of committed parcels (#117, #871). NOT hex: a
// 0x-prefixed form decodes to a different heightmap.

export const SIDE = 32;
export const TOTAL = 1024;

function clean(str) {
  return String(str).replace(/\s+/g, '');
}

export function validate(hm) {
  const s = clean(hm);
  const out = {
    length: s.length,
    lengthOk: s.length === TOTAL,
    allDigits: /^[0-9]*$/.test(s),
    rows: null,
    vertical_sym: null,
    horizontal_sym: null,
    rotational_sym: null,
    asymmetries: [],
  };
  if (!out.lengthOk || !out.allDigits) return out;

  const rows = [];
  for (let i = 0; i < SIDE; i++) rows.push(s.slice(i * SIDE, (i + 1) * SIDE));
  out.rows = rows;

  out.vertical_sym = rows.every((_, i) => i >= SIDE / 2 || rows[i] === rows[SIDE - 1 - i]);
  out.horizontal_sym = rows.every((r) => r === [...r].reverse().join(''));
  out.rotational_sym = s === [...s].reverse().join('');

  if (!out.vertical_sym) {
    for (let i = 0; i < SIDE / 2; i++) {
      if (rows[i] !== rows[SIDE - 1 - i]) {
        const diffs = [];
        for (let j = 0; j < SIDE; j++) {
          if (rows[i][j] !== rows[SIDE - 1 - i][j]) diffs.push([j, rows[i][j], rows[SIDE - 1 - i][j]]);
        }
        out.asymmetries.push(`V-asym row ${i} vs row ${SIDE - 1 - i}: ${JSON.stringify(diffs)}`);
      }
    }
  }
  if (!out.horizontal_sym) {
    rows.forEach((r, i) => {
      if (r !== [...r].reverse().join('')) {
        const diffs = [];
        for (let j = 0; j < SIDE / 2; j++) {
          if (r[j] !== r[SIDE - 1 - j]) diffs.push([j, r[j], r[SIDE - 1 - j]]);
        }
        out.asymmetries.push(`H-asym row ${i}: ${JSON.stringify(diffs)}`);
      }
    });
  }
  return out;
}

export function encode(hm) {
  const s = clean(hm);
  if (s.length !== TOTAL) throw new Error(`encode: expected ${TOTAL} chars, got ${s.length}`);
  if (!/^[0-9]+$/.test(s)) throw new Error('encode: heightmap must be digits 0-9 only');
  const out = [];
  for (let i = 0; i < 16; i++) out.push(s.slice(i * 64, (i + 1) * 64));
  return out;
}

// The uint256[16] argument for commitDreamToCanvas, as BigInts.
export function toCanvasUints(hm) {
  return encode(hm).map((digits) => BigInt(digits));
}

export function asciiViz(hm) {
  const chars = '  .:-=+*#%@';
  const s = clean(hm);
  if (s.length !== TOTAL) return '';
  const lines = [];
  for (let i = 0; i < SIDE; i++) {
    let line = '';
    for (let j = 0; j < SIDE; j++) line += chars[Number(s[i * SIDE + j])] || ' ';
    lines.push(line);
  }
  return lines.join('\n');
}
