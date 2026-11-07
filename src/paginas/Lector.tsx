import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fuente } from '../lib/fuente-activa'
import { ErrorApi, type InfoObra } from '../lib/fuente'
import { leerLocal, guardarLocal } from '../lib/local'
import { esApp } from '../lib/dispositivo'
import type { Marcador, Pagina, Preferencias, Subrayado } from '../lib/tipos'
import VistaPagina, { type SeleccionTexto } from '../lector/VistaPagina'
import { fondoMarcaAgua, useProteccion } from '../lector/proteccion'

const PREF_INICIAL: Preferencias = { tema: 'claro', tamano: 100, fuente: 'serif' }
const COLOR_MARCA = { claro: 'rgba(4,4,74,0.07)', sepia: 'rgba(59,48,36,0.08)', noche: 'rgba(255,255,255,0.06)' }

type Panel = null | 'indice' | 'apariencia' | 'nota'
type Estado = { tipo: 'cargando' } | { tipo: 'lista'; pagina: Pagina } | { tipo: 'fin_muestra' } | { tipo: 'error'; mensaje: string; reintentar?: boolean }

export default function Lector({ correo }: { correo: string }) {
  const { id = '' } = useParams()
  const navegar = useNavigate()
  const raiz = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<InfoObra | null>(null)
  const [error, setError] = useState('')
  const [n, setN] = useState(0)
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  const [pref, setPref] = useState<Preferencias>(() => leerLocal('preferencias', PREF_INICIAL))
  const [marcadores, setMarcadores] = useState<Marcador[]>([])
  const [subrayados, setSubrayados] = useState<Subrayado[]>([])
  const [seleccion, setSeleccion] = useState<SeleccionTexto | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [notaId, setNotaId] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  // Solo la página actual y la siguiente quedan en memoria; nada se guarda en disco.
  const cache = useRef(new Map<number, Promise<Pagina>>())

  const total = info?.manifiesto.total_paginas ?? 1
  const permitidas = info?.paginas_permitidas ?? 0
  const titulo = info?.manifiesto.titulo ?? ''
  useProteccion(raiz, titulo, setAviso)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [i, prog, mar, sub] = await Promise.all([fuente.obra(id), fuente.leerProgreso(id), fuente.marcadores(id), fuente.subrayados(id)])
        if (!vivo) return
        setInfo(i)
        setMarcadores(mar)
        setSubrayados(sub)
        setN(Math.min(Math.max(1, prog?.pagina ?? 1), i.manifiesto.total_paginas))
      } catch (e) {
        if (vivo) setError(e instanceof ErrorApi && e.status === 404 ? 'Este libro no existe o ya no está disponible.' : 'No se pudo abrir el libro. Revisa tu conexión.')
      }
    })()
    return () => { vivo = false }
  }, [id])

  const traer = useCallback((k: number) => {
    if (!cache.current.has(k)) {
      const p = fuente.pagina(id, k)
      p.catch(() => cache.current.delete(k))
      cache.current.set(k, p)
    }
    return cache.current.get(k)!
  }, [id])

  useEffect(() => {
    if (!info || !n) return
    let vivo = true
    setSeleccion(null)
    if (n > permitidas) {
      setEstado({ tipo: 'fin_muestra' })
      return
    }
    setEstado({ tipo: 'cargando' })
    traer(n).then(
      (pagina) => vivo && setEstado({ tipo: 'lista', pagina }),
      (e) => {
        if (!vivo) return
        if (e instanceof ErrorApi && e.status === 429) setEstado({ tipo: 'error', mensaje: 'Estás pasando páginas muy rápido. Espera unos segundos.', reintentar: true })
        else if (e instanceof ErrorApi && e.status === 403) setEstado({ tipo: 'fin_muestra' })
        else setEstado({ tipo: 'error', mensaje: 'No se pudo cargar esta página.', reintentar: true })
      },
    )
    for (const k of cache.current.keys()) if (k !== n && k !== n + 1) cache.current.delete(k)
    if (n + 1 <= permitidas) setTimeout(() => vivo && traer(n + 1), 600)
    const t = setTimeout(() => fuente.guardarProgreso(id, { pagina: n, porcentaje: total > 1 ? (n - 1) / (total - 1) : 1 }).catch(() => {}), 800)
    return () => { vivo = false; clearTimeout(t) }
  }, [info, n, permitidas, total, id, traer])

  useEffect(() => guardarLocal('preferencias', pref), [pref])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(''), 2400)
    return () => clearTimeout(t)
  }, [aviso])

  const ir = useCallback((k: number) => setN(Math.min(Math.max(1, k), total)), [total])
  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') ir(n + 1)
      if (e.key === 'ArrowLeft') ir(n - 1)
    }
    window.addEventListener('keydown', teclas)
    return () => window.removeEventListener('keydown', teclas)
  }, [n, ir])

  const x0 = useRef<number | null>(null)
  const capitulo = info?.manifiesto.indice.filter((e) => e.pagina <= n).pop()?.etiqueta ?? ''
  const marcada = marcadores.find((m) => m.pagina === n)
  const deEstaPagina = subrayados.filter((s) => s.pagina === n)
  const abrirSubrayado = useCallback((sid: string) => { setNotaId(sid); setPanel('nota') }, [])

  async function alternarMarcador() {
    if (marcada) {
      setMarcadores((ms) => ms.filter((m) => m.id !== marcada.id))
      await fuente.quitarMarcador(id, marcada.id)
      setAviso('Marcador quitado')
    } else {
      const m: Marcador = { id: crypto.randomUUID(), pagina: n, etiqueta: [capitulo, `pág. ${n}`].filter(Boolean).join(' · '), creado_en: new Date().toISOString() }
      setMarcadores((ms) => [...ms, m])
      await fuente.agregarMarcador(id, m)
      setAviso('Página marcada')
    }
  }

  async function subrayar(abrirNota: boolean) {
    if (!seleccion) return
    const s: Subrayado = { id: crypto.randomUUID(), pagina: n, bloque: seleccion.bloque, inicio: seleccion.inicio, fin: seleccion.fin, texto: seleccion.texto, nota: '', creado_en: new Date().toISOString() }
    window.getSelection()?.removeAllRanges()
    setSeleccion(null)
    setSubrayados((ss) => [...ss, s])
    await fuente.agregarSubrayado(id, s)
    if (abrirNota) abrirSubrayado(s.id)
    else setAviso('Subrayado guardado')
  }

  if (error) {
    return (
      <div className="lector-error">
        <p>{error}</p>
        <button className="btn" onClick={() => navegar('/')}>Volver a la biblioteca</button>
      </div>
    )
  }

  const nota = subrayados.find((s) => s.id === notaId)
  const pct = Math.round((total > 1 ? (n - 1) / (total - 1) : 1) * 100)

  return (
    <div className="lector" data-tema={pref.tema} data-fuente={pref.fuente} style={{ '--tamano': pref.tamano / 100 } as React.CSSProperties} ref={raiz}>
      <header className="lector-barra">
        <BotonIcono etiqueta="Volver a la biblioteca" onClick={() => navegar('/')} icono="volver" />
        <BotonIcono etiqueta="Índice y notas" onClick={() => setPanel(panel === 'indice' ? null : 'indice')} icono="indice" />
        <div className="lector-titulo">{titulo || 'Abriendo…'}</div>
        <BotonIcono etiqueta="Apariencia" onClick={() => setPanel(panel === 'apariencia' ? null : 'apariencia')} icono="aa" />
        <BotonIcono etiqueta={marcada ? 'Quitar marcador' : 'Marcar página'} onClick={alternarMarcador} icono="marcador" activo={!!marcada} />
      </header>

      <main
        className="lector-pagina"
        onTouchStart={(e) => { x0.current = e.touches[0].clientX }}
        onTouchEnd={(e) => {
          if (x0.current === null) return
          const dx = e.changedTouches[0].clientX - x0.current
          x0.current = null
          if (window.getSelection()?.toString()) return
          if (Math.abs(dx) > 60) ir(n + (dx < 0 ? 1 : -1))
        }}
      >
        <button className="lector-lado" aria-label="Página anterior" disabled={n <= 1} onClick={() => ir(n - 1)}>‹</button>
        <div className={`lector-hoja formato-${info?.manifiesto.formato ?? 'epub'}`}>
          {estado.tipo === 'lista' && (
            <VistaPagina pagina={estado.pagina} subrayados={deEstaPagina} onSeleccion={setSeleccion} onAbrirSubrayado={abrirSubrayado} />
          )}
          {estado.tipo === 'cargando' && <p className="lector-cargando">Cargando la página…</p>}
          {estado.tipo === 'error' && (
            <div className="lector-aviso">
              <p>{estado.mensaje}</p>
              {estado.reintentar && <button className="btn secundario" onClick={() => { cache.current.delete(n); setN(0); setTimeout(() => setN(n)) }}>Reintentar</button>}
            </div>
          )}
          {estado.tipo === 'fin_muestra' && (
            <div className="lector-aviso">
              <h2>Aquí termina la muestra</h2>
              <p>Leíste las {permitidas} páginas de muestra de «{titulo}».</p>
              {/* En la app no hay enlaces de compra: se compra en el sitio web. */}
              {!esApp() && <a className="btn" href={`/libros/${id}`}>Ver el libro en la tienda</a>}
            </div>
          )}
          {/* Marca de agua del lado del cliente, sobre la que ya trae cada página desde el servidor. */}
          <div className="marca-agua" aria-hidden="true" style={{ backgroundImage: fondoMarcaAgua(correo, COLOR_MARCA[pref.tema]) }} />
        </div>
        <button className="lector-lado" aria-label="Página siguiente" disabled={n >= total} onClick={() => ir(n + 1)}>›</button>
      </main>

      <footer className="lector-pie">
        <span className="lector-capitulo">{capitulo}</span>
        <input type="range" min={1} max={total} value={n || 1} aria-label="Página" onChange={(e) => ir(Number(e.target.value))} />
        <span>{n} de {total}</span>
        <span className="pct">{pct} %</span>
      </footer>

      {seleccion && (
        <div className="seleccion" style={{ left: seleccion.x, top: Math.max(56, seleccion.y - 52) }}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => subrayar(false)}>Subrayar</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => subrayar(true)}>Nota</button>
        </div>
      )}

      {panel === 'apariencia' && (
        <section className="hoja derecha" aria-label="Apariencia">
          <h4>Fondo</h4>
          <div className="fila">
            {(['claro', 'sepia', 'noche'] as const).map((t) => (
              <button key={t} className={`ficha tema-${t}`} aria-pressed={pref.tema === t} onClick={() => setPref({ ...pref, tema: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <h4>{info?.manifiesto.formato === 'pdf' ? 'Zoom' : 'Tamaño de letra'}</h4>
          <div className="fila">
            <button className="ficha" onClick={() => setPref({ ...pref, tamano: Math.max(70, pref.tamano - 10) })}>A−</button>
            <span className="valor">{pref.tamano} %</span>
            <button className="ficha" onClick={() => setPref({ ...pref, tamano: Math.min(200, pref.tamano + 10) })}>A+</button>
          </div>
          {info?.manifiesto.formato === 'epub' && (
            <>
              <h4>Tipo de letra</h4>
              <div className="fila">
                <button className="ficha f-serif" aria-pressed={pref.fuente === 'serif'} onClick={() => setPref({ ...pref, fuente: 'serif' })}>Literata</button>
                <button className="ficha f-sans" aria-pressed={pref.fuente === 'sans'} onClick={() => setPref({ ...pref, fuente: 'sans' })}>Inter</button>
              </div>
            </>
          )}
        </section>
      )}

      {panel === 'indice' && (
        <section className="hoja izquierda" aria-label="Índice y notas">
          <h4>Contenido</h4>
          {info?.manifiesto.indice.length ? info.manifiesto.indice.map((e, i) => (
            <button key={i} className="item" style={{ paddingLeft: 8 + e.nivel * 14 }} onClick={() => { ir(e.pagina); setPanel(null) }}>
              {e.etiqueta}<span className="pg">{e.pagina}</span>
            </button>
          )) : <p className="vacio">Este libro no tiene índice.</p>}
          <h4>Marcadores</h4>
          {marcadores.length ? marcadores.map((m) => (
            <button key={m.id} className="item" onClick={() => { ir(m.pagina); setPanel(null) }}>{m.etiqueta}</button>
          )) : <p className="vacio">Toca el marcador de arriba para guardar una página.</p>}
          {info?.manifiesto.formato === 'epub' && (
            <>
              <h4>Subrayados y notas</h4>
              {subrayados.length ? subrayados.map((s) => (
                <button key={s.id} className="item" onClick={() => { ir(s.pagina); setPanel(null) }}>
                  <span className="cita">“{s.texto}”</span>
                  {s.nota && <span className="nota">{s.nota}</span>}
                </button>
              )) : <p className="vacio">Selecciona un texto para subrayarlo o escribir una nota.</p>}
            </>
          )}
        </section>
      )}

      {panel === 'nota' && nota && (
        <EditorNota
          key={nota.id}
          subrayado={nota}
          onGuardar={async (texto) => {
            setSubrayados((ss) => ss.map((s) => (s.id === nota.id ? { ...s, nota: texto } : s)))
            setPanel(null)
            await fuente.guardarNota(id, nota.id, texto)
            setAviso(texto ? 'Nota guardada' : 'Subrayado guardado')
          }}
          onQuitar={async () => {
            setSubrayados((ss) => ss.filter((s) => s.id !== nota.id))
            setPanel(null)
            await fuente.quitarSubrayado(id, nota.id)
            setAviso('Subrayado quitado')
          }}
          onCerrar={() => setPanel(null)}
        />
      )}

      {aviso && <div className="aviso" role="status">{aviso}</div>}
    </div>
  )
}

function EditorNota(props: { subrayado: Subrayado; onGuardar: (t: string) => void; onQuitar: () => void; onCerrar: () => void }) {
  const [texto, setTexto] = useState(props.subrayado.nota)
  return (
    <section className="hoja derecha" aria-label="Nota">
      <h4>Nota</h4>
      <blockquote>“{props.subrayado.texto}”</blockquote>
      <textarea id="nota-texto" autoFocus value={texto} placeholder="Escribe tu reflexión…" onChange={(e) => setTexto(e.target.value)} />
      <div className="fila">
        <button className="btn secundario" onClick={props.onQuitar}>Quitar subrayado</button>
        <button className="btn" onClick={() => props.onGuardar(texto.trim())}>Guardar</button>
      </div>
      <button className="cerrar" aria-label="Cerrar" onClick={props.onCerrar}>×</button>
    </section>
  )
}

const ICONOS = {
  volver: <path d="M15 5l-7 7 7 7" />,
  indice: <path d="M4 6h16M4 12h16M4 18h10" />,
  aa: <path d="M3 19l5-13 5 13M5 14h6M15 19l3.5-8 3.5 8M16 16.5h5" />,
  marcador: <path d="M7 3h10v18l-5-4-5 4z" />,
}

function BotonIcono(props: { etiqueta: string; icono: keyof typeof ICONOS; onClick: () => void; activo?: boolean }) {
  return (
    <button className={`icono${props.activo ? ' activo' : ''}`} aria-label={props.etiqueta} title={props.etiqueta} onClick={props.onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{ICONOS[props.icono]}</svg>
    </button>
  )
}
