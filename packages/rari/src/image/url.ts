import type { ImageFormat } from './constants'

export function buildImageUrl(
  src: string,
  width: number,
  quality: number,
  format?: ImageFormat,
): string {
  const params = new URLSearchParams()
  params.set('url', src)
  params.set('w', width.toString())
  params.set('q', quality.toString())
  if (format) params.set('f', format)

  return `/_rari/image?${params}`
}
