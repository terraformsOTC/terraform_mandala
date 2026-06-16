import { NextResponse } from 'next/server';

// Lightweight in-memory fixed-window rate limiter for the API routes.
//
// Per-process state: on Vercel this throttles a single warm instance rather than
// globally, but route handlers run in the Node runtime where a warm instance
// persists across invocations, so it still blunts a client hammering one
// instance (the realistic abuse / cost case for the RPC-heavy routes) without
// pulling in a shared store (KV/Upstash). Upgrade to a shared store if this ever
// needs to be a hard global guarantee.
const buckets = new Map(); // key -> { count, windowStart }
const MAX_KEYS = 10_000; // bound memory: sweep expired entries past this size

export function clientIp(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

// Returns { limited: boolean, retryAfter?: seconds }. Counts the call when allowed.
export function rateLimit(key, { max, windowMs }) {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    if (buckets.size > MAX_KEYS) {
      for (const [k, v] of buckets) if (now - v.windowStart > windowMs) buckets.delete(k);
    }
    buckets.set(key, { count: 1, windowStart: now });
    return { limited: false };
  }
  if (entry.count >= max) {
    return { limited: true, retryAfter: Math.ceil((entry.windowStart + windowMs - now) / 1000) };
  }
  entry.count += 1;
  return { limited: false };
}

// Convenience: enforce a limit and return a 429 NextResponse if exceeded, else null.
// Usage: const block = enforce(req, 'wallet', { max: 10, windowMs: 60_000 }); if (block) return block;
export function enforce(req, scope, opts) {
  const { limited, retryAfter } = rateLimit(`${scope}:${clientIp(req)}`, opts);
  if (!limited) return null;
  return NextResponse.json(
    { error: 'too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
