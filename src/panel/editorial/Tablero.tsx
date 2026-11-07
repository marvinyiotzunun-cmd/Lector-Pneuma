import { Link } from 'react-router-dom'
import { api, fecha, NOMBRE_ESTADO, type Estado, type Expediente } from '../api'
import { Cabecera, Cargando, Insignia, useDatos } from '../comunes'

interface Resumen {
  por_etapa: { numero: number; nombre: string; dias_estimados: number | null; total: number }[]
  por_estado: Partial<Record<Estado, number>>
  atrasados: number
  recientes: { id: string; tipo: string; etapa_nueva: number | null; estado_nuevo: Estado | null; nota: string | null
    creado_en: string; expediente_id: string; codigo: string; titulo: string; autor: string | null }[]
  anio: { recibidas: number; publicadas: number | null }
}

export default function Tablero() {
  const { datos: r, error } = useDatos(() => api<Resumen>('/admin/expedientes/resumen'))
  const { datos: abiertos } = useDatos(() => api<Expediente[]>('/admin/expedientes?abiertos=1'))
  if (!r) return <Cargando error={error} />
  const abiertosTotal = (r.por_estado.en_curso ?? 0) + (r.por_estado.requiere_cambios ?? 0) + (r.por_estado.en_pausa ?? 0)

  return (
    <>
      <Cabecera titulo="Tablero editorial" sub="Todos los expedientes abiertos de los ministerios, por etapa del proceso editorial.">
        <Link className="btn secundario" to="/editorial/expedientes">Ver la lista completa</Link>
      </Cabecera>
      <div className="p-cifras">
        <Cifra valor={abiertosTotal} texto="Expedientes abiertos" />
        <Cifra valor={r.por_estado.requiere_cambios ?? 0} texto="Esperan cambios del ministerio" />
        <Cifra valor={r.atrasados} texto="Pasaron el plazo de su etapa" alerta={r.atrasados > 0} a="/editorial/expedientes?atrasados=1" />
        <Cifra valor={r.anio.recibidas} texto={`Recibidas en ${new Date().getFullYear()}`} />
        <Cifra valor={r.anio.publicadas ?? 0} texto={`Publicadas en ${new Date().getFullYear()}`} />
      </div>

      <h2 className="p-seccion">Por etapa</h2>
      <div className="p-tablero">
        {r.por_etapa.map((et) => (
          <section key={et.numero} className="p-col">
            <header><span className="n">{et.numero}</span><strong>{et.nombre}</strong><span className="p-cuenta-col">{et.total}</span></header>
            {(abiertos ?? []).filter((x) => x.etapa === et.numero).map((x) => {
              const tarde = x.estado === 'en_curso' && x.dias_estimados != null && (x.dias_en_etapa ?? 0) > x.dias_estimados
              return (
                <Link key={x.id} to={`/editorial/${x.id}`} className={`p-ficha${tarde ? ' tarde' : ''}`}>
                  <span className="p-codigo">{x.codigo}</span>
                  <strong>{x.titulo}</strong>
                  <span className="p-tenue">{x.ministerio}</span>
                  <span className="p-ficha-pie">
                    {x.estado !== 'en_curso' ? <Insignia estado={x.estado} /> : <span className={tarde ? 'error' : 'p-tenue'}>{x.dias_en_etapa} d{et.dias_estimados ? ` de ${et.dias_estimados}` : ''}</span>}
                    {x.responsable && <span className="p-tenue">{x.responsable}</span>}
                  </span>
                </Link>
              )
            })}
          </section>
        ))}
      </div>

      <h2 className="p-seccion">Actividad reciente</h2>
      <div className="p-tarjeta">
        {r.recientes.length === 0 ? <p className="p-tenue">Todavía no hay actividad.</p> : (
          <ul className="p-historial">
            {r.recientes.map((h) => (
              <li key={h.id}>
                <time>{fecha(h.creado_en, true)}</time>
                <Link to={`/editorial/${h.expediente_id}`}><strong>{h.codigo}</strong> «{h.titulo}»</Link>
                <span className="p-tenue"> · {h.tipo === 'creado' ? 'solicitud nueva' : h.tipo === 'etapa' ? `pasó a la etapa ${h.etapa_nueva}`
                  : h.tipo === 'estado' ? NOMBRE_ESTADO[h.estado_nuevo!].toLowerCase() : h.tipo === 'documento' ? 'documentos' : 'nota'}{h.autor ? ` · ${h.autor}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function Cifra({ valor, texto, alerta, a }: { valor: number; texto: string; alerta?: boolean; a?: string }) {
  const cuerpo = <><strong>{valor}</strong><span>{texto}</span></>
  return a ? <Link to={a} className={`p-cifra${alerta ? ' alerta' : ''}`}>{cuerpo}</Link> : <div className={`p-cifra${alerta ? ' alerta' : ''}`}>{cuerpo}</div>
}
