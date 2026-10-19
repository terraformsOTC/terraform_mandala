/** @type {import('next').NextConfig} */

// Content-Security-Policy for the pages. Since 2026-10-04 the site can send a
// wallet transaction, so an injected script would no longer be a defacement but
// a signing prompt on a page people trust — this caps what any script can load
// or talk to. Everything the app uses is same-origin: thumbnails come through
// /api/image, the browser makes no third-party fetches (RPC reads go through
// /api/* or the user's own wallet extension), and the on-chain parcel HTML in
// the preview iframes is self-contained (inline script/style, data: fonts).
//
// The preview iframes are srcdoc, so they inherit this policy: that is what
// 'unsafe-inline' and font-src data: are for. The GIF exporter loads those same
// data: fonts through FontFace and an injected <style>, and downloads via a
// blob: URL. 'unsafe-eval' is dev-only (Next's dev bundles use eval).
const isDev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig = {
  async headers() {
    return [
      {
        // Baseline hardening on every response.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
      {
        // Pages only. API responses are JSON, and the SVG image route sets its
        // own stricter CSP for direct navigation — two CSP headers intersect,
        // so keeping this one off /api/* leaves that policy exactly as written.
        source: '/((?!api/).*)',
        headers: [{ key: 'Content-Security-Policy', value: csp }],
      },
    ];
  },
};

module.exports = nextConfig;
