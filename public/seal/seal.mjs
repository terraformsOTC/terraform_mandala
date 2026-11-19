// Terraform seals (TFS1): a message, a sealed message, a commitment, a plain SHA-256 hash or
// a committed list written into a Terraforms heightmap (James, 2026-11-17: "commit a secret in
// the form of a drawing ... publish a decoder ... a play on the zero knowledge theme").
//
// Self-contained on purpose: no imports, only the platform's WebCrypto and compression
// streams (browsers; Node 18+), so this one file is both the site's encoder/decoder and the
// published reference decoder (copied to public/seal/seal.mjs at build; see /seal).
//
// FORMAT (version 1)
//   A heightmap is 1024 digits 0-9 (32 rows of 32, row by row): the digits the Terraforms
//   contract stores for a committed drawing. A seal is a byte string written into some of them:
//     0      'T' 'F' 'S'       magic
//     3      0x01              version
//     4      mode              low 4 bits: 1 inscription, 2 sealed, 3 commitment, 4 hash, 5 list;
//                              bit 7: the text is raw DEFLATE (RFC 1951) compressed, inflating
//                              to at most 64 KiB
//     5..6   n                 payload length, big-endian
//     7..    payload           n bytes
//     7+n    check             first 4 bytes of SHA-256(bytes 0 .. 6+n)
//     then   filler            to the layout's capacity B: SHA-256(check | "fill" | i), i = 0, 1, ...
//                              (uint32, big-endian), concatenated and cut to length
//   The B bytes, read as one big-endian number, are written in decimal and padded with
//   leading zeros to the layout's D digits. B is the most bytes D digits can carry: the
//   largest B with 256^B < 10^D.
//
//   Layouts (where the D digits go, in order; every other cell repeats one of them):
//     plain     D = 1024, B = 425  every cell, row by row
//     mirror    D = 512,  B = 212  columns 0-15, row by row; column 31-c repeats column c
//     rotation  D = 512,  B = 212  rows 0-15, row by row; cell (31-r, 31-c) repeats (r, c)
//     quarter   D = 256,  B = 106  rows 0-15 x columns 0-15, row by row; mirrored left-right
//                                  and top-bottom
//     pinwheel  D = 256,  B = 106  the same quarter, turned a quarter at a time: (r, c) is
//                                  repeated at (c, 31-r), (31-r, 31-c) and (31-c, r)
//     eighth    D = 136,  B = 56   the cells of that quarter with column >= row, row by row;
//                                  mirrored across the quarter's diagonal, then as quarter
//   A decoder tries eighth, quarter, pinwheel, mirror, rotation, plain in turn and takes the
//   first whose symmetry, magic, version, check and length all hold.
//
//   Text is UTF-8 after Unicode NFC normalisation with \r\n and \r turned into \n; a file is
//   its raw bytes. "Content" below is either.
//   Modes:
//     1 inscription  payload = the text (DEFLATE'd when that is shorter). Anyone can read it.
//     2 sealed       S = 32 random bytes: the secret, published to open the seal.
//                    HKDF-SHA256(S, no salt, info "terraform-seal/sealed/v1") -> 76 bytes:
//                    an AES-256 key (32), a nonce (12) and a commitment (32).
//                    payload = commitment | AES-256-GCM(key, nonce, plaintext, additional data =
//                    bytes 0..6) with its 16-byte tag; plaintext = text length (2 bytes) | text
//                    (DEFLATE'd when shorter) | zeros up to the layout's capacity, so the length
//                    is hidden. The commitment binds the seal to one secret: no other secret can
//                    open it, so its author cannot later choose between two messages.
//     3 commitment   payload = SHA-256("terraform-seal/commit/v1" | 0x00 | salt | content),
//                    salt = 16 random bytes. Reveal the content and the salt; with the salt, a
//                    short or guessable text cannot be found by trying candidates.
//     4 hash         payload = SHA-256(content): a plain hash, what sha256sum prints. No salt:
//                    anyone can test guesses against it, so use it for unguessable content
//                    (a file, a long text) or a digest made elsewhere.
//     5 list         payload = root (32) | count (2): a Merkle tree of count items (RFC 6962
//                    shape: split at the largest power of two below n). Item i's leaf =
//                    SHA-256(0x00 | "terraform-seal/list/v1" | salt_i (16) | text_i); a node =
//                    SHA-256(0x01 | left | right). Each item is revealed on its own, with its
//                    salt and audit path, and the others stay hidden.
//
// GRAIN SEALS (version 1, 2026-11-19)
//   The same frame (magic to filler), cut to S bytes, S = 48, 64, 80, 96 or 112 (the smallest that
//   holds it, or a larger one an encoder picks to hide a sealed message's length; the site seals
//   every sealed message at 96), hidden in a drawing's parities instead of written in its digits: the drawing stays as
//   drawn, and only cells of a glyph's grain (the random speckle of its ground) move, by one height.
//   Modes 1 inscription (never compressed), 2 sealed (below), 3 commitment, 4 hash and 5 list, as
//   above; the mode byte has no flags.
//   2 sealed in a grain (more compact than the digits' AES-GCM, so that it fits a grain):
//            S = 32 random bytes, the secret. HKDF-SHA256(S, no salt, info "terraform-seal/grain-
//            sealed/v1") -> 64 bytes: Ke | Km. The payload fills the frame: ciphertext (n = S - 43
//            bytes) | tag (32). plaintext = the text (UTF-8, NFC, \n line ends, no zero byte) then
//            zero bytes to n; ciphertext = plaintext XOR (SHA-256(Ke | uint32 0) | SHA-256(Ke |
//            uint32 1) | ...); tag = HMAC-SHA256(Km, bytes 0..6 | ciphertext). Opening checks the tag,
//            decrypts and drops the trailing zeros. The tag binds the text to the one secret: no
//            other secret opens it (a 256-bit collision), so its author cannot choose between two
//            messages later; the text's length is hidden within the frame size.
//   Bits     cell c (row by row) gives one bit, its digit's parity (odd = 1). Bit j is cell P[j]'s:
//            P orders 0..1023 by the 64-bit big-endian numbers in bytes 8c..8c+7 of R("perm")
//            (ties by c). R(label) = SHA-256(T | "|" | label | uint32 0) | SHA-256(T | "|" | label |
//            uint32 1) | ..., T = "terraform-seal/grain/v1".
//   Frame    the 8S bits of the frame (most significant bit of each byte first) are H x bits
//            mod 2, H a syndrome-trellis code (Filler, Judas & Fridrich 2011) of constraint height
//            11 with k = 10 + 8S rows, the first 10 carrying nothing (so every frame bit depends on
//            eleven blocks of cells). With w_i = floor((i+1) 1024 / k) - floor(i 1024 / k), state = 0:
//              for i = 0 .. k-1:  for t = 0 .. w_i - 1: if the next bit is 1, state ^= C_w[t] & m_i
//                                 if i >= 10: frame bit i - 10 = state & 1;   state >>= 1
//            m_i = 2^min(11, k - i) - 1; C_w[t] = (bytes 4t..4t+3 of R("hhat" w), big-endian, & 2047)
//            | 1 | 1024, for w = 1, 2, 3 (the widths these k give).
//   A decoder tries S = 48, 64, 80, 96, 112 in turn and takes the first frame whose magic,
//   version, mode, length (a sealed payload: at least 33 bytes) and check hold. An encoder picks the fewest grain cells to change with the Viterbi
//   algorithm on the code's trellis; every other cell keeps its digit.

