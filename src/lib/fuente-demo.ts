import { ErrorApi, type FuenteLector, type InfoObra } from './fuente'
import { leerLocal, guardarLocal } from './local'
import { idDispositivo, nombreDispositivo, plataforma } from './dispositivo'
import { prepararObra, type ObraPreparada } from '../preparar/preparar-obra'
import type { Dispositivo, Obra, Pagina } from './tipos'

// Demostración sin backend: prepara los libros de muestra en el navegador con el mismo conversor del panel
// y simula lo que hace el Worker (marca de agua, muestras, límite de dispositivos). Todo queda en este navegador.
const CORREO = 'lector@ejemplo.com'
const LIMITE_DISPOSITIVOS = 3

const OBRAS: (Obra & { archivo: string })[] = [
  {
    id: 'demo-salmos', titulo: 'Salmos escogidos', autor: 'Reina-Valera 1909', formato: 'epub', archivo: 'salmos-escogidos.epub',
    portada_url: null, color: '#04044A', acceso: 'compra', vence_en: null, paginas_muestra: null,
  },
  {
    id: 'demo-juan', titulo: 'El Verbo hecho carne', autor: 'Juan 1 · Reina-Valera 1909', formato: 'pdf', archivo: 'el-verbo-hecho-carne.pdf',
    portada_url: null, color: '#CD0100', acceso: 'muestra', vence_en: null, paginas_muestra: 2,
  },
]

const preparadas = new Map<string, Promise<ObraPreparada>>()
function preparada(id: string) {
  const o = OBRAS.find((x) => x.id === id)
  if (!o) throw new ErrorApi(404, 'no_encontrado', 'Este libro no existe.')
  if (!preparadas.has(id)) {
    preparadas.set(id, fetch(`${import.meta.env.BASE_URL}demo/${o.archivo}`).then((r) => r.blob()).then((b) => prepararObra(b)))
  }
  return preparadas.get(id)!
}

function huella(id: string, n: number) {
  return `${id}-${n}-${idDispositivo().slice(0, 8)}`
}

// Igual que el Worker: el WebP va dentro de un SVG con la marca de agua dibujada encima.
async function envolverImagen(webp: Blob, ancho: number, alto: number, marca: string): Promise<Blob> {
  const datos = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsDataURL(webp) })
  const filas = Array.from({ length: 6 }, (_, i) =>
    `<text x="${ancho / 2}" y="${(alto / 6) * (i + 0.5)}" text-anchor="middle" transform="rotate(-30 ${ancho / 2} ${(alto / 6) * (i + 0.5)})">${marca}</text>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}"><image href="${datos}" width="${ancho}" height="${alto}"/><g fill="#04044A" fill-opacity="0.07" font-family="sans-serif" font-size="${Math.round(ancho / 28)}">${filas}</g></svg>`
  return new Blob([svg], { type: 'image/svg+xml' })
}

const clave = (k: string, id: string) => `demo:${k}:${id}`

export const fuenteDemo: FuenteLector = {
  async yo() { return { correo: CORREO } },
  async pedirEnlace() {},
  async verificar() {},
  async salir() {},
  async registrarDispositivo() {
    const lista = leerLocal<Dispositivo[]>('demo:dispositivos', [
      { id: 'demo-celular', nombre: 'Chrome en Android', plataforma: 'web', ultimo_uso: '2026-11-01T10:00:00Z' },
      { id: 'demo-tableta', nombre: 'App Pneuma en Android', plataforma: 'android', ultimo_uso: '2026-11-03T18:30:00Z' },
    ])
    if (lista.some((d) => d.id === idDispositivo())) return
    if (lista.length >= LIMITE_DISPOSITIVOS) {
      throw new ErrorApi(409, 'limite_dispositivos', 'Ya usas tu cuenta en el máximo de dispositivos.', { dispositivos: lista })
    }
    guardarLocal('demo:dispositivos', [...lista, { id: idDispositivo(), nombre: nombreDispositivo(), plataforma: plataforma(), ultimo_uso: new Date().toISOString() }])
  },
  async dispositivos() {
    return leerLocal<Dispositivo[]>('demo:dispositivos', []).map((d) => ({ ...d, actual: d.id === idDispositivo() }))
  },
  async quitarDispositivo(id) {
    guardarLocal('demo:dispositivos', leerLocal<Dispositivo[]>('demo:dispositivos', []).filter((d) => d.id !== id))
  },

  async biblioteca() {
    return OBRAS.map((o) => ({ ...o, archivo: undefined, progreso: leerLocal<{ porcentaje: number } | null>(clave('progreso', o.id), null)?.porcentaje ?? 0 }))
  },
  async obra(id): Promise<InfoObra> {
    const o = OBRAS.find((x) => x.id === id)!
    const { manifiesto } = await preparada(id)
    const completo = o.acceso !== 'muestra'
    return {
      manifiesto: { ...manifiesto, titulo: o.titulo, autor: o.autor },
      acceso: completo ? { tipo: o.acceso, vence_en: o.vence_en } : null,
      paginas_permitidas: completo ? manifiesto.total_paginas : o.paginas_muestra ?? 0,
    }
  },
  async pagina(id, n): Promise<Pagina> {
    const info = await fuenteDemo.obra(id)
    if (n > info.paginas_permitidas) throw new ErrorApi(403, 'fuera_de_muestra', 'Esta página no está incluida en la muestra.')
    const { archivos, manifiesto } = await preparada(id)
    const ruta = `p/${String(n).padStart(4, '0')}.${manifiesto.tipo_pagina}`
    const archivo = archivos.find((a) => a.ruta === ruta)
    if (!archivo) throw new ErrorApi(404, 'no_encontrado', 'Página no encontrada.')
    const marca = `${CORREO} · ${huella(id, n)}`
    if (manifiesto.tipo_pagina === 'html') {
      return { tipo: 'html', html: `${await archivo.datos.text()}<p class="marca-servidor" data-huella="${huella(id, n)}">${marca}</p>` }
    }
    return { tipo: 'imagen', imagen: await envolverImagen(archivo.datos, manifiesto.ancho ?? 1400, manifiesto.alto ?? 1980, marca) }
  },

  async leerProgreso(id) { return leerLocal(clave('progreso', id), null) },
  async guardarProgreso(id, p) { guardarLocal(clave('progreso', id), p) },
  async marcadores(id) { return leerLocal(clave('marcadores', id), []) },
  async agregarMarcador(id, m) { guardarLocal(clave('marcadores', id), [...leerLocal(clave('marcadores', id), []), m]) },
  async quitarMarcador(id, mid) {
    guardarLocal(clave('marcadores', id), leerLocal<{ id: string }[]>(clave('marcadores', id), []).filter((m) => m.id !== mid))
  },
  async subrayados(id) { return leerLocal(clave('subrayados', id), []) },
  async agregarSubrayado(id, s) { guardarLocal(clave('subrayados', id), [...leerLocal(clave('subrayados', id), []), s]) },
  async guardarNota(id, sid, nota) {
    guardarLocal(clave('subrayados', id), leerLocal<{ id: string }[]>(clave('subrayados', id), []).map((s) => (s.id === sid ? { ...s, nota } : s)))
  },
  async quitarSubrayado(id, sid) {
    guardarLocal(clave('subrayados', id), leerLocal<{ id: string }[]>(clave('subrayados', id), []).filter((s) => s.id !== sid))
  },
}
