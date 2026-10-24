import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import ePub, { type Book, type Rendition, type Location, type NavItem } from 'epubjs'
import type { Contents } from 'epubjs'
import type { EntradaIndice } from '../lib/tipos'
import { COLORES_TEMA, FUENTES, type Motor, type PropsMotor } from './motor'

const LectorEpub = forwardRef<Motor, PropsMotor>(function LectorEpub(props, ref) {
  const contenedor = useRef<HTMLDivElement>(null)
  const libro = useRef<Book | null>(null)
  const vista = useRef<Rendition | null>(null)
  const pintados = useRef(new Set<string>())
  // Los callbacks cambian en cada render; se leen siempre desde aquí.
  const cb = useRef(props)
  cb.current = props

  useImperativeHandle(ref, () => ({
    siguiente: () => vista.current?.next(),
    anterior: () => vista.current?.prev(),
    ir: (u) => vista.current?.display(u),
    irPorcentaje: (p) => {
      const l = libro.current
      if (l && l.locations.length()) vista.current?.display(l.locations.cfiFromPercentage(p))
    },
  }))

  useEffect(() => {
    if (!contenedor.current) return
    const l = ePub(props.archivo)
    const r = l.renderTo(contenedor.current, {
      width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false,
    })
    libro.current = l
    vista.current = r
    pintados.current = new Set()

    for (const [nombre, c] of Object.entries(COLORES_TEMA)) {
      r.themes.register(nombre, {
        body: { background: `${c.fondo} !important`, color: `${c.texto} !important`, 'line-height': '1.65' },
        'p, li, h1, h2, h3, span, div': { color: `${c.texto} !important` },
        a: { color: `${c.texto} !important` },
        '::selection': { background: c.subrayado },
      })
    }

    l.loaded.navigation.then((nav) => {
      const plano = (items: NavItem[], nivel: number): EntradaIndice[] =>
        items.flatMap((i) => [{ etiqueta: i.label.trim(), ubicacion: i.href, nivel }, ...plano(i.subitems ?? [], nivel + 1)])
      cb.current.onIndice(plano(nav.toc, 0))
    })

    const capitulo = (href: string) => {
      const base = href.split('#')[0]
      const item = l.navigation?.toc.find((t) => t.href.split('#')[0] === base)
      return item?.label.trim() ?? ''
    }

    r.on('relocated', (loc: Location) => {
      const cfi = loc.start.cfi
      const pct = l.locations.length() ? l.locations.percentageFromCfi(cfi) : 0
      const { page, total } = loc.start.displayed
      cb.current.onPosicion({
        ubicacion: cfi, porcentaje: pct, etiqueta: capitulo(loc.start.href), pagina: `${page} de ${total}`,
      })
      cb.current.onSeleccion(null)
    })

    r.on('selected', (cfiRange: string, contents: Contents) => {
      const sel = contents.window.getSelection()
      const texto = sel?.toString().trim() ?? ''
      if (!texto || !sel?.rangeCount) return
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      const marco = contenedor.current!.querySelector('iframe')!.getBoundingClientRect()
      cb.current.onSeleccion({ ubicacion: cfiRange, texto, x: marco.left + rect.left + rect.width / 2, y: marco.top + rect.top })
    })

    // Flechas del teclado tanto dentro del libro (iframe) como en el resto de la pantalla.
    const teclas = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') r.next()
      if (e.key === 'ArrowLeft') r.prev()
    }
    r.on('keyup', teclas)
    window.addEventListener('keyup', teclas)

    // Deslizar para pasar página dentro del iframe del libro.
    r.hooks.content.register((contents: Contents) => {
      let x0: number | null = null
      contents.document.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX }, { passive: true })
      contents.document.addEventListener('touchend', (e) => {
        if (x0 === null) return
        const dx = e.changedTouches[0].clientX - x0
        x0 = null
        if (contents.window.getSelection()?.toString()) return
        if (Math.abs(dx) > 50) {
          if (dx < 0) r.next()
          else r.prev()
        }
      })
      contents.document.addEventListener('mousedown', () => cb.current.onSeleccion(null))
    })

    r.display(props.ubicacionInicial ?? undefined)
    l.ready
      .then(() => l.locations.generate(1200))
      .then(() => {
        const actual = r.currentLocation() as unknown as Location
        if (actual?.start) r.emit('relocated', actual)
      })

    return () => {
      window.removeEventListener('keyup', teclas)
      r.destroy()
      l.destroy()
    }
    // El libro se vuelve a abrir solo si cambia el archivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.archivo])

  // Apariencia
  useEffect(() => {
    const r = vista.current
    if (!r) return
    r.themes.select(props.preferencias.tema)
    r.themes.fontSize(`${props.preferencias.tamano}%`)
    r.themes.font(FUENTES[props.preferencias.fuente])
  }, [props.preferencias])

  // Subrayados: pintar los nuevos y borrar los quitados.
  useEffect(() => {
    const r = vista.current
    if (!r) return
    const actuales = new Map(props.subrayados.map((s) => [s.ubicacion, s]))
    for (const cfi of pintados.current) {
      if (!actuales.has(cfi)) {
        r.annotations.remove(cfi, 'highlight')
        pintados.current.delete(cfi)
      }
    }
    for (const [cfi, s] of actuales) {
      if (pintados.current.has(cfi)) continue
      r.annotations.highlight(cfi, { id: s.id }, () => cb.current.onAbrirSubrayado(s.id), 'subrayado', {
        fill: '#E8B931', 'fill-opacity': '0.38',
      })
      pintados.current.add(cfi)
    }
  }, [props.subrayados])

  return <div ref={contenedor} className="motor-epub" />
})

export default LectorEpub
