import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class ErrorApi extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    public codigo: string,
    mensaje: string,
    public extra?: Record<string, unknown>,
  ) {
    super(status, { message: mensaje })
  }
}

export const falla = (status: ContentfulStatusCode, codigo: string, mensaje: string, extra?: Record<string, unknown>) =>
  new ErrorApi(status, codigo, mensaje, extra)

export function ahora(): string {
  return new Date().toISOString()
}

export function enDias(dias: number, desde = new Date()): string {
  return new Date(desde.getTime() + dias * 86_400_000).toISOString()
}

export function enMinutos(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString()
}

export function nuevoId(prefijo: string): string {
  return `${prefijo}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

export const aGtq = (centavos: number | null | undefined) => (centavos == null ? null : Math.round(centavos) / 100)
export const aCentavos = (gtq: number) => Math.round(gtq * 100)

export function normalizarCorreo(correo: unknown): string {
  if (typeof correo !== 'string') throw falla(400, 'correo_invalido', 'Escribe un correo válido.')
  const c = correo.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) || c.length > 200) {
    throw falla(400, 'correo_invalido', 'Escribe un correo válido.')
  }
  return c
}

export function texto(v: unknown, max = 500): string | null {
  if (v == null || v === '') return null
  if (typeof v !== 'string') throw falla(400, 'dato_invalido', 'Dato con formato inválido.')
  return v.trim().slice(0, max)
}

export function entero(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw falla(400, 'numero_invalido', 'Número inválido.')
  }
  return n
}

export async function leerJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const d = await req.json()
    if (d && typeof d === 'object') return d as T
  } catch {
    /* cae abajo */
  }
  throw falla(400, 'json_invalido', 'El cuerpo debe ser JSON.')
}

export function slugificar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

export function ip(req: Request): string | null {
  return req.headers.get('cf-connecting-ip')
}
