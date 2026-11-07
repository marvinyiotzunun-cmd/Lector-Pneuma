import { Link } from 'react-router-dom'
import { api, fecha, type Expediente } from '../api'
import { Cabecera, Cargando, Insignia, Linea, useDatos, useEtapas } from '../comunes'
import { useSesion } from '../Panel'

export default function MisObras() {
  const { ministerios } = useSesion()
  const { datos, error } = useDatos(() => api<Expediente[]>('/ventanilla/expedientes'))
  const etapas = useEtapas()
  const sinMinisterio = ministerios.length === 0

  return (
    <>
      <Cabecera titulo="Mis obras" sub={ministerios.map((m) => m.nombre).join(' · ') || undefined}>
        {!sinMinisterio && <Link className="btn" to="/ventanilla/nueva">Presentar una obra</Link>}
      </Cabecera>
      {sinMinisterio && (
        <div className="p-tarjeta p-alerta">
          Su cuenta todavía no está ligada a un ministerio. Pida a la Dirección Editorial que la agregue para presentar obras.
        </div>
      )}
      {!datos ? <Cargando error={error} /> : datos.length === 0 ? (
        <div className="p-tarjeta p-vacio">
          <p>Aún no hay obras presentadas.</p>
          {!sinMinisterio && <p>Presente su primera obra: llene la solicitud, adjunte el manuscrito y los documentos, y siga cada etapa desde aquí.</p>}
        </div>
      ) : (
        <div className="p-lista">
          {datos.map((e) => (
            <Link key={e.id} to={`/ventanilla/${e.codigo}`} className="p-tarjeta p-expediente">
              <div className="p-exp-cab">
                <span className="p-codigo">{e.codigo}</span>
                <Insignia estado={e.estado} />
              </div>
              <h3>{e.titulo}</h3>
              <p className="p-tenue">{e.autores} · {e.ministerio}</p>
              <Linea etapa={e.etapa} estado={e.estado} />
              <div className="p-exp-pie">
                <span>Etapa {e.etapa} de {etapas?.length ?? '…'} · <strong>{e.etapa_nombre}</strong></span>
                <span className="p-tenue">Actualizado {fecha(e.actualizado_en)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
