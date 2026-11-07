import { ErrorApi, type FuenteLector, type InfoObra } from './fuente'
import type { FuenteSinConexion, RespuestaLicencia } from '../sinconexion/sin-conexion'
import { idDispositivo, esApp, nombreDispositivo, plataforma } from './dispositivo'
import { leerLocal, guardarLocal } from './local'
import { ubicacionSubrayado, leerUbicacionSubrayado } from './fuente'
import type { Dispositivo, Formato, Marcador, Obra, Pagina, Progreso, Subrayado, TipoAcceso, Usuario } from './tipos'

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

// En la web la sesión va en la cookie HttpOnly; en la app, como Bearer guardado en el almacenamiento de la app.
function cabeceras(extra: Record<string, string> = {}) {
  const token = esApp() ? leerLocal<string | null>('sesion_token', null) : null
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function api<T>(ruta: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...resto } = init
  const r = await fetch(`${BASE}/api${ruta}`, {
    ...resto,
    credentials: 'include',
    headers: cabeceras(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: json !== undefined ? JSON.stringify(json) : resto.body,
  })
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}))
    const e = cuerpo?.error ?? {}
    throw new ErrorApi(r.status, e.codigo ?? 'error', e.mensaje ?? 'No se pudo completar la solicitud.', cuerpo)
  }
  if (r.status === 204) return undefined as T
  const tipo = r.headers.get('Content-Type') ?? ''
  return (tipo.includes('json') ? r.json() : r.blob()) as Promise<T>
}

interface LibroApi {
  id: string; titulo: string; autor: string; portada_url: string | null
  digital: { formato: Formato; paginas_muestra: number } | null
}

export const fuenteApi: FuenteLector = {
  async yo() {
    try {
      const u = await api<Usuario>('/yo')
      return { correo: u.correo }
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) return null
      throw e
    }
  },
  async pedirEnlace(correo) {
    await api('/auth/enlace', { method: 'POST', json: { correo, destino: location.hash || '#/' } })
  },
  async verificar(token) {
    try {
      const r = await api<{ sesion: { token: string }; destino?: string }>('/auth/verificar', {
        method: 'POST', json: { token, dispositivo: { id: idDispositivo(), nombre: nombreDispositivo(), plataforma: plataforma() } },
      })
      if (esApp()) guardarLocal('sesion_token', r.sesion.token)
      return r.destino
    } catch (e) {
      // Con el límite de dispositivos lleno, la sesión se crea igual (sin dispositivo); la app lo resuelve después.
      if (e instanceof ErrorApi && e.codigo === 'limite_dispositivos') {
        const token = (e.datos as { sesion?: { token: string } }).sesion?.token
        if (esApp() && token) guardarLocal('sesion_token', token)
        return (e.datos as { destino?: string }).destino
      }
      throw e
    }
  },
  async salir() {
    await api('/auth/salir', { method: 'POST' }).catch(() => {})
    guardarLocal('sesion_token', null)
  },
  async registrarDispositivo() {
    await api('/dispositivos', { method: 'POST', json: { id: idDispositivo(), nombre: nombreDispositivo(), plataforma: plataforma() } })
  },
  dispositivos: () => api<(Dispositivo & { actual: boolean })[]>('/dispositivos'),
  async quitarDispositivo(id) {
    await api(`/dispositivos/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async biblioteca() {
    const filas = await api<{ libro: LibroApi; acceso: { tipo: TipoAcceso; vence_en: string | null }; progreso: { porcentaje: number } | null }[]>('/biblioteca')
    return filas.map((f) => ({
      ...aObra(f.libro, f.acceso.tipo, f.acceso.vence_en),
      progreso: f.progreso?.porcentaje ?? 0,
    }))
  },
  async obra(id) {
    const r = await api<InfoObra['manifiesto'] & { acceso: InfoObra['acceso']; paginas_permitidas: number }>(`/obras/${id}/manifiesto`)
    const { acceso, paginas_permitidas, ...manifiesto } = r
    return { manifiesto, acceso, paginas_permitidas }
  },
  async pagina(id, n): Promise<Pagina> {
    const b = await api<Blob>(`/obras/${id}/paginas/${n}`, { cache: 'no-store' })
    if (b.type.startsWith('text/html')) return { tipo: 'html', html: await b.text() }
    return { tipo: 'imagen', imagen: b }
  },

  async leerProgreso(id) {
    const p = await api<{ ubicacion: string; porcentaje: number } | null>(`/obras/${id}/progreso`)
    return p ? { pagina: Number(p.ubicacion) || 1, porcentaje: p.porcentaje } : null
  },
  async guardarProgreso(id, p: Progreso) {
    await api(`/obras/${id}/progreso`, { method: 'PUT', json: { ubicacion: String(p.pagina), porcentaje: p.porcentaje } })
  },
  async marcadores(id) {
    const l = await api<{ id: string; ubicacion: string; etiqueta: string | null; creado_en: string }[]>(`/obras/${id}/marcadores`)
    return l.map((m): Marcador => ({ id: m.id, pagina: Number(m.ubicacion) || 1, etiqueta: m.etiqueta ?? '', creado_en: m.creado_en }))
  },
  async agregarMarcador(id, m) {
    await api(`/obras/${id}/marcadores`, { method: 'POST', json: { id: m.id, ubicacion: String(m.pagina), etiqueta: m.etiqueta } })
  },
  async quitarMarcador(id, mid) {
    await api(`/obras/${id}/marcadores/${mid}`, { method: 'DELETE' })
  },
  async subrayados(id) {
    const l = await api<{ id: string; ubicacion: string; texto: string; nota: string | null; creado_en: string }[]>(`/obras/${id}/subrayados`)
    return l.flatMap((s): Subrayado[] => {
      const u = leerUbicacionSubrayado(s.ubicacion)
      return u ? [{ id: s.id, ...u, texto: s.texto, nota: s.nota ?? '', creado_en: s.creado_en }] : []
    })
  },
  async agregarSubrayado(id, s) {
    await api(`/obras/${id}/subrayados`, { method: 'POST', json: { id: s.id, ubicacion: ubicacionSubrayado(s), texto: s.texto, nota: s.nota } })
  },
  async guardarNota(id, sid, nota) {
    await api(`/obras/${id}/subrayados/${sid}`, { method: 'PATCH', json: { nota } })
  },
  async quitarSubrayado(id, sid) {
    await api(`/obras/${id}/subrayados/${sid}`, { method: 'DELETE' })
  },
}

function aObra(l: LibroApi, acceso: TipoAcceso, vence_en: string | null): Obra {
  return {
    id: l.id, titulo: l.titulo, autor: l.autor, formato: l.digital?.formato ?? 'pdf', portada_url: l.portada_url,
    color: null, acceso, vence_en, paginas_muestra: l.digital?.paginas_muestra ?? null,
  }
}

export const sinConexionApi: FuenteSinConexion = {
  licencia: (id, idDispositivo, clavePublica) =>
    api<RespuestaLicencia>(`/obras/${id}/licencia-offline`, { method: 'POST', json: { id_dispositivo: idDispositivo, clave_publica: clavePublica } }),
  async paquete(id, n) {
    const b = await api<Blob>(`/obras/${id}/paquete/${n}`, { cache: 'no-store' })
    return b.arrayBuffer()
  },
  async liberar(id) {
    await api(`/obras/${id}/licencia-offline`, { method: 'DELETE' })
  },
}
