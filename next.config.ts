import type { NextConfig } from 'next'

// The salon is one zone of the Ursgal Digital site: it is served under
// /portfolio/appointments both on its own deployment and when the Ursgal site
// rewrites that path here (Next.js multi-zones). See docs/DEPLOYMENT.md.
const basePath = '/portfolio/appointments'

// Origins allowed to post Server Actions through the Ursgal rewrite.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'ursgal-digital.vercel.app')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
]

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  serverExternalPackages: ['pg', 'embedded-postgres'],
  experimental: {
    // Service and staff photos are resized in the browser before upload.
    serverActions: { bodySizeLimit: '6mb', allowedOrigins },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  async redirects() {
    // The deployment's own root forwards to the salon.
    return [{ source: '/', destination: basePath, basePath: false, permanent: false }]
  },
}

export default nextConfig
