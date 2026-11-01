// Signed server-side uploads to Cloudinary (credentials never reach the browser).
import { createHash } from 'node:crypto'

export function cloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET,
  )
}

const ALLOWED = /^data:image\/(png|jpe?g|webp);base64,/

/** Uploads a browser-resized image (data URL) and returns its HTTPS URL. */
export async function uploadImage(
  dataUrl: string,
  folder: string,
): Promise<{ url: string; width: number; height: number }> {
  if (!cloudinaryConfigured()) throw new Error('Cloudinary is not configured')
  if (!ALLOWED.test(dataUrl)) throw new Error('Unsupported image type')
  if (dataUrl.length > 5_500_000) throw new Error('Image too large')
  const timestamp = Math.floor(Date.now() / 1000)
  const params = `folder=${folder}&timestamp=${timestamp}`
  const signature = createHash('sha1')
    .update(params + process.env.CLOUDINARY_API_SECRET)
    .digest('hex')
  const body = new FormData()
  body.set('file', dataUrl)
  body.set('folder', folder)
  body.set('timestamp', String(timestamp))
  body.set('api_key', process.env.CLOUDINARY_API_KEY!)
  body.set('signature', signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(30_000),
  })
  const data = (await res.json()) as {
    secure_url?: string
    width?: number
    height?: number
    error?: { message?: string }
  }
  if (!res.ok || !data.secure_url) throw new Error(`Cloudinary upload failed: ${data.error?.message ?? res.status}`)
  return { url: data.secure_url, width: data.width ?? 0, height: data.height ?? 0 }
}
