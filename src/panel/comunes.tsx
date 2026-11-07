// Piezas pequeñas compartidas por las pantallas del panel.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, NOMBRE_ESTADO, type Estado, type Etapa } from './api'

/** Carga datos de la API y expone recargar(). */
export function useDatos<T>(cargar: () => Promise<T>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recargar = useCallback(() => cargar().then((d) => { setDatos(d); setError(null) }).catch((e) => setError(e.message)), deps)
  useEffect(() => { recargar() }, [recargar])
  return { datos, error, recargar }
}

export function Cabecera({ titulo, sub, children }: { titulo: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="p-cabecera">
      <div><h1>{titulo}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="p-acciones">{children}</div>}
    </div>
  )
}

export function Insignia({ estado }: { estado: Estado }) {
  return <span className={`p-insignia e-${estado}`}>{NOMBRE_ESTADO[estado]}</span>
}

// Las etapas cambian poco: se piden una vez y se comparten entre pantallas.
let fasesEnCurso: Promise<Etapa[]> | null = null
export function olvidarEtapas() { fasesEnCurso = null }
export function useEtapas() {
  const [etapas, setEtapas] = useState<Etapa[] | null>(null)
  useEffect(() => {
    fasesEnCurso ??= api<Etapa[]>('/ventanilla/etapas').catch((e) => { fasesEnCurso = null; throw e })
    fasesEnCurso.then(setEtapas, () => setEtapas([]))
  }, [])
  return etapas
}

/** Las etapas como una barra: hechas en navy, la actual en rojo. */
export function Linea({ etapa, estado }: { etapa: number; estado: Estado }) {
  const etapas = useEtapas()
  const nombres = etapas?.map((e) => e.nombre)
  const total = etapas?.length || 8
  return (
    <div className="p-linea" role="img" aria-label={`Etapa ${etapa} de ${total}`} style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}>
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1
        const clase = n < etapa || (estado === 'publicado' && n === etapa) ? 'hecha' : n === etapa ? (estado === 'en_curso' ? 'actual' : 'detenida') : ''
        return <span key={n} className={clase} title={nombres?.[i] ? `${n}. ${nombres[i]}` : `Etapa ${n}`} />
      })}
    </div>
  )
}

export function Cargando({ error }: { error?: string | null }) {
  return error ? <p className="error">{error}</p> : <p className="p-tenue">Cargando…</p>
}

export function Aviso({ texto, tipo = 'ok', alCerrar }: { texto: string | null; tipo?: 'ok' | 'error'; alCerrar: () => void }) {
  useEffect(() => { if (texto && tipo === 'ok') { const t = setTimeout(alCerrar, 3500); return () => clearTimeout(t) } }, [texto, tipo, alCerrar])
  if (!texto) return null
  return <div className={`p-aviso ${tipo}`} role="status">{texto}<button onClick={alCerrar} aria-label="Cerrar">×</button></div>
}