const MAGIC = [0x54, 0x46, 0x53];
const VERSION = 1;
const HEADER = 7;
const CHECK = 4;
const DEFLATED = 0x80;
const enc = new TextEncoder();
const TAG_COMMIT = enc.encode('terraform-seal/commit/v1');
const TAG_LIST = enc.encode('terraform-seal/list/v1');
const INFO_SEALED = enc.encode('terraform-seal/sealed/v1');
const KEY_COMMIT = 32;
const GCM_TAG = 16;

export const SEAL_MODES = { inscription: 1, sealed: 2, commitment: 3, hash: 4, list: 5 };
const MODE_NAMES = Object.fromEntries(Object.entries(SEAL_MODES).map(([k, v]) => [v, k]));
export const SEAL_LAYOUT_ORDER = ['eighth', 'quarter', 'pinwheel', 'mirror', 'rotation', 'plain'];
export const MAX_LIST_ITEMS = 256;

function domainCells(layout) {
  const cells = [];
  const push = (r0, r1, c0, c1) => { for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) cells.push([r, c]); };
  if (layout === 'plain') push(0, 32, 0, 32);
  else if (layout === 'mirror') push(0, 32, 0, 16);
  else if (layout === 'rotation') push(0, 16, 0, 32);
  else if (layout === 'quarter' || layout === 'pinwheel') push(0, 16, 0, 16);
  else if (layout === 'eighth') for (let r = 0; r < 16; r++) for (let c = r; c < 16; c++) cells.push([r, c]);
  else throw new Error(`unknown layout ${layout}`);
  return cells;
}

// Every cell that carries the same digit as domain cell (r, c), (r, c) included.
function imagesOf(layout, r, c) {
  const quarter = (a, b) => [[a, b], [a, 31 - b], [31 - a, b], [31 - a, 31 - b]];
  if (layout === 'plain') return [[r, c]];
  if (layout === 'mirror') return [[r, c], [r, 31 - c]];
  if (layout === 'rotation') return [[r, c], [31 - r, 31 - c]];
  if (layout === 'quarter') return quarter(r, c);
  if (layout === 'pinwheel') return [[r, c], [c, 31 - r], [31 - r, 31 - c], [31 - c, r]];
  return [...quarter(r, c), ...quarter(c, r)];
}

function capacityBytes(digits) {
  const limit = 10n ** BigInt(digits);
  let b = 0;
  while (256n ** BigInt(b + 1) < limit) b++;
  return b;
}

export const SEAL_LAYOUTS = Object.fromEntries(['plain', 'mirror', 'rotation', 'quarter', 'pinwheel', 'eighth'].map((name) => {
  const digits = domainCells(name).length;
  return [name, { digits, bytes: capacityBytes(digits) }];
}));

export const normalizeText = (s) => String(s).replace(/\r\n?/g, '\n').normalize('NFC');
export const textBytes = (s) => enc.encode(normalizeText(s ?? ''));

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const sha256 = async (...parts) => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', concat(...parts)));
const u32 = (i) => new Uint8Array([(i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255]);
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const toHex = (b) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
export function fromHex(h) {
  const s = String(h).trim().replace(/^0x/i, '');
  if (!/^([0-9a-f]{2})*$/i.test(s)) throw new Error('not hex');
  return new Uint8Array(s.match(/../g)?.map((x) => parseInt(x, 16)) ?? []);
}
export function toBase64url(b) {
  let s = '';
  for (const v of b) s += String.fromCharCode(v);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64url(t) {
  const s = String(t).trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*$/.test(s)) throw new Error('not base64url');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

// --- DEFLATE (raw), where the platform has it ---------------------------------
export const canCompress = () => typeof globalThis.CompressionStream === 'function' && typeof globalThis.DecompressionStream === 'function';
// A compressed text inflates to at most 64 KiB, here and in the on-chain reader
// (TerraformSealReader.MAX_INFLATED); larger texts are stored as they are (and then too long).
const MAX_INFLATED = 65536;
async function pipe(bytes, stream) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED) { await reader.cancel(); throw new Error('decompresses to more than 64 KiB'); }
    chunks.push(value);
  }
  return concat(...chunks);
}
const deflate = (b) => pipe(b, new globalThis.CompressionStream('deflate-raw'));
async function inflate(b) {
  if (!canCompress()) throw new Error('this seal is compressed and this browser cannot decompress it');
  return pipe(b, new globalThis.DecompressionStream('deflate-raw'));
}
// The text as stored: DEFLATE'd only when strictly shorter.
async function packText(bytes, compress) {
  if (compress && canCompress() && bytes.length > 0 && bytes.length <= MAX_INFLATED) {
    const z = await deflate(bytes);
    if (z.length < bytes.length) return { data: z, deflated: true };
  }
  return { data: bytes, deflated: false };
}

