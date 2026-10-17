// Client-side AES-GCM sealing. The key never leaves the browser; it travels in the URL fragment.
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

export async function newKey(): Promise<{ key: CryptoKey; keyText: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  return { key, keyText: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', key))) }
}
export const importKey = (keyText: string) =>
  crypto.subtle.importKey('raw', unb64u(keyText), 'AES-GCM', false, ['decrypt'])

export async function seal(obj: unknown, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))))
  return { v: 1, sealed: true as const, iv: b64u(iv), ct: b64u(ct) }
}
export async function open(p: { iv: string; ct: string }, key: CryptoKey) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(p.iv) }, key, unb64u(p.ct))
  return JSON.parse(new TextDecoder().decode(pt))
}
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<`0x${string}`> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return ('0x' + [...h].map(x => x.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

/** SHA-256 of a chosen file, computed locally. The file is never uploaded anywhere. */
export async function hashFile(file: File): Promise<`0x${string}`> {
  return sha256Hex(new Uint8Array(await file.arrayBuffer()))
}
