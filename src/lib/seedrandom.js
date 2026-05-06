// mulberry32 — small, deterministic PRNG. Returns float in [0, 1).
// Public-domain reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit string hash → 32-bit unsigned int seed.
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seedString) {
  return mulberry32(hashSeed(String(seedString)));
}

export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return buf[0].toString(16).padStart(8, '0') + buf[1].toString(16).padStart(8, '0');
  }
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}
