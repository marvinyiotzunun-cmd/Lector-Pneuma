import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fecha } from '../api'
import { Cabecera, Cargando, useDatos } from '../comunes'

interface PorLibro { id: string; titulo: string; autor: string; con_acceso: number; lectores_activos: number; paginas_servidas: number; avance_promedio: number | null }
interface Lector { usuario_id: string; correo: string; nombre: string | null; porcentaje: number | null; ultima_pagina_en: string | null; paginas_servidas: number; acceso: string | null }
interface LibroDeLector { libro_id: string; titulo: string; porcentaje: number | null; ultima_pagina_en: string | null; paginas_servidas: number; acceso: string | null }

const avance = (p: number | null) => p == null ? '—' : <span className="p-avance"><i style={{ width: `${Math.min(100, p)}%` }} />{Math.round(p)} %</span>

export default function Lecturas() {
  const [params, setParams] = useSearchParams()
  const [dias, setDias] = useState(30)
  const usuario = params.get('usuario')
  const libro = params.get('libro')
  const { datos, error } = useDatos(() => api<{ libros: PorLibro[] }>(`/admin/lecturas?dias=${dias}`), [dias])

  if (usuario) return <DeUnLector id={usuario} volver={() => setParams({})} />
  if (libro) return <DeUnLibro id={libro} titulo={datos?.libros.find((l) => l.id === libro)?.titulo} volver={() => setParams({})} verLector={(u) => setParams({ usuario: u })} />
  return (
    <>
      <Cabecera titulo="Quién lee qué" sub="Lectores con acceso, activos y páginas leídas por libro.">
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Periodo">
          <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option><option value={365}>Último año</option>
        </select>
      </Cabecera>
      {!datos ? <Cargando error={error} /> : datos.libros.length === 0 ? <p className="p-vacio">Aún no hay libros digitales.</p> : (
        <div className="p-tabla-envoltura">
          <table className="p-tabla">
            <thead><tr><th>Libro</th><th>Con acceso</th><th>Leyeron en el periodo</th><th>Páginas leídas</th><th>Avance promedio</th></tr></thead>
            <tbody>
              {datos.libros.map((l) => (
                <tr key={l.id} className="p-clic" onClick={() => setParams({ libro: l.id })}>
                  <td><strong>{l.titulo}</strong><br /><span className="p-tenue">{l.autor}</span></td>
                  <td>{l.con_acceso}</td><td>{l.lectores_activos}</td><td>{l.paginas_servidas}</td><td>{avance(l.avance_promedio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function DeUnLibro({ id, titulo, volver, verLector }: { id: string; titulo?: string; volver: () => void; verLector: (u: string) => void }) {
  const { datos, error } = useDatos(() => api<Lector[]>(`/admin/lecturas/libros/${id}`), [id])
  return (
    <>
      <p className="p-migas"><button className="p-enlace" onClick={volver}>Quién lee qué</button> / {titulo ?? 'Libro'}</p>
      <Cabecera titulo={titulo ?? 'Lectores del libro'} sub={datos ? `${datos.length} lector(es)` : undefined} />
      {!datos ? <Cargando error={error} /> : (
        <div className="p-tabla-envoltura">
          <table className="p-tabla">
            <thead><tr><th>Lector</th><th>Acceso</th><th>Avance</th><th>Páginas leídas</th><th>Última lectura</th></tr></thead>
            <tbody>
              {datos.map((l) => (
                <tr key={l.usuario_id} className="p-clic" onClick={() => verLector(l.usuario_id)}>
                  <td>{l.nombre || l.correo}<br /><span className="p-tenue">{l.nombre ? l.correo : ''}</span></td>
                  <td>{l.acceso ?? 'Suscripción o muestra'}</td><td>{avance(l.porcentaje)}</td><td>{l.paginas_servidas}</td><td className="p-nowrap">{fecha(l.ultima_pagina_en, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function DeUnLector({ id, volver }: { id: string; volver: () => void }) {
  const { datos, error } = useDatos(() => api<LibroDeLector[]>(`/admin/lecturas/usuarios/${id}`), [id])
  return (
    <>
      <p className="p-migas"><button className="p-enlace" onClick={volver}>Quién lee qué</button> / Lector</p>
      <Cabecera titulo="Libros de este lector" />
      {!datos ? <Cargando error={error} /> : datos.length === 0 ? <p className="p-vacio">Sin libros ni lecturas.</p> : (
        <div className="p-tabla-envoltura">
          <table className="p-tabla">
            <thead><tr><th>Libro</th><th>Acceso</th><th>Avance</th><th>Páginas leídas</th><th>Última lectura</th></tr></thead>
            <tbody>
              {datos.map((l) => (
                <tr key={l.libro_id}><td>{l.titulo}</td><td>{l.acceso ?? 'Suscripción o muestra'}</td><td>{avance(l.porcentaje)}</td><td>{l.paginas_servidas}</td><td className="p-nowrap">{fecha(l.ultima_pagina_en, true)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
