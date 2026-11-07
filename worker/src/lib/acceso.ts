import type { Env, Usuario } from '../env'
import { ahora } from './util'

export type TipoAcceso = 'compra' | 'alquiler' | 'canje' | 'cortesia' | 'suscripcion' | 'equipo'

export interface Acceso {
  tipo: TipoAcceso
  vence_en: string | null
}

/** Suscripción vigente (individual o por iglesia) que cubre a este usuario, la que vence más tarde. */
export async function suscripcionVigente(env: Env, u: Pick<Usuario, 'id' | 'correo'>) {
  return env.DB.prepare(
    `SELECT s.id, s.plan_id, s.vence_en, s.iglesia_id FROM suscripciones s
      WHERE s.estado = 'activa' AND s.inicia_en <= ?1 AND s.vence_en > ?1
        AND (s.usuario_id = ?2 OR s.iglesia_id IN (SELECT iglesia_id FROM iglesia_miembros WHERE correo = ?3)
             OR s.iglesia_id IN (SELECT id FROM iglesias WHERE titular_id = ?2))
      ORDER BY s.vence_en DESC LIMIT 1`,
  )
    .bind(ahora(), u.id, u.correo)
    .first<{ id: string; plan_id: string; vence_en: string; iglesia_id: string | null }>()
}

/** ¿Puede este usuario leer completo este libro? Devuelve el mejor acceso o null. */
export async function accesoALibro(env: Env, u: Usuario, libroId: string): Promise<Acceso | null> {
  if (u.rol === 'editor' || u.rol === 'admin') return { tipo: 'equipo', vence_en: null }
  const t = ahora()
  const fila = await env.DB.prepare(
    `SELECT tipo, vence_en FROM accesos
      WHERE usuario_id = ? AND libro_id = ? AND revocado_en IS NULL AND (vence_en IS NULL OR vence_en > ?)
      ORDER BY vence_en IS NULL DESC, vence_en DESC LIMIT 1`,
  )
    .bind(u.id, libroId, t)
    .first<Acceso>()
  if (fila?.vence_en === null) return fila
  const libro = await env.DB.prepare('SELECT en_suscripcion FROM libros WHERE id = ? AND digital_activo = 1')
    .bind(libroId)
    .first<{ en_suscripcion: number }>()
  if (libro?.en_suscripcion) {
    const s = await suscripcionVigente(env, u)
    if (s && (!fila || s.vence_en > (fila.vence_en ?? ''))) return { tipo: 'suscripcion', vence_en: s.vence_en }
  }
  return fila ?? null
}

/** Biblioteca: libros con acceso propio + (si hay suscripción) los del catálogo en suscripción. */
export async function biblioteca(env: Env, u: Usuario) {
  const t = ahora()
  const { results: propios } = await env.DB.prepare(
    `SELECT a.libro_id, a.tipo, a.vence_en, a.creado_en FROM accesos a
      JOIN libros l ON l.id = a.libro_id
      WHERE a.usuario_id = ? AND a.revocado_en IS NULL AND (a.vence_en IS NULL OR a.vence_en > ?)
      ORDER BY a.creado_en DESC`,
  )
    .bind(u.id, t)
    .all<{ libro_id: string; tipo: TipoAcceso; vence_en: string | null }>()
  const mapa = new Map<string, Acceso>()
  for (const p of propios) {
    const prev = mapa.get(p.libro_id)
    if (!prev || (prev.vence_en !== null && (p.vence_en === null || p.vence_en > prev.vence_en))) {
      mapa.set(p.libro_id, { tipo: p.tipo, vence_en: p.vence_en })
    }
  }
  const s = await suscripcionVigente(env, u)
  if (s) {
    const { results } = await env.DB.prepare(
      'SELECT id FROM libros WHERE publicado = 1 AND digital_activo = 1 AND en_suscripcion = 1',
    ).all<{ id: string }>()
    for (const r of results) {
      const prev = mapa.get(r.id)
      if (!prev || (prev.vence_en !== null && prev.vence_en < s.vence_en)) {
        mapa.set(r.id, { tipo: 'suscripcion', vence_en: s.vence_en })
      }
    }
  }
  return mapa
}
