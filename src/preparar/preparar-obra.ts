import JSZip from 'jszip'
import * as pdfjs from 'pdfjs-dist'
import urlTrabajador from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { EntradaIndice, Manifiesto } from '../lib/tipos'
import { sanearNodo } from './sanear'

pdfjs.GlobalWorkerOptions.workerSrc = urlTrabajador

/**
 * Convierte un EPUB o PDF en las páginas que sirve el lector protegido. Corre en el navegador del panel editorial.
 * Las rutas de `archivos` son relativas a la carpeta de la obra en R2 (obras/<id>/).
 *   manifiesto.json   descripción de la obra (tipo Manifiesto)
 *   portada.webp      primera imagen del EPUB o primera página del PDF
 *   p/0001.html       páginas de EPUB (HTML saneado)
 *   p/0001.webp       páginas de PDF (imagen)
 */
export interface ArchivoObra {
  ruta: string
  tipo: string
  datos: Blob
}

export interface ObraPreparada {
  manifiesto: Manifiesto
  archivos: ArchivoObra[]
}

export interface OpcionesPreparar {
  alProgresar?: (hechas: number, total: number) => void
  anchoPdf?: number // píxeles de ancho de cada página de PDF (1400 por defecto)
  caracteresPorPagina?: number // tamaño de cada página de EPUB (1500 por defecto)
}

export async function prepararObra(archivo: Blob & { name?: string }, opciones: OpcionesPreparar = {}): Promise<ObraPreparada> {
  const cabecera = new Uint8Array(await archivo.slice(0, 5).arrayBuffer())
  const esPdf = String.fromCharCode(...cabecera) === '%PDF-'
  const esZip = cabecera[0] === 0x50 && cabecera[1] === 0x4b
  if (esPdf) return prepararPdf(archivo, opciones)
  if (esZip) return prepararEpub(archivo, opciones)
  throw new Error('El archivo no es un EPUB ni un PDF.')
}

export const nombrePagina = (n: number, ext: string) => `p/${String(n).padStart(4, '0')}.${ext}`

function json(datos: unknown): Blob {
  return new Blob([JSON.stringify(datos)], { type: 'application/json' })
}

function lienzoABlob(c: HTMLCanvasElement | OffscreenCanvas, calidad = 0.82): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/webp', quality: calidad })
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo crear la imagen'))), 'image/webp', calidad))
}

function lienzo(ancho: number, alto: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = ancho
  c.height = alto
  return c
}

/* ---------------- PDF ---------------- */

async function prepararPdf(archivo: Blob, op: OpcionesPreparar): Promise<ObraPreparada> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise
  const ancho = op.anchoPdf ?? 1400
  const archivos: ArchivoObra[] = []
  let ancho0 = ancho
  let alto0 = Math.round(ancho * 1.414)

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n)
    const base = pagina.getViewport({ scale: 1 })
    const vp = pagina.getViewport({ scale: ancho / base.width })
    if (n === 1) { ancho0 = Math.round(vp.width); alto0 = Math.round(vp.height) }
    const c = lienzo(Math.round(vp.width), Math.round(vp.height))
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, c.width, c.height)
    await pagina.render({ canvasContext: ctx, viewport: vp }).promise
    const webp = await lienzoABlob(c)
    archivos.push({ ruta: nombrePagina(n, 'webp'), tipo: 'image/webp', datos: webp })
    if (n === 1) archivos.push({ ruta: 'portada.webp', tipo: 'image/webp', datos: await reducir(c, 600) })
    pagina.cleanup()
    op.alProgresar?.(n, doc.numPages)
  }

  const indice: EntradaIndice[] = []
  const recorrer = async (items: Awaited<ReturnType<typeof doc.getOutline>>, nivel: number) => {
    for (const it of items ?? []) {
      try {
        const destino = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
        if (destino) indice.push({ etiqueta: it.title, pagina: (await doc.getPageIndex(destino[0])) + 1, nivel })
      } catch { /* destino roto */ }
      await recorrer(it.items, nivel + 1)
    }
  }
  await recorrer(await doc.getOutline(), 0)

  const meta = (await doc.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined
  const manifiesto: Manifiesto = {
    formato: 'pdf', tipo_pagina: 'webp', total_paginas: doc.numPages, ancho: ancho0, alto: alto0, indice,
    titulo: meta?.Title ?? '', autor: meta?.Author ?? '',
  }
  await doc.destroy()
  archivos.push({ ruta: 'manifiesto.json', tipo: 'application/json', datos: json(manifiesto) })
  return { manifiesto, archivos }
}

