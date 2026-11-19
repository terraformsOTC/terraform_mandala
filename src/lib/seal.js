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

/** Open a sealed message with its secret (base64url). Throws if it is not this seal's. */
export async function openSeal(decoded, secretText) {
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