// --- sealed: one secret -> key, nonce, commitment -------------------------------
async function sealedKeys(secret) {
  const base = await globalThis.crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const bits = new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO_SEALED }, base, (32 + 12 + KEY_COMMIT) * 8));
  const key = await globalThis.crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, nonce: bits.slice(32, 44), commitment: bits.slice(44) };
}

// --- list: an RFC 6962-shaped Merkle tree --------------------------------------
const leafHash = (salt, content) => sha256(new Uint8Array([0]), TAG_LIST, salt, content);
const nodeHash = (a, b) => sha256(new Uint8Array([1]), a, b);
const split = (n) => { let k = 1; while (k * 2 < n) k *= 2; return k; };
async function treeRoot(leaves) {
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return nodeHash(await treeRoot(leaves.slice(0, k)), await treeRoot(leaves.slice(k)));
}
async function auditPath(m, leaves) {
  if (leaves.length === 1) return [];
  const k = split(leaves.length);
  return m < k
    ? [...await auditPath(m, leaves.slice(0, k)), await treeRoot(leaves.slice(k))]
    : [...await auditPath(m - k, leaves.slice(k)), await treeRoot(leaves.slice(0, k))];
}
async function rootFromPath(m, n, leaf, path) {
  // Rebuild the shape top-down to know, at each level, which side the sibling is on.
  const sides = [];
  let size = n, idx = m;
  while (size > 1) {
    const k = split(size);
    if (idx < k) { sides.push('R'); size = k; } else { sides.push('L'); idx -= k; size -= k; }
  }
  if (sides.length !== path.length) return null;
  let h = leaf;
  for (let i = path.length - 1, j = 0; i >= 0; i--, j++) {
    h = sides[i] === 'R' ? await nodeHash(h, path[j]) : await nodeHash(path[j], h);
  }
  return h;
}

/** A list item's reveal token: tfs1:<index>:<base64url(salt | text)>:<path hashes, hex, joined by .> */
export function listItemToken(item) {
  return `tfs1:${item.index}:${toBase64url(concat(item.salt, item.content))}:${item.path.map(toHex).join('.')}`;
}
export function parseListItemToken(token) {
  const m = /^tfs1:(\d+):([A-Za-z0-9_-]+):([0-9a-f.]*)$/i.exec(String(token).trim());
  if (!m) throw new Error('not an item reveal (tfs1:…)');
  const body = fromBase64url(m[2]);
  if (body.length < 16) throw new Error('item reveal too short');
  return { index: Number(m[1]), salt: body.slice(0, 16), content: body.slice(16), path: m[3] ? m[3].split('.').map(fromHex) : [] };
}

// --- capacity ----------------------------------------------------------------------
const FIXED = { commitment: 32, hash: 32, list: 34 };
/** Most stored text bytes (after any compression) this layout holds in this mode; Infinity
 *  where the stored payload has a fixed size; 0 where the mode does not fit at all. */
export function sealCapacity(layout, mode) {
  const B = SEAL_LAYOUTS[layout].bytes;
  if (mode === 'inscription') return B - HEADER - CHECK;
  if (mode === 'sealed') return Math.max(0, B - HEADER - CHECK - KEY_COMMIT - GCM_TAG - 2);
  if (FIXED[mode]) return B - HEADER - CHECK >= FIXED[mode] ? Infinity : 0;
  throw new Error(`unknown mode ${mode}`);
}

/** The bytes a text takes as stored (compressed when shorter), for capacity counters. */
export async function storedTextLength(text, compress = true) {
  return (await packText(textBytes(text), compress)).data.length;
}

async function containerToHeightmap(layout, modeByte, payload) {
  const L = SEAL_LAYOUTS[layout];
  const used = HEADER + payload.length + CHECK;
  if (used > L.bytes) throw new Error(`too long for the ${layout} layout`);
  const body = concat(new Uint8Array([...MAGIC, VERSION, modeByte, (payload.length >> 8) & 255, payload.length & 255]), payload);
  const check = (await sha256(body)).subarray(0, CHECK);
  const fill = new Uint8Array(L.bytes - used);
  for (let i = 0, o = 0; o < fill.length; i++, o += 32) fill.set((await sha256(check, enc.encode('fill'), u32(i))).subarray(0, Math.min(32, fill.length - o)), o);
  let n = 0n;
  for (const v of concat(body, check, fill)) n = (n << 8n) | BigInt(v);
  const digits = n.toString(10).padStart(L.digits, '0');
  const grid = Array.from({ length: 32 }, () => new Array(32).fill(null));
  domainCells(layout).forEach(([r, c], i) => { for (const [rr, cc] of imagesOf(layout, r, c)) grid[rr][cc] = digits[i]; });
  return grid.map((row) => row.join('')).join('');
}

