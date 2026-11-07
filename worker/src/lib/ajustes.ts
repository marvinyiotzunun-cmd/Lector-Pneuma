import type { Env } from '../env'

export const AJUSTES_NUMERICOS = [
  'limite_dispositivos',
  'dias_licencia_sin_conexion',
  'obras_sin_conexion_por_dispositivo',
  'paginas_por_minuto',
  'envio_centavos',
  'asistente_tope_centavos_usd',
] as const

export async function ajuste(env: Env, clave: string, porDefecto: string): Promise<string> {
  const f = await env.DB.prepare('SELECT valor FROM ajustes WHERE clave = ?').bind(clave).first<{ valor: string }>()
  return f?.valor ?? porDefecto
}

export async function ajusteNum(env: Env, clave: string, porDefecto: number): Promise<number> {
  const v = Number(await ajuste(env, clave, String(porDefecto)))
  return Number.isFinite(v) ? v : porDefecto
}

export async function todosLosAjustes(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare('SELECT clave, valor FROM ajustes ORDER BY clave').all<{
    clave: string
    valor: string
  }>()
  return Object.fromEntries(results.map((r) => [r.clave, r.valor]))
}
