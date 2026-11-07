import type { Dispositivo, Manifiesto, Marcador, Obra, Pagina, Progreso, Subrayado, TipoAcceso, Usuario } from './tipos'

// Lo que el lector necesita del backend. Hay dos implementaciones: la API de Cloudflare (docs/api.md) y una demostración local.
export interface InfoObra {
  manifiesto: Manifiesto
  paginas_permitidas: number
  acceso: { tipo: TipoAcceso; vence_en: string | null } | null
}

export interface FuenteLector {
  yo(): Promise<Usuario | null>
  pedirEnlace(correo: string): Promise<void>
  verificar(token: string): Promise<void>
  salir(): Promise<void>
  registrarDispositivo(): Promise<void> // lanza ErrorApi 409 limite_dispositivos con datos.dispositivos
  dispositivos(): Promise<(Dispositivo & { actual: boolean })[]>
  quitarDispositivo(id: string): Promise<void>

  biblioteca(): Promise<(Obra & { progreso: number })[]>
  obra(id: string): Promise<InfoObra>
  pagina(id: string, n: number): Promise<Pagina>

  leerProgreso(id: string): Promise<Progreso | null>
  guardarProgreso(id: string, p: Progreso): Promise<void>
  marcadores(id: string): Promise<Marcador[]>
  agregarMarcador(id: string, m: Marcador): Promise<void>
  quitarMarcador(id: string, mid: string): Promise<void>
  subrayados(id: string): Promise<Subrayado[]>
  agregarSubrayado(id: string, s: Subrayado): Promise<void>
  guardarNota(id: string, sid: string, nota: string): Promise<void>
  quitarSubrayado(id: string, sid: string): Promise<void>
}

export class ErrorApi extends Error {
  status: number
  codigo: string
  datos: Record<string, unknown>
  constructor(status: number, codigo: string, mensaje: string, datos: Record<string, unknown> = {}) {
    super(mensaje)
    this.status = status
    this.codigo = codigo
    this.datos = datos
  }
}

// Ubicación de un subrayado en texto: "pagina:bloque:inicio-fin".
export function ubicacionSubrayado(s: Pick<Subrayado, 'pagina' | 'bloque' | 'inicio' | 'fin'>) {
  return `${s.pagina}:${s.bloque}:${s.inicio}-${s.fin}`
}

export function leerUbicacionSubrayado(u: string) {
  const m = /^(\d+):(\d+):(\d+)-(\d+)$/.exec(u)
  return m ? { pagina: +m[1], bloque: +m[2], inicio: +m[3], fin: +m[4] } : null
}