/**
 * Write a seal. Returns { heightmap, layout, mode, compressed, reveal }:
 *   heightmap   the 1024-digit string to commit;
 *   reveal      what to keep and publish later: { secret } (sealed), { salt } (commitment),
 *               { items: [{ index, text, salt, path, token }] } (list), {} otherwise.
 * Content: `text`, or `bytes` (a file) for commitment and hash, or `digest` (hex) for hash.
 * `items` (strings) for list. `secret`, `salt`, `salts` may be passed in (test vectors);
 * otherwise random. `compress` (default true) DEFLATEs text where that is shorter.
 */
export async function encodeSeal({ mode, layout = 'eighth', text, bytes, digest, items, secret, salt, salts, compress = true }) {
  if (!SEAL_LAYOUTS[layout]) throw new Error(`unknown layout ${layout}`);
  const kind = SEAL_MODES[mode];
  if (!kind) throw new Error(`unknown mode ${mode}`);
  const content = () => (bytes ? new Uint8Array(bytes) : textBytes(text));
  let payload, deflated = false;
  const reveal = {};
  if (mode === 'inscription') {
    ({ data: payload, deflated } = await packText(textBytes(text), compress));
    const cap = sealCapacity(layout, mode);
    if (payload.length > cap) throw new Error(`too long: ${payload.length} bytes stored, the ${layout} layout holds ${cap}`);
  } else if (mode === 'sealed') {
    const cap = sealCapacity(layout, mode);
    if (cap === 0) throw new Error(`the ${layout} layout is too small for a sealed message`);
    let data;
    ({ data, deflated } = await packText(textBytes(text), compress));
    if (data.length > cap) throw new Error(`too long: ${data.length} bytes stored, the ${layout} layout holds ${cap} sealed`);
    const plain = new Uint8Array(cap + 2);
    plain[0] = (data.length >> 8) & 255;
    plain[1] = data.length & 255;
    plain.set(data, 2);
    const s = secret ? new Uint8Array(secret) : random(32);
    if (s.length !== 32) throw new Error('a secret is 32 bytes');
    const k = await sealedKeys(s);
    const plen = KEY_COMMIT + plain.length + GCM_TAG;
    const aad = new Uint8Array([...MAGIC, VERSION, kind | (deflated ? DEFLATED : 0), (plen >> 8) & 255, plen & 255]);
    const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: k.nonce, additionalData: aad }, k.key, plain));
    payload = concat(k.commitment, ct);
    reveal.secret = toBase64url(s);
  } else if (mode === 'commitment') {
    const sl = salt ? new Uint8Array(salt) : random(16);
    if (sl.length !== 16) throw new Error('a salt is 16 bytes');
    payload = await sha256(TAG_COMMIT, new Uint8Array([0]), sl, content());
    reveal.salt = toHex(sl);
  } else if (mode === 'hash') {
    if (digest != null) {
      payload = fromHex(String(digest).trim().split(/\s+/)[0]);
      if (payload.length !== 32) throw new Error('a SHA-256 digest is 64 hex characters');
    } else {
      payload = await sha256(content());
    }
    reveal.digest = toHex(payload);
  } else {
    const list = (items ?? []).map((t) => String(t));
    if (list.length < 1) throw new Error('a list needs at least one item');
    if (list.length > MAX_LIST_ITEMS) throw new Error(`a list holds at most ${MAX_LIST_ITEMS} items`);
    const sls = list.map((_, i) => (salts?.[i] ? new Uint8Array(salts[i]) : random(16)));
    const contents = list.map((t) => textBytes(t));
    const leaves = await Promise.all(contents.map((c, i) => leafHash(sls[i], c)));
    const root = await treeRoot(leaves);
    payload = concat(root, new Uint8Array([(list.length >> 8) & 255, list.length & 255]));
    reveal.items = [];
    for (let i = 0; i < list.length; i++) {
      const item = { index: i, text: normalizeText(list[i]), salt: sls[i], content: contents[i], path: await auditPath(i, leaves) };
      reveal.items.push({ index: i, text: item.text, salt: toHex(sls[i]), token: listItemToken(item) });
    }
  }
  const modeByte = kind | (deflated ? DEFLATED : 0);
  const heightmap = await containerToHeightmap(layout, modeByte, payload);
  return { heightmap, layout, mode, compressed: deflated, reveal };
}

/**
 * Find a seal in a heightmap (1024 digits; whitespace ignored). Returns null, or
 * { layout, mode, compressed, payload, fillerIntact } plus text (inscription), digest
 * (commitment, hash), root and count (list).
 */
