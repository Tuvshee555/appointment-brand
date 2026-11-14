// Webhook authenticity. Meta signs the exact request bytes with the app
// secret (X-Hub-Signature-256: sha256=<hex>); the body is verified before it
// is parsed. The verify token of the GET handshake is compared in constant time.
import { createHmac, timingSafeEqual } from 'node:crypto'

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function validSignature(raw: Buffer, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false
  const expected = `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`
  return equal(expected, header.toLowerCase())
}

export function validVerifyToken(given: string | null, expected: string): boolean {
  return !!given && !!expected && equal(given, expected)
}

/** Proof that a server call comes from the app (Graph API "appsecret_proof"). */
export function appSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex')
}