async function reducir(origen: CanvasImageSource & { width: number; height: number }, anchoMax: number): Promise<Blob> {
  const escala = Math.min(1, anchoMax / origen.width)
  const c = lienzo(Math.round(origen.width * escala), Math.round(origen.height * escala))
  c.getContext('2d')!.drawImage(origen, 0, 0, c.width, c.height)
  return lienzoABlob(c, 0.8)
}

/* ---------------- EPUB ---------------- */

const BLOQUES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'figure', 'img', 'table', 'pre', 'hr', 'dl'])

function resolver(base: string, relativa: string): string {
  const partes = base.split('/').slice(0, -1)
  for (const p of decodeURIComponent(relativa.split('#')[0]).split('/')) {
    if (p === '..') partes.pop()
    else if (p && p !== '.') partes.push(p)
  }
  return partes.join('/')
}

async function prepararEpub(archivo: Blob, op: OpcionesPreparar): Promise<ObraPreparada> {
  const zip = await JSZip.loadAsync(archivo)
  const leer = async (ruta: string) => {
    const f = zip.file(ruta)
    if (!f) throw new Error(`Falta ${ruta} dentro del EPUB`)
    return f.async('string')
  }
  const xml = (t: string, tipo: DOMParserSupportedType = 'application/xml') => new DOMParser().parseFromString(t, tipo)

  const contenedor = xml(await leer('META-INF/container.xml'))
  const rutaOpf = contenedor.querySelector('rootfile')?.getAttribute('full-path')
  if (!rutaOpf) throw new Error('El EPUB no indica su archivo de contenido')
  const opf = xml(await leer(rutaOpf))

  const manifest = new Map<string, { href: string; tipo: string; props: string }>()
  opf.querySelectorAll('manifest > item').forEach((i) =>
    manifest.set(i.getAttribute('id')!, {
      href: resolver(rutaOpf, i.getAttribute('href')!), tipo: i.getAttribute('media-type') ?? '', props: i.getAttribute('properties') ?? '',
    }))
  const spine = Array.from(opf.querySelectorAll('spine > itemref')).map((r) => manifest.get(r.getAttribute('idref')!)!).filter(Boolean)
  const titulo = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() ?? ''
  const autor = opf.getElementsByTagNameNS('*', 'creator')[0]?.textContent?.trim() ?? ''

  // Títulos del índice (nav de EPUB 3 o toc.ncx de EPUB 2), por archivo.
  const titulosPorArchivo = new Map<string, { etiqueta: string; nivel: number }[]>()
  const agregarTitulo = (href: string, etiqueta: string, nivel: number) => {
    const lista = titulosPorArchivo.get(href) ?? []
    lista.push({ etiqueta: etiqueta.trim(), nivel })
    titulosPorArchivo.set(href, lista)
  }
  const nav = Array.from(manifest.values()).find((m) => m.props.split(' ').includes('nav'))
  const ncx = Array.from(manifest.values()).find((m) => m.tipo === 'application/x-dtbncx+xml')
  if (nav) {
    const docNav = xml(await leer(nav.href), 'application/xhtml+xml')
    const toc = Array.from(docNav.getElementsByTagName('nav')).find((n) => n.getAttribute('epub:type') === 'toc' || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') === 'toc') ?? docNav.getElementsByTagName('nav')[0]
    toc?.querySelectorAll('a[href]').forEach((a) => {
      let nivel = 0
      for (let p = a.parentElement; p && p !== toc; p = p.parentElement) if (p.localName === 'ol') nivel++
      agregarTitulo(resolver(nav.href, a.getAttribute('href')!), a.textContent ?? '', Math.max(0, nivel - 1))
    })
  } else if (ncx) {
    const docNcx = xml(await leer(ncx.href))
    docNcx.querySelectorAll('navPoint').forEach((np) => {
      let nivel = 0
      for (let p = np.parentElement; p && p.localName === 'navPoint'; p = p.parentElement) nivel++
      const src = np.querySelector('content')?.getAttribute('src')
      if (src) agregarTitulo(resolver(ncx.href, src), np.querySelector('navLabel text')?.textContent ?? '', nivel)
    })
  }

  const presupuesto = op.caracteresPorPagina ?? 1500
  const salida = document.implementation.createHTMLDocument('')
  const paginas: string[] = []
  const indice: EntradaIndice[] = []
  let portada: Blob | null = null
  let actual: string[] = []
  let largo = 0
  const cerrar = () => {
    if (actual.length) paginas.push(actual.join(''))
    actual = []
    largo = 0
  }

  for (let i = 0; i < spine.length; i++) {
    const item = spine[i]
    if (!/x?html/.test(item.tipo)) continue
    const doc = xml(await leer(item.href), 'application/xhtml+xml')
    const cuerpo = doc.getElementsByTagName('body')[0]
    if (!cuerpo) continue

    // Imágenes: se incrustan como data: reducidas, para que la página no dependa de otros archivos.
    for (const img of Array.from(cuerpo.getElementsByTagName('img'))) {
      const ruta = resolver(item.href, img.getAttribute('src') ?? '')
      const datos = await zip.file(ruta)?.async('blob')
      if (!datos) { img.remove(); continue }
      try {
        const bmp = await createImageBitmap(datos)
        const webp = await reducir(bmp, 1000)
        if (!portada) portada = await reducir(bmp, 600)
        img.setAttribute('src', await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsDataURL(webp) }))
      } catch { img.remove() }
    }

    // Cada capítulo empieza en página nueva.
    cerrar()
    for (const t of titulosPorArchivo.get(item.href) ?? []) indice.push({ etiqueta: t.etiqueta, pagina: paginas.length + 1, nivel: t.nivel })

    for (const bloque of aplanar(cuerpo)) {
      const limpio = sanearNodo(bloque, salida)
      if (!limpio) continue
      const envoltura = salida.createElement('div')
      envoltura.appendChild(limpio)
      const html = envoltura.innerHTML.trim()
      const texto = envoltura.textContent?.trim() ?? ''
      if (!html || (!texto && !envoltura.querySelector('img,hr'))) continue
      const peso = texto.length + (envoltura.querySelector('img') ? presupuesto / 2 : 0)
      if (largo > 0 && largo + peso > presupuesto) cerrar()
      actual.push(html)
      largo += peso
    }
    op.alProgresar?.(i + 1, spine.length)
  }
  cerrar()
  if (!paginas.length) throw new Error('El EPUB no tiene texto legible')

  const archivos: ArchivoObra[] = paginas.map((html, k) => ({
    ruta: nombrePagina(k + 1, 'html'), tipo: 'text/html; charset=utf-8', datos: new Blob([html], { type: 'text/html' }),
  }))
  if (portada) archivos.push({ ruta: 'portada.webp', tipo: 'image/webp', datos: portada })
  const manifiesto: Manifiesto = { formato: 'epub', tipo_pagina: 'html', total_paginas: paginas.length, indice, titulo, autor }
  archivos.push({ ruta: 'manifiesto.json', tipo: 'application/json', datos: json(manifiesto) })
  return { manifiesto, archivos }
}

// Baja por los contenedores (div, section) hasta encontrar bloques de texto; el texto suelto se vuelve párrafo.
function aplanar(raiz: Element): Node[] {
  const salida: Node[] = []
  for (const hijo of Array.from(raiz.childNodes)) {
    if (hijo.nodeType === Node.TEXT_NODE) {
      if (hijo.textContent?.trim()) {
        const p = raiz.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'p')
        p.textContent = hijo.textContent
        salida.push(p)
      }
    } else if (hijo.nodeType === Node.ELEMENT_NODE) {
      const el = hijo as Element
      if (BLOQUES.has(el.localName.toLowerCase())) salida.push(el)
      else salida.push(...aplanar(el))
    }
  }
  return salida
}