export async function decodeSeal(heightmap) {
  const hm = String(heightmap).replace(/\s+/g, '');
  if (!/^[0-9]{1024}$/.test(hm)) return null;
  const at = (r, c) => hm[r * 32 + c];
  for (const layout of SEAL_LAYOUT_ORDER) {
    const L = SEAL_LAYOUTS[layout];
    const cells = domainCells(layout);
    if (!cells.every(([r, c]) => imagesOf(layout, r, c).every(([rr, cc]) => at(rr, cc) === at(r, c)))) continue;
    let n = BigInt(cells.map(([r, c]) => at(r, c)).join(''));
    if (n >= 256n ** BigInt(L.bytes)) continue;
    const bytes = new Uint8Array(L.bytes);
    for (let i = L.bytes - 1; i >= 0; i--) { bytes[i] = Number(n & 255n); n >>= 8n; }
    if (!MAGIC.every((v, i) => bytes[i] === v) || bytes[3] !== VERSION) continue;
    const mode = MODE_NAMES[bytes[4] & 0x0f];
    const compressed = (bytes[4] & DEFLATED) !== 0;
    const len = (bytes[5] << 8) | bytes[6];
    if (!mode || (bytes[4] & 0x70) || HEADER + len + CHECK > L.bytes) continue;
    if (compressed && mode !== 'inscription' && mode !== 'sealed') continue;
    const check = (await sha256(bytes.subarray(0, HEADER + len))).subarray(0, CHECK);
    if (!equal(check, bytes.subarray(HEADER + len, HEADER + len + CHECK))) continue;
    const used = HEADER + len + CHECK;
    let fillerIntact = true;
    for (let i = 0, o = used; o < L.bytes; i++, o += 32) {
      const block = await sha256(check, enc.encode('fill'), u32(i));
      if (!equal(block.subarray(0, Math.min(32, L.bytes - o)), bytes.subarray(o, Math.min(o + 32, L.bytes)))) { fillerIntact = false; break; }
    }
    const payload = bytes.slice(HEADER, HEADER + len);
    if (FIXED[mode] && payload.length !== FIXED[mode]) continue;
    const out = { layout, mode, compressed, payload, fillerIntact };
    if (mode === 'inscription') {
      const raw = compressed ? await inflate(payload) : payload;
      out.text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
    }
    if (mode === 'commitment' || mode === 'hash') out.digest = toHex(payload);
    if (mode === 'list') {
      out.root = toHex(payload.subarray(0, 32));
      out.count = (payload[32] << 8) | payload[33];
      if (out.count < 1 || out.count > MAX_LIST_ITEMS) continue;
    }
    return out;
  }
  return null;
}

/** Open a sealed message with its secret (base64url), in the digits or in a grain (openGrainSeal). Throws if it is not this seal's. */
export async function openSeal(decoded, secretText) {
  if (decoded?.carrier === 'grain') return openGrainSeal(decoded, secretText);
  if (decoded?.mode !== 'sealed') throw new Error('not a sealed message');
  let s;
  try { s = fromBase64url(secretText); } catch { throw new Error('a secret is 43 characters of base64url'); }
  if (s.length !== 32) throw new Error('a secret is 32 bytes (43 characters)');
  const k = await sealedKeys(s);
  const p = decoded.payload;
  if (!equal(k.commitment, p.subarray(0, KEY_COMMIT))) throw new Error('this secret does not open this seal');
  const aad = new Uint8Array([...MAGIC, VERSION, SEAL_MODES.sealed | (decoded.compressed ? DEFLATED : 0), (p.length >> 8) & 255, p.length & 255]);
  let plain;
  try {
    plain = new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: k.nonce, additionalData: aad }, k.key, p.subarray(KEY_COMMIT)));
  } catch {
    throw new Error('this secret does not open this seal');
  }
  const len = (plain[0] << 8) | plain[1];
  if (len > plain.length - 2) throw new Error('malformed sealed message');
  const data = plain.subarray(2, 2 + len);
  return new TextDecoder().decode(decoded.compressed ? await inflate(data) : data);
}

/** Check a revealed commitment: content (text, or bytes for a file) and salt (hex). */
export async function verifyCommitment(decoded, { text, bytes }, saltHex) {
  if (decoded?.mode !== 'commitment') throw new Error('not a commitment');
  const s = fromHex(saltHex);
  if (s.length !== 16) throw new Error('a salt is 16 bytes (32 hex characters)');
  const content = bytes ? new Uint8Array(bytes) : textBytes(text);
  return equal(await sha256(TAG_COMMIT, new Uint8Array([0]), s, content), decoded.payload);
}

/** Check a plain hash: text, bytes (a file) or a digest (hex). */
export async function verifyHash(decoded, { text, bytes, digest }) {
  if (decoded?.mode !== 'hash') throw new Error('not a hash');
  let d;
  if (digest != null) d = fromHex(String(digest).trim().split(/\s+/)[0]);
  else d = await sha256(bytes ? new Uint8Array(bytes) : textBytes(text));
  return equal(d, decoded.payload);
}

/** Check one revealed list item (its tfs1:… token). Returns { ok, index, text }. */
export async function verifyListItem(decoded, token) {
  if (decoded?.mode !== 'list') throw new Error('not a list');
  const it = parseListItemToken(token);
  if (it.index >= decoded.count) return { ok: false, index: it.index, text: null };
  const root = await rootFromPath(it.index, decoded.count, await leafHash(it.salt, it.content), it.path);
  return { ok: !!root && equal(root, decoded.payload.subarray(0, 32)), index: it.index, text: new TextDecoder().decode(it.content) };
}

/** The 1024 digits from a parcel's stored canvas (16 uint256, as BigInt or decimal strings). */
export function heightmapFromCanvas(uints) {
  if (!Array.isArray(uints) || uints.length !== 16) throw new Error('a canvas is 16 numbers');
  return uints.map((v) => {
    const s = BigInt(v).toString(10);
    if (s.length > 64 || BigInt(v) < 0n) throw new Error('a canvas number has at most 64 digits');
    return s.padStart(64, '0');
  }).join('');
}

/** tokenId and the 16 canvas numbers from commitDreamToCanvas calldata (selector 0x502f260c). */
export function parseCommitCalldata(hex) {
  const s = String(hex).replace(/^0x/i, '').toLowerCase();
  if (!s.startsWith('502f260c') || s.length !== 8 + 64 * 17 || !/^[0-9a-f]+$/.test(s)) return null;
  const words = [];
  for (let i = 0; i < 17; i++) words.push(BigInt('0x' + s.slice(8 + i * 64, 8 + (i + 1) * 64)));
  return { tokenId: Number(words[0]), canvas: words.slice(1) };
}

