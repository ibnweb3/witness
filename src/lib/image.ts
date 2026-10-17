// Small image previews stored inside a report's payload (allowed by the Arkiv team: a payload may hold the photo).
// A payload is capped at 128 KiB, and base64 adds a third, so previews are shrunk to roughly 60 KB.
export type Preview = { type: 'image/jpeg' | 'image/png' | 'image/webp'; b64: string; w: number; h: number }

const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const B64 = /^[A-Za-z0-9+/]+={0,2}$/

/** A data: URL for a preview read from the chain, or null unless it is a plain raster image in plain base64.
 *  Reports are written by strangers, so nothing else (SVG, odd types, odd characters) is ever rendered. */
export function previewSrc(p: any): string | null {
  if (!p || !OK_TYPES.includes(p.type) || typeof p.b64 !== 'string' || p.b64.length < 20 || p.b64.length > 180_000 || !B64.test(p.b64)) return null
  return `data:${p.type};base64,${p.b64}`
}

const toB64 = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Shrinks a chosen image to a JPEG of at most `maxBytes`. Re-drawing through a canvas also drops EXIF data (such as GPS). */
export async function shrinkImage(file: File, maxBytes: number): Promise<Preview> {
  const bmp = await createImageBitmap(file) // applies the EXIF orientation before the metadata is dropped
  try {
    let side = Math.min(1280, Math.max(bmp.width, bmp.height))
    for (let attempt = 0; attempt < 14; attempt++) {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) // JPEG has no transparency
      ctx.drawImage(bmp, 0, 0, w, h)
      for (const q of [0.82, 0.7, 0.58, 0.46]) {
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', q))
        if (blob && blob.size <= maxBytes) return { type: 'image/jpeg', b64: toB64(await blob.arrayBuffer()), w, h }
      }
      side = Math.round(side * 0.8)
    }
  } finally { bmp.close() }
  throw new Error('Could not shrink that image small enough. Try a simpler or smaller picture.')
}
