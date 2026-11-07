const cod = new TextEncoder()

export function aHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function aBase64(buf: ArrayBuffer | Uint8Array): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s)
}

export function deBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function tokenAleatorio(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes))
  return aBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256(t: string): Promise<string> {
  return aHex(await crypto.subtle.digest('SHA-256', cod.encode(t)))
}

async function llaveHmac(secreto: string | Uint8Array, hash = 'SHA-256') {
  const raw = typeof secreto === 'string' ? cod.encode(secreto) : secreto
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash }, false, ['sign'])
}

export async function hmac(secreto: string | Uint8Array, datos: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign('HMAC', await llaveHmac(secreto), cod.encode(datos))
}

export function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Clave AES-256 de un libro, derivada de la llave maestra (no se guarda). */
export async function claveLibro(llaveMaestra: string, libroId: string): Promise<Uint8Array> {
  return new Uint8Array(await hmac(llaveMaestra, `libro:${libroId}`))
}

export async function cifrarAesGcm(claveRaw: Uint8Array, datos: Uint8Array): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey('raw', claveRaw, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, datos))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}

/** Envuelve una clave con la clave pública RSA-OAEP (SPKI base64) del dispositivo. */
export async function envolverClave(spkiBase64: string, claveRaw: Uint8Array): Promise<string> {
  const pub = await crypto.subtle.importKey('spki', deBase64(spkiBase64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ])
  return aBase64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, claveRaw))
}

/** Código corto que se incrusta en cada página servida para rastrear filtraciones. */
export async function huella(llaveMaestra: string, partes: string[]): Promise<string> {
  const h = aHex(await hmac(llaveMaestra, `huella:${partes.join('|')}`))
  return h.slice(0, 10).toUpperCase()
}