// --- grain seals (see GRAIN SEALS above) -------------------------------------------
export const GRAIN_SIZES = [48, 64, 80, 96, 112];
export const GRAIN_MODES = ['inscription', 'sealed', 'commitment', 'hash', 'list'];
const INFO_GRAIN_SEALED = enc.encode('terraform-seal/grain-sealed/v1');
const GRAIN_TAG_BYTES = 32;
const GRAIN_TAG = 'terraform-seal/grain/v1';
const GRAIN_H = 11;
const CELLS = 1024;

async function grainR(label, n) {
  const out = new Uint8Array(Math.ceil(n / 32) * 32);
  for (let i = 0; 32 * i < n; i++) out.set(await sha256(enc.encode(`${GRAIN_TAG}|${label}`), u32(i)), 32 * i);
  return out.subarray(0, n);
}

let grainTables = null;
/** The code's public tables: perm (bit j is cell perm[j]'s parity) and the columns C_w. */
export function grainCode() {
  if (!grainTables) {
    grainTables = (async () => {
      const r = await grainR('perm', 8 * CELLS);
      const keys = Array.from({ length: CELLS }, (_, c) => {
        let k = 0n;
        for (let b = 0; b < 8; b++) k = (k << 8n) | BigInt(r[8 * c + b]);
        return [k, c];
      });
      keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
      const cols = {};
      for (const w of [1, 2, 3]) {
        const h = await grainR(`hhat${w}`, 4 * w);
        cols[w] = Array.from({ length: w }, (_, t) => ((h[4 * t + 2] << 8 | h[4 * t + 3]) & 2047) | 1 | 1024);
      }
      return { perm: keys.map((k) => k[1]), cols };
    })();
  }
  return grainTables;
}

/** Most text bytes a grain frame of this size holds: an inscription's, or a sealed message's. */
export function grainTextCapacity(mode, size) {
  if (!GRAIN_SIZES.includes(size)) throw new Error(`a grain frame is ${GRAIN_SIZES.join(', ')} bytes`);
  if (mode === 'inscription') return size - HEADER - CHECK;
  if (mode === 'sealed') return size - HEADER - CHECK - GRAIN_TAG_BYTES;
  throw new Error('only inscriptions and sealed messages carry a text');
}

const grainWidth = (i, k) => Math.floor(((i + 1) * CELLS) / k) - Math.floor((i * CELLS) / k);

// The trellis has HEAD + 8S rows; the first HEAD carry nothing (an encoder may leave them as
// they fall), so every frame bit sees GRAIN_H blocks of cells.
const GRAIN_HEAD = GRAIN_H - 1;
function grainSyndrome(bits, size, cols) {
  const k = GRAIN_HEAD + 8 * size, out = new Uint8Array(size);
  let state = 0, j = 0;
  for (let i = 0; i < k; i++) {
    const w = grainWidth(i, k), mask = (1 << Math.min(GRAIN_H, k - i)) - 1;
    for (let t = 0; t < w; t++, j++) if (bits[j]) state ^= cols[w][t] & mask;
    const f = i - GRAIN_HEAD;
    if (f >= 0 && state & 1) out[f >> 3] |= 0x80 >> (f & 7);
    state >>= 1;
  }
  return out;
}

async function grainFrame(modeByte, payload, size) {
  const body = concat(new Uint8Array([...MAGIC, VERSION, modeByte, (payload.length >> 8) & 255, payload.length & 255]), payload);
  const check = (await sha256(body)).subarray(0, CHECK);
  const f = new Uint8Array(size);
  f.set(concat(body, check));
  for (let i = 0, o = body.length + CHECK; o < size; i++, o += 32) f.set((await sha256(check, enc.encode('fill'), u32(i))).subarray(0, Math.min(32, size - o)), o);
  return f;
}

async function parseGrainFrame(f) {
  if (!MAGIC.every((v, i) => f[i] === v) || f[3] !== VERSION) return null;
  const mode = MODE_NAMES[f[4]];
  if (!mode) return null;
  const len = (f[5] << 8) | f[6];
  if (HEADER + len + CHECK > f.length) return null;
  const check = (await sha256(f.subarray(0, HEADER + len))).subarray(0, CHECK);
  if (!equal(check, f.subarray(HEADER + len, HEADER + len + CHECK))) return null;
  const payload = f.slice(HEADER, HEADER + len);
  if (FIXED[mode] && payload.length !== FIXED[mode]) return null;
  if (mode === 'sealed' && payload.length < GRAIN_TAG_BYTES + 1) return null;
  let fillerIntact = true;
  for (let i = 0, o = HEADER + len + CHECK; o < f.length; i++, o += 32) {
    const block = await sha256(check, enc.encode('fill'), u32(i));
    if (!equal(block.subarray(0, Math.min(32, f.length - o)), f.subarray(o, Math.min(o + 32, f.length)))) { fillerIntact = false; break; }
  }
  const out = { mode, compressed: false, payload, fillerIntact };
  if (mode === 'inscription') out.text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
  if (mode === 'commitment' || mode === 'hash') out.digest = toHex(payload);
  if (mode === 'list') {
    out.root = toHex(payload.subarray(0, 32));
    out.count = (payload[32] << 8) | payload[33];
    if (out.count < 1 || out.count > MAX_LIST_ITEMS) return null;
  }
  return out;
}

/**
 * Find a seal hidden in a heightmap's grain. Returns null, or { carrier: 'grain', size, mode,
 * compressed: false, payload, fillerIntact } plus text / digest / root and count, as decodeSeal.
 */
