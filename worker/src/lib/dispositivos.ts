import type { Env } from '../env'
import { ajusteNum } from './ajustes'
import { ahora, falla, texto } from './util'

export interface DatosDispositivo {
  id: string
  nombre?: string
  plataforma?: string
}

export function validarDispositivo(d: unknown): DatosDispositivo {
  if (!d || typeof d !== 'object') throw falla(400, 'dispositivo_invalido', 'Dispositivo inválido.')
  const o = d as Record<string, unknown>
  const id = texto(o.id, 80)
  if (!id || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw falla(400, 'dispositivo_invalido', 'Identificador de dispositivo inválido.')
  const plataforma = (texto(o.plataforma, 10) ?? 'web') as string
  if (!['web', 'android', 'ios'].includes(plataforma)) throw falla(400, 'dispositivo_invalido', 'Plataforma inválida.')
  return { id, nombre: texto(o.nombre, 80) ?? 'Dispositivo', plataforma }
}

export async function listarDispositivos(env: Env, usuarioId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, nombre, plataforma, creado_en, ultimo_uso FROM dispositivos
      WHERE usuario_id = ? AND revocado_en IS NULL ORDER BY ultimo_uso DESC`,
  )
    .bind(usuarioId)
    .all<{ id: string; nombre: string; plataforma: string; creado_en: string; ultimo_uso: string }>()
  return results
}

/**
 * Registra (o reutiliza) un dispositivo del usuario y lo liga a la sesión.
 * Lanza 409 limite_dispositivos si ya tiene el máximo de dispositivos activos.
 */
export async function registrarDispositivo(env: Env, usuarioId: string, d: DatosDispositivo, sesionHash: string | null) {
  const existente = await env.DB.prepare('SELECT usuario_id, revocado_en FROM dispositivos WHERE id = ?')
    .bind(d.id)
    .first<{ usuario_id: string; revocado_en: string | null }>()
  if (existente && existente.usuario_id !== usuarioId) {
    throw falla(409, 'dispositivo_ajeno', 'Este dispositivo está registrado con otra cuenta.')
  }
  if (!existente || existente.revocado_en) {
    const activos = await listarDispositivos(env, usuarioId)
    const limite = await ajusteNum(env, 'limite_dispositivos', 3)
    if (activos.length >= limite) {
      throw falla(409, 'limite_dispositivos', `Ya tienes ${limite} dispositivos. Quita uno para usar este.`, {
        dispositivos: activos,
        limite,
      })
    }
  }
  const t = ahora()
  const stmts = [
    env.DB.prepare(
      `INSERT INTO dispositivos (id, usuario_id, nombre, plataforma, creado_en, ultimo_uso)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (id) DO UPDATE SET nombre = ?3, plataforma = ?4, ultimo_uso = ?5, revocado_en = NULL`,
    ).bind(d.id, usuarioId, d.nombre ?? 'Dispositivo', d.plataforma ?? 'web', t),
  ]
  if (sesionHash) {
    stmts.push(env.DB.prepare('UPDATE sesiones SET dispositivo_id = ? WHERE token_hash = ?').bind(d.id, sesionHash))
  }
  await env.DB.batch(stmts)
}

export async function revocarDispositivo(env: Env, usuarioId: string, id: string) {
  const t = ahora()
  const r = await env.DB.batch([
    env.DB.prepare('UPDATE dispositivos SET revocado_en = ? WHERE id = ? AND usuario_id = ? AND revocado_en IS NULL').bind(
      t,
      id,
      usuarioId,
    ),
    env.DB.prepare('DELETE FROM sesiones WHERE dispositivo_id = ? AND usuario_id = ?').bind(id, usuarioId),
    env.DB.prepare(
      'UPDATE licencias_sin_conexion SET revocada_en = ? WHERE dispositivo_id = ? AND usuario_id = ? AND revocada_en IS NULL',
    ).bind(t, id, usuarioId),
  ])
  if (!r[0].meta.changes) throw falla(404, 'no_existe', 'Ese dispositivo no existe.')
}
