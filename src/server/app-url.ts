// Absolute base URL of this deployment including the base path, for links
// that leave the browser (payment callbacks, notifications).
import { BASE_PATH } from '@/lib/base-path'

export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`
  return 'http://localhost:3210'
}

export function appUrl(path = ''): string {
  return `${siteOrigin()}${BASE_PATH}${path}`
}