export async function decodeGrain(heightmap) {
  const hm = String(heightmap).replace(/\s+/g, '');
  if (!/^[0-9]{1024}$/.test(hm)) return null;
  const { perm, cols } = await grainCode();
  const bits = perm.map((c) => hm.charCodeAt(c) & 1);
  for (const size of GRAIN_SIZES) {
    const out = await parseGrainFrame(grainSyndrome(bits, size, cols));
    if (out) return { carrier: 'grain', size, ...out };
  }
  return null;
}

// --- sealed in a grain: HKDF keys, a SHA-256 keystream, an HMAC-SHA256 tag
async function grainSealedKeys(secret) {
  const base = await globalThis.crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const bits = new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO_GRAIN_SEALED }, base, 64 * 8));
  return { ke: bits.slice(0, 32), km: bits.slice(32, 64) };
}
async function grainKeystream(ke, n) {
  const out = new Uint8Array(Math.ceil(n / 32) * 32);
  for (let i = 0; 32 * i < n; i++) out.set(await sha256(ke, u32(i)), 32 * i);
  return out.subarray(0, n);
}
async function hmacSha256(key, data) {
  const k = await globalThis.crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', k, data));
}
const grainSealedHeader = (n) => new Uint8Array([...MAGIC, VERSION, SEAL_MODES.sealed, (n >> 8) & 255, n & 255]);
async function grainSealPayload(secret, data, size) {
  const n = size - HEADER - CHECK - GRAIN_TAG_BYTES;
  const plain = new Uint8Array(n);
  plain.set(data);
  const { ke, km } = await grainSealedKeys(secret);
  const ks = await grainKeystream(ke, n);
  const ct = plain.map((v, i) => v ^ ks[i]);
  const tag = await hmacSha256(km, concat(grainSealedHeader(n + GRAIN_TAG_BYTES), ct));
  return concat(ct, tag);
}

/** Open a grain-sealed message with its secret (43 characters of base64url). Throws if it is not this seal's. */
export async function openGrainSeal(decoded, secretText) {
  if (decoded?.carrier !== 'grain' || decoded.mode !== 'sealed') throw new Error('not a sealed message in a grain');
  let s;
  try { s = fromBase64url(secretText); } catch { throw new Error('a secret is 43 characters of base64url'); }
  if (s.length !== 32) throw new Error('a secret is 32 bytes (43 characters)');
  const p = decoded.payload, n = p.length - GRAIN_TAG_BYTES;
  const { ke, km } = await grainSealedKeys(s);
  if (!equal(await hmacSha256(km, concat(grainSealedHeader(p.length), p.subarray(0, n))), p.subarray(n))) throw new Error('this secret does not open this seal');
  const ks = await grainKeystream(ke, n);
  const plain = p.subarray(0, n).map((v, i) => v ^ ks[i]);
  let end = n;
  while (end > 0 && plain[end - 1] === 0) end--;
  return new TextDecoder().decode(plain.subarray(0, end));
}

/** A seal of either kind: in the digits (decodeSeal) or else in the grain (decodeGrain). */
export async function findSeal(heightmap) {
  return (await decodeSeal(heightmap)) ?? (await decodeGrain(heightmap));
}

// Viterbi on the trellis: the cheapest y (cost rho per changed bit, Infinity = fixed) with H y = m
// (m[i] null: row i is free).
function grainEmbed(x, rho, m, cols) {
  const k = m.length, S = 1 << GRAIN_H;
  const choice = [];
  let wght = new Float64Array(S).fill(Infinity);
  wght[0] = 0;
  const steps = [];
  let j = 0;
  for (let i = 0; i < k; i++) {
    const w = grainWidth(i, k), mask = (1 << Math.min(GRAIN_H, k - i)) - 1;
    for (let t = 0; t < w; t++, j++) {
      const c = cols[w][t] & mask, r = rho[j];
      const a0 = x[j] === 1 ? r : 0, a1 = x[j] === 0 ? r : 0;
      const next = new Float64Array(S), take = new Uint8Array(S);
      for (let s = 0; s < S; s++) {
        const stay = wght[s] + a0, flip = wght[s ^ c] + a1;
        if (flip < stay) { next[s] = flip; take[s] = 1; } else next[s] = stay;
      }
      steps.push([c, take]);
      wght = next;
    }
    const shifted = new Float64Array(S).fill(Infinity);
    if (m[i] === null) {
      const pick = new Uint8Array(S / 2);
      for (let t = 0; t < S / 2; t++) { pick[t] = wght[2 * t + 1] < wght[2 * t] ? 1 : 0; shifted[t] = wght[2 * t + pick[t]]; }
      choice[i] = pick;
    } else for (let t = 0; t < S / 2; t++) shifted[t] = wght[2 * t + m[i]];
    wght = shifted;
  }
  if (!Number.isFinite(wght[0])) return null;
  const y = new Uint8Array(CELLS);
  let s = 0;
  j = CELLS;
  for (let i = k - 1; i >= 0; i--) {
    s = (s << 1) | (m[i] === null ? choice[i][s] : m[i]);
    for (let t = 0; t < grainWidth(i, k); t++) {
      j--;
      const [c, take] = steps[j];
      y[j] = take[s];             // the bit chosen for cell j (1: its column joined the sum)
      if (take[s]) s ^= c;
    }
  }
  return s === 0 ? y : null;
}

/**
 * Hide a seal in a drawing's grain. heightmap: the 1024 digits as drawn, grain included;
 * alt[c]: the digit cell c may become (of the other parity), or null where it must not change.
 * Content as for encodeSeal (texts are never compressed; a sealed message is the grain's own
 * kind, see GRAIN SEALS). size: the smallest frame to use (default: the smallest that holds it;
 * a larger one hides a sealed message's length). Returns { heightmap, mode, size, changed,
 * reveal }; throws if the grain is too small for it.
 */
