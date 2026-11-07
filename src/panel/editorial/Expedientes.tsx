import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fecha, NOMBRE_ESTADO, type Estado, type Etapa, type Expediente } from '../api'
import { Cabecera, Cargando, Insignia, Linea, useDatos } from '../comunes'

export default function Expedientes() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const consulta = params.toString()
  const { datos, error } = useDatos(() => api<Expediente[]>(`/admin/expedientes?${consulta}`), [consulta])
  const { datos: etapas } = useDatos(() => api<Etapa[]>('/admin/etapas'))
  const { datos: ministerios } = useDatos(() => api<{ id: string; nombre: string }[]>('/admin/ministerios'))
  const poner = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p) }

  return (
    <>
      <Cabecera titulo="Expedientes" sub={datos ? `${datos.length} expediente(s)` : undefined} />
      <div className="p-filtros">
        <form onSubmit={(e) => { e.preventDefault(); poner('q', q.trim()) }}>
          <input type="search" placeholder="Código, título, autor o ministerio" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <select value={params.get('etapa') ?? ''} onChange={(e) => poner('etapa', e.target.value)} aria-label="Etapa">
          <option value="">Todas las etapas</option>
          {etapas?.map((e) => <option key={e.numero} value={e.numero}>{e.numero}. {e.nombre}</option>)}
        </select>
        <select value={params.get('estado') ?? ''} onChange={(e) => poner('estado', e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {(Object.keys(NOMBRE_ESTADO) as Estado[]).map((k) => <option key={k} value={k}>{NOMBRE_ESTADO[k]}</option>)}
        </select>
        <select value={params.get('ministerio') ?? ''} onChange={(e) => poner('ministerio', e.target.value)} aria-label="Ministerio">
          <option value="">Todos los ministerios</option>
          {ministerios?.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
        <label className="p-check"><input type="checkbox" checked={params.get('atrasados') === '1'} onChange={(e) => poner('atrasados', e.target.checked ? '1' : '')} /> Solo atrasados</label>
      </div>
      {!datos ? <Cargando error={error} /> : datos.length === 0 ? <p className="p-vacio">No hay expedientes con estos filtros.</p> : (
        <div className="p-tabla-envoltura">
          <table className="p-tabla">
            <thead><tr><th>Expediente</th><th>Obra</th><th>Ministerio</th><th>Etapa</th><th>Estado</th><th>Días en la etapa</th><th>Actualizado</th></tr></thead>
            <tbody>
              {datos.map((e) => {
                const tarde = e.estado === 'en_curso' && e.dias_estimados != null && (e.dias_en_etapa ?? 0) > e.dias_estimados
                return (
                  <tr key={e.id}>
                    <td><Link to={`/editorial/${e.id}`} className="p-codigo">{e.codigo}</Link></td>
                    <td><Link to={`/editorial/${e.id}`}><strong>{e.titulo}</strong></Link><br /><span className="p-tenue">{e.autores}</span></td>
                    <td>{e.ministerio}</td>
                    <td><span className="p-nowrap">{e.etapa}. {e.etapa_nombre}</span><Linea etapa={e.etapa} estado={e.estado} /></td>
                    <td><Insignia estado={e.estado} /></td>
                    <td className={tarde ? 'error' : ''}>{e.dias_en_etapa}{e.dias_estimados ? ` / ${e.dias_estimados}` : ''}</td>
                    <td className="p-nowrap">{fecha(e.actualizado_en)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
