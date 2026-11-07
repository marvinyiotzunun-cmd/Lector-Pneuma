import { useEffect, useLayoutEffect, useRef } from 'react'
import { sanearNodo } from '../preparar/sanear'
import type { Pagina, Subrayado } from '../lib/tipos'

export interface SeleccionTexto {
  bloque: number
  inicio: number
  fin: number
  texto: string
  x: number
  y: number
}

interface Props {
  pagina: Pagina
  subrayados: Subrayado[]
  onSeleccion: (s: SeleccionTexto | null) => void
  onAbrirSubrayado: (id: string) => void
}

// Una página: HTML (EPUB) o imagen (PDF). El HTML se vuelve a sanear aquí aunque venga del servidor.
export default function VistaPagina({ pagina, subrayados, onSeleccion, onAbrirSubrayado }: Props) {
  if (pagina.tipo === 'imagen') return <PaginaImagen imagen={pagina.imagen} />
  return <PaginaTexto html={pagina.html} subrayados={subrayados} onSeleccion={onSeleccion} onAbrirSubrayado={onAbrirSubrayado} />
}

function PaginaImagen({ imagen }: { imagen: Blob }) {
  const lienzo = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    // Se dibuja en un lienzo, no en <img>, para que no quede una imagen que se pueda guardar con un clic.
    const url = URL.createObjectURL(imagen)
    const img = new Image()
    let vivo = true
    img.onload = () => {
      if (!vivo || !lienzo.current) return
      const c = lienzo.current
      c.width = img.naturalWidth || 1400
      c.height = img.naturalHeight || 1980
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
    }
    img.src = url
    return () => { vivo = false; URL.revokeObjectURL(url) }
  }, [imagen])
  return <canvas ref={lienzo} className="pagina-imagen" aria-label="Página del libro" />
}

function PaginaTexto({ html, subrayados, onSeleccion, onAbrirSubrayado }: { html: string; subrayados: Subrayado[] } & Omit<Props, 'pagina' | 'subrayados'>) {
  const caja = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = caja.current
    if (!el) return
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const destino = document.implementation.createHTMLDocument('')
    el.replaceChildren()
    let n = 0
    for (const nodo of Array.from(doc.body.childNodes)) {
      const limpio = sanearNodo(nodo, destino)
      if (!limpio) continue
      if (limpio.nodeType === Node.TEXT_NODE && !limpio.textContent?.trim()) continue
      const bloque = limpio.nodeType === Node.ELEMENT_NODE ? (limpio as Element) : envolver(limpio, destino)
      if ((nodo as Element).classList?.contains('marca-servidor')) bloque.classList.add('marca-servidor')
      else bloque.setAttribute('data-bloque', String(n++))
      el.appendChild(document.importNode(bloque, true))
    }
    for (const s of subrayados) pintar(el, s, onAbrirSubrayado)
  }, [html, subrayados, onAbrirSubrayado])

  useEffect(() => {
    const el = caja.current!
    const alSoltar = () => {
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) return onSeleccion(null)
        const r = sel.getRangeAt(0)
        const ini = elementoDe(r.startContainer)?.closest('[data-bloque]')
        const fin = elementoDe(r.endContainer)?.closest('[data-bloque]')
        // Solo dentro de un mismo párrafo.
        if (!ini || ini !== fin || !el.contains(ini)) return onSeleccion(null)
        const antes = document.createRange()
        antes.setStart(ini, 0)
        antes.setEnd(r.startContainer, r.startOffset)
        const inicio = antes.toString().length
        const texto = r.toString()
        if (!texto.trim()) return onSeleccion(null)
        const rect = r.getBoundingClientRect()
        onSeleccion({ bloque: Number(ini.getAttribute('data-bloque')), inicio, fin: inicio + texto.length, texto: texto.trim(), x: rect.left + rect.width / 2, y: rect.top })
      }, 10)
    }
    el.addEventListener('mouseup', alSoltar)
    el.addEventListener('touchend', alSoltar)
    return () => {
      el.removeEventListener('mouseup', alSoltar)
      el.removeEventListener('touchend', alSoltar)
    }
  }, [onSeleccion])

  return <div ref={caja} className="pagina-texto" />
}

function envolver(n: Node, doc: Document) {
  const p = doc.createElement('p')
  p.appendChild(n)
  return p
}

function elementoDe(n: Node) {
  return n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement
}

// Envuelve los caracteres [inicio, fin) del bloque en <mark>, aunque crucen varias etiquetas.
function pintar(raiz: HTMLElement, s: Subrayado, abrir: (id: string) => void) {
  const bloque = raiz.querySelector(`[data-bloque="${s.bloque}"]`)
  if (!bloque) return
  const caminante = document.createTreeWalker(bloque, NodeFilter.SHOW_TEXT)
  const tramos: { nodo: Text; desde: number; hasta: number }[] = []
  let pos = 0
  for (let t = caminante.nextNode() as Text | null; t; t = caminante.nextNode() as Text | null) {
    const a = Math.max(s.inicio, pos)
    const b = Math.min(s.fin, pos + t.length)
    if (a < b) tramos.push({ nodo: t, desde: a - pos, hasta: b - pos })
    pos += t.length
  }
  for (const { nodo, desde, hasta } of tramos) {
    const medio = nodo.splitText(desde)
    medio.splitText(hasta - desde)
    const m = document.createElement('mark')
    m.className = s.nota ? 'subrayado con-nota' : 'subrayado'
    m.addEventListener('click', () => abrir(s.id))
    medio.replaceWith(m)
    m.appendChild(medio)
  }
}