export async function encodeGrain({ heightmap, alt, mode, text, bytes, digest, items, salt, salts, secret, size: minSize }) {
  const hm = String(heightmap).replace(/\s+/g, '');
  if (!/^[0-9]{1024}$/.test(hm)) throw new Error('a heightmap is 1024 digits');
  if (!GRAIN_MODES.includes(mode)) throw new Error(`a grain seal is an ${GRAIN_MODES.join(', ')}`);
  if (!Array.isArray(alt) || alt.length !== CELLS) throw new Error('alt: one entry per cell');
  if (minSize != null && !GRAIN_SIZES.includes(minSize)) throw new Error(`a grain frame is ${GRAIN_SIZES.join(', ')} bytes`);
  const least = minSize ?? 0;
  for (let c = 0; c < CELLS; c++) {
    if (alt[c] == null) continue;
    if (!Number.isInteger(alt[c]) || alt[c] < 0 || alt[c] > 8 || ((alt[c] ^ Number(hm[c])) & 1) === 0 || hm[c] === '9') throw new Error(`alt[${c}] must be a digit 0-8 of the other parity, on a cell that is not empty`);
  }
  let payload, size, reveal;
  if (mode === 'sealed') {
    const data = textBytes(text);
    if (data.includes(0)) throw new Error('a sealed text cannot contain a zero character');
    size = GRAIN_SIZES.find((s) => s >= least && HEADER + CHECK + GRAIN_TAG_BYTES + data.length <= s);
    if (!size) throw new Error(`too long: ${data.length} bytes; a grain frame holds at most ${GRAIN_SIZES.at(-1) - HEADER - CHECK - GRAIN_TAG_BYTES} sealed`);
    const s = secret ? new Uint8Array(secret) : random(32);
    if (s.length !== 32) throw new Error('a secret is 32 bytes');
    payload = await grainSealPayload(s, data, size);
    reveal = { secret: toBase64url(s) };
  } else {
    // The payload and reveal exactly as a digit seal makes them (plain layout, uncompressed).
    const sealed = await encodeSeal({ mode, layout: 'plain', text, bytes, digest, items, salt, salts, compress: false });
    payload = (await decodeSeal(sealed.heightmap)).payload;
    size = GRAIN_SIZES.find((s) => s >= least && HEADER + payload.length + CHECK <= s);
    if (!size) throw new Error(`too long: ${payload.length} bytes; a grain holds at most ${GRAIN_SIZES.at(-1) - HEADER - CHECK}`);
    reveal = sealed.reveal;
  }
  const { perm, cols } = await grainCode();
  const x = perm.map((c) => hm.charCodeAt(c) & 1);
  const rho = perm.map((c) => (alt[c] == null ? Infinity : 1));
  const bitsOf = (f) => [...new Array(GRAIN_HEAD).fill(null), ...Array.from({ length: 8 * size }, (_, i) => (f[i >> 3] >> (7 - (i & 7))) & 1)];
  let y = grainEmbed(x, rho, bitsOf(await grainFrame(SEAL_MODES[mode], payload, size)), cols);
  // A sealed message is random-looking: when the trellis cannot reach it, a fresh secret gives another.
  for (let attempt = 1; !y && mode === 'sealed' && !secret && attempt < 12; attempt++) {
    const s2 = random(32);
    payload = await grainSealPayload(s2, textBytes(text), size);
    reveal = { secret: toBase64url(s2) };
    y = grainEmbed(x, rho, bitsOf(await grainFrame(SEAL_MODES[mode], payload, size)), cols);
  }
  if (!y) throw new Error(`this drawing's grain is too small for a ${size}-byte seal`);
  const out = hm.split('');
  let changed = 0;
  perm.forEach((c, j) => { if (y[j] !== x[j]) { out[c] = String(alt[c]); changed++; } });
  const result = out.join('');
  const back = await decodeGrain(result);
  if (!back || back.mode !== mode || back.size !== size || !equal(back.payload, payload)) throw new Error('the grain seal did not read back');
  return { heightmap: result, mode, size, changed, reveal };
}

/** Low level, for tests and tools: the raw S-byte frame a heightmap's parities give. */
export async function grainFrameOf(heightmap, size) {
  const hm = String(heightmap).replace(/\s+/g, '');
  if (!/^[0-9]{1024}$/.test(hm) || !GRAIN_SIZES.includes(size)) throw new Error(`a heightmap and a size of ${GRAIN_SIZES.join(', ')}`);
  const { perm, cols } = await grainCode();
  return grainSyndrome(perm.map((c) => hm.charCodeAt(c) & 1), size, cols);
}

/** Low level, for tests and tools: hide any S-byte frame (unchecked) in a heightmap's grain. */
export async function embedGrainFrame({ heightmap, alt, frame }) {
  const hm = String(heightmap).replace(/\s+/g, '');
  const f = new Uint8Array(frame);
  if (!/^[0-9]{1024}$/.test(hm) || !GRAIN_SIZES.includes(f.length)) throw new Error(`a heightmap and a frame of ${GRAIN_SIZES.join(', ')} bytes`);
  const { perm, cols } = await grainCode();
  const m = [...new Array(GRAIN_HEAD).fill(null), ...Array.from({ length: 8 * f.length }, (_, i) => (f[i >> 3] >> (7 - (i & 7))) & 1)];
  const x = perm.map((c) => hm.charCodeAt(c) & 1);
  const y = grainEmbed(x, perm.map((c) => (alt[c] == null ? Infinity : 1)), m, cols);
  if (!y) throw new Error('the grain is too small for this frame');
  const out = hm.split('');
  perm.forEach((c, j) => { if (y[j] !== x[j]) out[c] = String(alt[c]); });
  return out.join('');
}
