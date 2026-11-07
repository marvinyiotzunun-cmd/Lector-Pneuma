import { leer, escribir, borrar, todos } from './idb'
import { ErrorApi, type FuenteLector, type InfoObra } from '../lib/fuente'
import type { Manifiesto, Obra, Pagina } from '../lib/tipos'

/*
 * Lectura sin conexión (docs/api.md, Lectura sin conexión):
 * 1. El dispositivo tiene un par RSA-OAEP; la clave privada no se puede exportar y vive en IndexedDB.
 * 2. El servidor entrega la clave AES del libro envuelta con nuestra clave pública y un vencimiento de 14 días.
 * 3. Las páginas se descargan cifradas (IV de 12 bytes + AES-GCM) y se guardan así; solo se descifran en memoria al leer.
 * 4. Vencido el permiso no se abre nada hasta renovarlo con conexión. El reloj guardado impide atrasar la fecha del equipo.
 */

export interface Licencia {
  obra_id: string
  licencia_id: string
  clave_envuelta: string
  vence_en: string
  total_paginas: number
  descargadas: number
  obra: Obra
  manifiesto: Manifiesto
}

export interface RespuestaLicencia {
  licencia_id: string
  clave_envuelta: string
  vence_en: string
  total_paginas: number
}

// Lo que el backend (o la demostración) debe ofrecer para esta función.
export interface FuenteSinConexion {
  licencia(id: string, idDispositivo: string, clavePublica: string): Promise<RespuestaLicencia>
  paquete(id: string, n: number): Promise<ArrayBuffer>
  liberar(id: string): Promise<void>
}

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function parDeClaves(): Promise<CryptoKeyPair> {
  const guardado = await leer<CryptoKeyPair>('claves', 'dispositivo')
  if (guardado) return guardado
  const par = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    false, // la privada no se puede exportar; la pública siempre se puede leer
    ['encrypt', 'decrypt'],
  )
  await escribir('claves', par, 'dispositivo')
  return par
}

export async function clavePublica(): Promise<string> {
  const par = await parDeClaves()
  return b64(await crypto.subtle.exportKey('spki', par.publicKey))
}

// El mayor instante visto; si el reloj del equipo va para atrás, se usa este.
async function ahora(): Promise<number> {
  const visto = (await leer<number>('ajustes', 'reloj')) ?? 0
  const t = Math.max(Date.now(), visto)
  if (t > visto) await escribir('ajustes', t, 'reloj')
  return t
}

export const licencias = () => todos<Licencia>('licencias')
export const licenciaDe = (id: string) => leer<Licencia>('licencias', id)

export async function vigente(l: Licencia) {
  return new Date(l.vence_en).getTime() > (await ahora())
}

const claveLibro = new Map<string, CryptoKey>()
async function claveDe(l: Licencia): Promise<CryptoKey> {
  const k = `${l.obra_id}:${l.licencia_id}`
  if (!claveLibro.has(k)) {
    const par = await parDeClaves()
    const cruda = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, par.privateKey, deB64(l.clave_envuelta))
    claveLibro.set(k, await crypto.subtle.importKey('raw', cruda, 'AES-GCM', false, ['decrypt']))
  }
  return claveLibro.get(k)!
}

export async function descargar(
  red: FuenteSinConexion, info: InfoObra, obra: Obra, idDispositivo: string, alProgresar?: (hechas: number, total: number) => void,
): Promise<Licencia> {
  const r = await red.licencia(obra.id, idDispositivo, await clavePublica())
  const previa = await licenciaDe(obra.id)
  const l: Licencia = { obra_id: obra.id, ...r, descargadas: previa?.descargadas ?? 0, obra, manifiesto: info.manifiesto }
  await escribir('licencias', l)
  // Si la clave cambió, lo descargado antes ya no sirve.
  if (previa && previa.clave_envuelta !== r.clave_envuelta) await probarClave(l).catch(() => { l.descargadas = 0 })
  for (let n = l.descargadas + 1; n <= l.total_paginas; n++) {
    await escribir('paginas', await red.paquete(obra.id, n), `${obra.id}:${n}`)
    l.descargadas = n
    if (n % 5 === 0 || n === l.total_paginas) await escribir('licencias', l)
    alProgresar?.(n, l.total_paginas)
  }
  return l
}

