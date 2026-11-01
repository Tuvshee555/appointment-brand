// Token and signature helpers (server only, no Next.js imports).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function secret(name: 'SESSION_SECRET' | 'QPAY_CALLBACK_SECRET'): string {
  const value = process.env[name] || (name === 'QPAY_CALLBACK_SECRET' ? process.env.SESSION_SECRET : undefined)
  if (!value || value.length < 16) {
    if (process.env.NODE_ENV === 'production') throw new Error(`${name} must be set (>= 32 random characters)`)
    return 'development-only-secret-do-not-use-in-production'
  }
  return value
}

export function hmac(value: string, key: 'SESSION_SECRET' | 'QPAY_CALLBACK_SECRET' = 'SESSION_SECRET'): string {
  return createHmac('sha256', secret(key)).update(value).digest('base64url')
}

export function verifyHmac(value: string, signature: string, key: 'SESSION_SECRET' | 'QPAY_CALLBACK_SECRET' = 'SESSION_SECRET') {
  const expected = Buffer.from(hmac(value, key))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** One-way hash of an IP address for rate limits/audit — raw IPs are never stored. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  return createHmac('sha256', secret('SESSION_SECRET')).update(`ip:${ip}`).digest('hex').slice(0, 32)
}

export function randomDigits(length: number): string {
  const bytes = randomBytes(length)
  return Array.from(bytes, (b) => String(b % 10)).join('')
}
