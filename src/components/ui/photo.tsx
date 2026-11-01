import Image, { type ImageProps } from 'next/image'
import { withBasePath } from '@/lib/base-path'

/**
 * next/image for salon photos. Local paths get the base path (next/image does
 * not add it); Cloudinary URLs pass through. Use `fill` inside a sized,
 * aspect-ratio box so the layout never shifts while images load.
 */
export function Photo({ src, alt, ...props }: Omit<ImageProps, 'src'> & { src: string }) {
  return <Image src={withBasePath(src)} alt={alt} {...props} />
}
