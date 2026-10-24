import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import urlTrabajador from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { EntradaIndice } from '../lib/tipos'
import type { Motor, PropsMotor } from './motor'

pdfjs.GlobalWorkerOptions.workerSrc = urlTrabajador

// En PDF la página se dibuja tal cual; el tema se aplica con un filtro sobre el lienzo.
const FILTRO = { claro: 'none', sepia: 'sepia(0.35) brightness(0.97)', noche: 'invert(0.88) hue-rotate(180deg)' }

const LectorPdf = forwardRef<Motor, PropsMotor>(function LectorPdf(props, ref) {
  const caja = useRef<HTMLDivElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pagina, setPagina] = useState(() => Math.max(1, Number(props.ubicacionInicial) || 1))
  const [ancho, setAncho] = useState(0) // cambia al redimensionar para volver a dibujar
  const cb = useRef(props)
  cb.current = props

  const total = doc?.numPages ?? 1
  const ir = (n: number) => setPagina(Math.min(Math.max(1, n), total))

  useImperativeHandle(ref, () => ({
    siguiente: () => ir(pagina + 1),
    anterior: () => ir(pagina - 1),
    ir: (u) => ir(Number(u)),
    irPorcentaje: (p) => ir(Math.round(p * (total - 1)) + 1),
  }))

  useEffect(() => {
    // pdf.js transfiere el búfer al trabajador; se pasa una copia para poder reabrirlo.
    const tarea = pdfjs.getDocument({ data: props.archivo.slice(0) })
    let vivo = true
    tarea.promise.then(async (d) => {
      if (!vivo) return
      setDoc(d)
      const esquema = await d.getOutline()
      const entradas: EntradaIndice[] = []
      const recorrer = async (items: typeof esquema, nivel: number) => {
        for (const it of items ?? []) {
          try {
            const destino = typeof it.dest === 'string' ? await d.getDestination(it.dest) : it.dest
            if (destino) {
              const indice = await d.getPageIndex(destino[0])
              entradas.push({ etiqueta: it.title, ubicacion: String(indice + 1), nivel })
            }
          } catch { /* destino no válido */ }
          await recorrer(it.items, nivel + 1)
        }
      }
      await recorrer(esquema, 0)
      if (!entradas.length) {
        for (let i = 1; i <= d.numPages; i++) entradas.push({ etiqueta: `Página ${i}`, ubicacion: String(i), nivel: 0 })
      }
      if (vivo) cb.current.onIndice(entradas)
    })
    return () => {
      vivo = false
      tarea.destroy()
    }
  }, [props.archivo])

  useEffect(() => {
    const el = caja.current
    if (!el) return
    const obs = new ResizeObserver(() => setAncho((n) => n + 1))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || !lienzo.current || !caja.current) return
    let tarea: RenderTask | null = null
    let vivo = true
    doc.getPage(pagina).then((p) => {
      if (!vivo) return
      const base = p.getViewport({ scale: 1 })
      const cw = caja.current!.clientWidth - 24
      const ch = caja.current!.clientHeight - 24
      const escala = Math.min(cw / base.width, ch / base.height) * (props.preferencias.tamano / 100)
      const vp = p.getViewport({ scale: escala })
      const dpr = window.devicePixelRatio || 1
      const c = lienzo.current!
      c.width = Math.floor(vp.width * dpr)
      c.height = Math.floor(vp.height * dpr)
      c.style.width = `${Math.floor(vp.width)}px`
      c.style.height = `${Math.floor(vp.height)}px`
      tarea = p.render({ canvasContext: c.getContext('2d')!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      tarea.promise.catch(() => {})
    })
    cb.current.onPosicion({
      ubicacion: String(pagina),
      porcentaje: doc.numPages > 1 ? (pagina - 1) / (doc.numPages - 1) : 1,
      etiqueta: `Página ${pagina}`,
      pagina: `${pagina} de ${doc.numPages}`,
    })
    return () => {
      vivo = false
      tarea?.cancel()
    }
  }, [doc, pagina, ancho, props.preferencias.tamano])

  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') setPagina((n) => Math.min(n + 1, total))
      if (e.key === 'ArrowLeft') setPagina((n) => Math.max(n - 1, 1))
    }
    window.addEventListener('keydown', teclas)
    return () => window.removeEventListener('keydown', teclas)
  }, [total])

  const x0 = useRef<number | null>(null)
  return (
    <div
      ref={caja}
      className="motor-pdf"
      onTouchStart={(e) => { x0.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        if (x0.current === null) return
        const dx = e.changedTouches[0].clientX - x0.current
        x0.current = null
        if (Math.abs(dx) > 50) ir(pagina + (dx < 0 ? 1 : -1))
      }}
    >
      <canvas ref={lienzo} style={{ filter: FILTRO[props.preferencias.tema] }} />
    </div>
  )
})

export default LectorPdf
