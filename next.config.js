/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Baseline hardening on every page response. Per-route handlers can
        // still set their own CSP (the SVG image route does, for direct-nav).
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