async function probarClave(l: Licencia) {
  claveLibro.clear()
  await descifrar(l, 1)
}

async function descifrar(l: Licencia, n: number): Promise<Uint8Array> {
  const cifrada = await leer<ArrayBuffer>('paginas', `${l.obra_id}:${n}`)
  if (!cifrada) throw new ErrorApi(404, 'no_descargada', 'Esta página no se descargó.')
  const bytes = new Uint8Array(cifrada)
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await claveDe(l), bytes.slice(12))
  return new Uint8Array(claro)
}

export async function paginaLocal(id: string, n: number): Promise<Pagina> {
  const l = await licenciaDe(id)
  if (!l) throw new ErrorApi(404, 'no_descargado', 'Este libro no está descargado.')
  if (!(await vigente(l))) throw new ErrorApi(403, 'licencia_vencida', 'El permiso sin conexión venció. Conéctate a internet para renovarlo.')
  const bytes = await descifrar(l, n)
  if (l.manifiesto.tipo_pagina === 'html') return { tipo: 'html', html: new TextDecoder().decode(bytes) }
  // Las páginas de imagen llegan envueltas en SVG con la marca de agua; si no, son WebP.
  const inicio = new TextDecoder().decode(bytes.slice(0, 64)).trimStart()
  return { tipo: 'imagen', imagen: new Blob([bytes], { type: inicio.startsWith('<') ? 'image/svg+xml' : 'image/webp' }) }
}

export async function quitar(red: FuenteSinConexion | null, id: string) {
  const l = await licenciaDe(id)
  if (!l) return
  await red?.liberar(id).catch(() => {})
  for (let n = 1; n <= l.total_paginas; n++) await borrar('paginas', `${id}:${n}`)
  await borrar('licencias', id)
}

// Renueva al tener conexión los permisos que vencen en menos de 7 días.
export async function renovar(red: FuenteSinConexion, idDispositivo: string) {
  const pub = await clavePublica()
  for (const l of await licencias()) {
    if (new Date(l.vence_en).getTime() - Date.now() > 7 * 864e5) continue
    try {
      const r = await red.licencia(l.obra_id, idDispositivo, pub)
      await escribir('licencias', { ...l, ...r })
      claveLibro.clear()
    } catch { /* sin conexión o sin acceso: se queda como estaba */ }
  }
}

/** Envuelve la fuente de red: si un libro está descargado, sus páginas salen del dispositivo, con o sin conexión. */
export function conSinConexion(base: FuenteLector): FuenteLector {
  return {
    ...base,
    async biblioteca() {
      try {
        return await base.biblioteca()
      } catch (e) {
        const locales = await licencias()
        if (!locales.length) throw e
        return locales.map((l) => ({ ...l.obra, progreso: 0 }))
      }
    },
    async obra(id) {
      try {
        return await base.obra(id)
      } catch (e) {
        const l = await licenciaDe(id)
        if (!l) throw e
        return { manifiesto: l.manifiesto, acceso: { tipo: l.obra.acceso, vence_en: l.obra.vence_en }, paginas_permitidas: l.descargadas }
      }
    },
    async pagina(id, n) {
      const l = await licenciaDe(id)
      if (l && n <= l.descargadas) return paginaLocal(id, n)
      return base.pagina(id, n)
    },
    async leerProgreso(id) { return base.leerProgreso(id).catch(() => null) },
    async guardarProgreso(id, p) { return base.guardarProgreso(id, p).catch(() => {}) },
    async marcadores(id) { return base.marcadores(id).catch(() => []) },
    async subrayados(id) { return base.subrayados(id).catch(() => []) },
  }
}
