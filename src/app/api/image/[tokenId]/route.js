import { NextResponse } from 'next/server';
import { getContract } from '@/lib/contract';

const CACHE_MAX = 500;
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, ts: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 277 400" width="277" height="400"><rect width="277" height="400" fill="#1a1918"/><text x="138" y="200" font-size="40" text-anchor="middle" dominant-baseline="middle" fill="#888">▩</text><text x="138" y="260" font-family="monospace" font-size="11" fill="#fff" opacity="0.4" text-anchor="middle">parcel did not load</text></svg>`;

export async function GET(_req, { params }) {
  const tokenId = Number(params.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 11104) {
    return new NextResponse('invalid tokenId', { status: 400 });
  }
  const key = String(tokenId);
  let svg = cacheGet(key);
  if (!svg) {
    try {
      svg = await fetchSvg(tokenId);
      cacheSet(key, svg);
    } catch (err) {
      console.error(`[image] ${tokenId}:`, err.message);
      return new NextResponse(FALLBACK_SVG, {
        status: 200,
        headers: { ...SVG_HEADERS, 'Cache-Control': 'no-store' },
      });
    }
  }
  return new NextResponse(svg, {
    status: 200,
    headers: { ...SVG_HEADERS, 'Cache-Control': 'public, max-age=300' },
  });
}

// Lock down direct navigation: SVG can host scripts when loaded as a top-level
// document. CSP blocks all subresources/scripts; nosniff prevents MIME sniffing.
const SVG_HEADERS = {
  'Content-Type': 'image/svg+xml',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
};

async function fetchSvg(tokenId) {
  const c = getContract();
  const uri = await c.tokenURI(tokenId);
  if (!uri.startsWith('data:application/json;base64,')) {
    throw new Error('unexpected tokenURI format');
  }
  const json = JSON.parse(Buffer.from(uri.slice(29), 'base64').toString());
  const image = json.image || '';
  if (image.startsWith('data:image/svg+xml;base64,')) {
    return Buffer.from(image.slice(26), 'base64').toString();
  }
  if (image.startsWith('data:image/svg+xml,')) {
    return decodeURIComponent(image.slice(19));
  }
  throw new Error('unrecognised image format');
}
