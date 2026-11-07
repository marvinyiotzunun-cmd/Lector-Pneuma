// Llamadas a la API del backend (mismo dominio, bajo /api). PUBLIC_API_URL permite apuntar a otro origen en desarrollo.
const BASE = (import.meta.env.PUBLIC_API_URL ?? '').replace(/\/$/, '')

export class ErrorApi extends Error {
  constructor(public codigo: string, mensaje: string, public estado: number, public datos?: unknown) { super(mensaje) }
}

export async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(`${BASE}/api${ruta}`, {
      credentials: 'include',
      ...opciones,
      headers: { accept: 'application/json', ...(opciones.body && typeof opciones.body === 'string' ? { 'content-type': 'application/json' } : {}), ...opciones.headers },
    })
  } catch {
    throw new ErrorApi('sin_conexion', 'No hay conexión con el servidor.', 0)
  }
  const tipo = r.headers.get('content-type') ?? ''
  if (!tipo.includes('application/json')) throw new ErrorApi('sin_api', 'El servidor de pedidos todavía no está disponible.', r.status)
  const datos = await r.json()
  if (!r.ok) throw new ErrorApi(datos?.error?.codigo ?? 'error', datos?.error?.mensaje ?? 'Algo salió mal. Intente de nuevo.', r.status, datos)
  return datos as T
}

// La API todavía no existe en este dominio (vista previa estática): se ofrece WhatsApp.
export const sinApi = (e: unknown) => e instanceof ErrorApi && (e.codigo === 'sin_api' || e.codigo === 'sin_conexion' || e.estado === 404 && e.codigo === 'error')
