/** Downscale a data-URL image so vision APIs stay within size limits. */
export function compressDataUrl(dataUrl: string, maxDim = 768): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => reject(new Error('Failed to load image for compression'))
    img.src = dataUrl
  })
}

/** Resolve tldraw asset src (data:, blob:, or http) to a data URL for vision APIs. */
export async function resolveImageDataUrl(src: string): Promise<string | undefined> {
  if (src.startsWith('data:')) return src
  try {
    const res = await fetch(src)
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read image blob'))
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}
