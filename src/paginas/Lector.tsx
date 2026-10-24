import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as datos from '../lib/datos'
import { leerLocal, guardarLocal } from '../lib/local'
import type { EntradaIndice, Libro, Marcador, Preferencias, Subrayado } from '../lib/tipos'
import LectorEpub from '../lector/LectorEpub'
import LectorPdf from '../lector/LectorPdf'
import type { Motor, Posicion, Seleccion } from '../lector/motor'

const PREF_INICIAL: Preferencias = { tema: 'claro', tamano: 100, fuente: 'serif' }

type Panel = null | 'indice' | 'apariencia' | 'nota'

export default function Lector() {
  const { id = '' } = useParams()
  const navegar = useNavigate()
  const motor = useRef<Motor>(null)
  const [libro, setLibro] = useState<Libro | null>(null)
  const [archivo, setArchivo] = useState<ArrayBuffer | null>(null)
  const [inicio, setInicio] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pref, setPref] = useState<Preferencias>(() => leerLocal('preferencias', PREF_INICIAL))
  const [pos, setPos] = useState<Posicion | null>(null)
  const [indice, setIndice] = useState<EntradaIndice[]>([])
  const [marcadores, setMarcadores] = useState<Marcador[]>([])
  const [subrayados, setSubrayados] = useState<Subrayado[]>([])
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [notaId, setNotaId] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const l = await datos.obtenerLibro(id)
        if (!l) throw new Error('Este libro no está en tu biblioteca.')
        const [buf, prog, mar, sub] = await Promise.all([
          datos.descargarLibro(l), datos.leerProgreso(id), datos.listarMarcadores(id), datos.listarSubrayados(id),
        ])
        if (!vivo) return
        setLibro(l); setInicio(prog?.ubicacion ?? null); setMarcadores(mar); setSubrayados(sub); setArchivo(buf)
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudo abrir el libro.')
      }
    })()
    return () => { vivo = false }
  }, [id])

  useEffect(() => guardarLocal('preferencias', pref), [pref])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(''), 2200)
    return () => clearTimeout(t)
  }, [aviso])

  // Guardar progreso con una pequeña espera para no escribir en cada página.
  const temporizador = useRef<number>(undefined)
  const onPosicion = useCallback((p: Posicion) => {
    setPos(p)
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => {
      datos.guardarProgreso(id, { ubicacion: p.ubicacion, porcentaje: p.porcentaje })
    }, 800)
  }, [id])

  const marcada = pos ? marcadores.find((m) => m.ubicacion === pos.ubicacion) : undefined
  async function alternarMarcador() {
    if (!pos) return
    if (marcada) {
      await datos.quitarMarcador(id, marcada.id)
      setMarcadores((ms) => ms.filter((m) => m.id !== marcada.id))
      setAviso('Marcador quitado')
    } else {
      const etiqueta = [pos.etiqueta, pos.pagina ? `pág. ${pos.pagina.split(' ')[0]}` : ''].filter(Boolean).join(' · ')
      const m = await datos.agregarMarcador(id, pos.ubicacion, etiqueta || 'Marcador')
      setMarcadores((ms) => [...ms, m])
      setAviso('Página marcada')
    }
  }

  async function subrayar(abrirNota: boolean) {
    if (!seleccion) return
    const s = await datos.agregarSubrayado(id, seleccion.ubicacion, seleccion.texto)
    setSubrayados((ss) => [...ss, s])
    setSeleccion(null)
    if (abrirNota) { setNotaId(s.id); setPanel('nota') } else setAviso('Subrayado guardado')
  }

  async function copiar() {
    if (!seleccion || !libro) return
    try {
      await navigator.clipboard.writeText(`“${seleccion.texto}” (${libro.titulo})`)
      setAviso('Texto copiado')
    } catch {
      setAviso('No se pudo copiar')
    }
    setSeleccion(null)
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
  const Motor = libro?.formato === 'pdf' ? LectorPdf : LectorEpub

  return (
    <div className="lector" data-tema={pref.tema}>
      <header className="lector-barra">
        <BotonIcono etiqueta="Volver a la biblioteca" onClick={() => navegar('/')} icono="volver" />
        <BotonIcono etiqueta="Índice y notas" onClick={() => setPanel(panel === 'indice' ? null : 'indice')} icono="indice" />
        <div className="lector-titulo">{libro?.titulo ?? 'Abriendo…'}</div>
        <BotonIcono etiqueta="Apariencia" onClick={() => setPanel(panel === 'apariencia' ? null : 'apariencia')} icono="aa" />
        <BotonIcono etiqueta={marcada ? 'Quitar marcador' : 'Marcar página'} onClick={alternarMarcador} icono="marcador" activo={!!marcada} />
      </header>

      <main className="lector-pagina">
        <button className="lector-lado" aria-label="Página anterior" onClick={() => motor.current?.anterior()}>‹</button>
        <div className="lector-motor">
          {archivo && libro ? (
            <Motor
              ref={motor}
              archivo={archivo}
              ubicacionInicial={inicio}
              preferencias={pref}
              subrayados={subrayados}
              onPosicion={onPosicion}
              onIndice={setIndice}
              onSeleccion={setSeleccion}
              onAbrirSubrayado={(sid) => { setNotaId(sid); setPanel('nota') }}
            />
          ) : (
            <p className="lector-cargando">Abriendo el libro…</p>
          )}
        </div>
        <button className="lector-lado" aria-label="Página siguiente" onClick={() => motor.current?.siguiente()}>›</button>
      </main>

      <footer className="lector-pie">
        <span className="lector-capitulo">{pos?.etiqueta}</span>
        <input
          type="range" min={0} max={1000} aria-label="Posición en el libro"
          value={Math.round((pos?.porcentaje ?? 0) * 1000)}
          onChange={(e) => motor.current?.irPorcentaje(Number(e.target.value) / 1000)}
        />
        <span>{Math.round((pos?.porcentaje ?? 0) * 100)} %</span>
      </footer>

      {seleccion && (
        <div className="seleccion" style={{ left: seleccion.x, top: Math.max(56, seleccion.y - 52) }}>
          {libro?.formato === 'epub' && <button onClick={() => subrayar(false)}>Subrayar</button>}
          {libro?.formato === 'epub' && <button onClick={() => subrayar(true)}>Nota</button>}
          <button onClick={copiar}>Copiar</button>
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
          <h4>{libro?.formato === 'pdf' ? 'Zoom' : 'Tamaño de letra'}</h4>
          <div className="fila">
            <button className="ficha" onClick={() => setPref({ ...pref, tamano: Math.max(70, pref.tamano - 10) })}>A−</button>
            <span className="valor">{pref.tamano} %</span>
            <button className="ficha" onClick={() => setPref({ ...pref, tamano: Math.min(200, pref.tamano + 10) })}>A+</button>
          </div>
          {libro?.formato === 'epub' && (
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
          {indice.map((e, i) => (
            <button key={i} className="item" style={{ paddingLeft: 8 + e.nivel * 14 }} onClick={() => { motor.current?.ir(e.ubicacion); setPanel(null) }}>
              {e.etiqueta}
            </button>
          ))}
          <h4>Marcadores</h4>
          {marcadores.length ? marcadores.map((m) => (
            <button key={m.id} className="item" onClick={() => { motor.current?.ir(m.ubicacion); setPanel(null) }}>{m.etiqueta}</button>
          )) : <p className="vacio">Toca el marcador de arriba para guardar una página.</p>}
          {libro?.formato === 'epub' && (
            <>
              <h4>Subrayados y notas</h4>
              {subrayados.length ? subrayados.map((s) => (
                <button key={s.id} className="item" onClick={() => { motor.current?.ir(s.ubicacion); setPanel(null) }}>
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
            await datos.guardarNota(id, nota.id, texto)
            setSubrayados((ss) => ss.map((s) => (s.id === nota.id ? { ...s, nota: texto } : s)))
            setPanel(null)
            setAviso(texto ? 'Nota guardada' : 'Subrayado guardado')
          }}
          onQuitar={async () => {
            await datos.quitarSubrayado(id, nota.id)
            setSubrayados((ss) => ss.filter((s) => s.id !== nota.id))
            setPanel(null)
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
