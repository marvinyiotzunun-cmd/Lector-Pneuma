import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, quetzales } from '../api'
import { Cabecera, Cargando, useDatos } from '../comunes'
import { siNo, type LibroAdmin } from './libros'

export default function Libros() {
  const { datos, error } = useDatos(() => api<LibroAdmin[]>('/admin/libros'))
  const [q, setQ] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const lista = (datos ?? []).filter((l) => !q || `${l.titulo} ${l.autor} ${l.ministerio ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <Cabecera titulo="Libros" sub="Catálogo del sitio (impresos) y obras del lector (digital).">
        <button className="btn" onClick={() => setNuevo(true)}>Agregar libro</button>
      </Cabecera>
      {nuevo && <NuevoLibro alCerrar={() => setNuevo(false)} />}
      <div className="p-filtros"><input type="search" placeholder="Buscar por título, autor o ministerio" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!datos ? <Cargando error={error} /> : lista.length === 0 ? <p className="p-vacio">No hay libros.</p> : (
        <div className="p-tabla-envoltura">
          <table className="p-tabla">
            <thead><tr><th></th><th>Libro</th><th>Impreso</th><th>Digital</th><th>Sitio</th></tr></thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.id}>
                  <td className="p-mini-portada">{l.portada_url ? <img src={l.portada_url} alt="" /> : <span style={{ background: l.color ?? 'var(--pneuma-navy)' }} />}</td>
                  <td><Link to={`/admin/libros/${l.id}`}><strong>{l.titulo}</strong></Link><br /><span className="p-tenue">{l.autor}{l.ministerio ? ` · ${l.ministerio}` : ''}</span></td>
                  <td>{siNo(l.impreso) ? quetzales(l.precio_impreso_gtq) : '—'}</td>
                  <td>{l.formato_digital ? <>{l.formato_digital.toUpperCase()} · {l.total_paginas_digital ? `${l.total_paginas_digital} p.` : 'sin cargar'}{siNo(l.digital_activo) ? '' : ' · inactivo'}</> : '—'}</td>
                  <td>{siNo(l.publicado) ? <span className="p-insignia e-publicado">Publicado</span> : <span className="p-insignia e-en_pausa">Borrador</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function NuevoLibro({ alCerrar }: { alCerrar: () => void }) {
  const ir = useNavigate()
  const [error, setError] = useState<string | null>(null)
  async function crear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      const l = await api<LibroAdmin>('/admin/libros', { cuerpo: { titulo: f.get('titulo'), autor: f.get('autor'), ministerio: f.get('ministerio') || null } })
      ir(`/admin/libros/${l.id}`)
    } catch (err) { setError((err as Error).message) }
  }
  return (
    <form className="p-tarjeta p-accion" onSubmit={crear}>
      <h2>Libro nuevo</h2>
      <div className="p-campos">
        <label className="ancho">Título<input name="titulo" required /></label>
        <label>Autor<input name="autor" required /></label>
        <label>Ministerio<input name="ministerio" /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="p-fila"><button className="btn">Crear y completar la ficha</button><button type="button" className="btn secundario" onClick={alCerrar}>Cancelar</button></div>
    </form>
  )
}
