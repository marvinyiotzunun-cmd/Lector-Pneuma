import { useState, type FormEvent } from 'react'
import { api, fecha } from '../api'
import { Aviso, Cabecera, Cargando, useDatos } from '../comunes'
import type { LibroAdmin } from './libros'

interface Acceso { id: string; usuario_id: string; libro_id: string; tipo: string; vence_en: string | null; creado_en: string
  correo: string; nombre: string | null; titulo: string; vigencia: 'vigente' | 'vencido' | 'revocado' }
const TIPO: Record<string, string> = { compra: 'Compra', alquiler: 'Alquiler', canje: 'Código de canje', cortesia: 'Cortesía' }

export default function Accesos() {
  const { datos: libros } = useDatos(() => api<LibroAdmin[]>('/admin/libros'))
  const [libro, setLibro] = useState('')
  const [q, setQ] = useState('')
  const [buscar, setBuscar] = useState('')
  const consulta = new URLSearchParams({ ...(libro && { libro }), ...(buscar && { q: buscar }) }).toString()
  const { datos, error, recargar } = useDatos(() => api<Acceso[]>(`/admin/accesos?${consulta}`), [consulta])
  const [aviso, setAviso] = useState<{ t: string; tipo?: 'error' } | null>(null)
  const digitales = (libros ?? []).filter((l) => l.formato_digital)

  async function otorgar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    try {
      const r = await api<{ otorgados: string[]; ya_tenian: string[] }>('/admin/accesos', {
        cuerpo: { libro_id: f.get('libro_id'), correos: f.get('correos'), dias: f.get('dias') ? Number(f.get('dias')) : null },
      })
      form.reset()
      setAviso({ t: `Acceso otorgado a ${r.otorgados.length} persona(s).${r.ya_tenian.length ? ` ${r.ya_tenian.length} ya lo tenían.` : ''}` })
      recargar()
    } catch (err) { setAviso({ t: (err as Error).message, tipo: 'error' }) }
  }

  return (
    <>
      <Cabecera titulo="Accesos al lector" sub="Quién puede leer cada libro. Las compras, alquileres y canjes llegan solos; aquí se dan cortesías." />
      <form className="p-tarjeta p-accion" onSubmit={otorgar}>
        <h2>Dar acceso de cortesía</h2>
        <div className="p-campos">
          <label className="ancho">Libro
            <select name="libro_id" required defaultValue=""><option value="" disabled>Elija un libro digital</option>{digitales.map((l) => <option key={l.id} value={l.id}>{l.titulo}</option>)}</select>
          </label>
          <label className="ancho">Correos<textarea name="correos" rows={3} required placeholder="Uno o varios, separados por coma o en líneas distintas" /></label>
          <label>Días de acceso<input name="dias" type="number" min={1} placeholder="Vacío = permanente" /></label>
        </div>
        <p className="p-tenue">Si alguien todavía no tiene cuenta, se crea con su correo; al entrar verá el libro en su biblioteca.</p>
        <button className="btn">Dar acceso</button>
      </form>
      <div className="p-filtros">
        <select value={libro} onChange={(e) => setLibro(e.target.value)} aria-label="Libro"><option value="">Todos los libros</option>{digitales.map((l) => <option key={l.id} value={l.id}>{l.titulo}</option>)}</select>
        <form onSubmit={(e) => { e.preventDefault(); setBuscar(q.trim()) }}><input type="search" placeholder="Correo, nombre o libro" value={q} onChange={(e) => setQ(e.target.value)} /></form>
      </div>
      {!datos ? <Cargando error={error} /> : datos.length === 0 ? <p className="p-vacio">No hay accesos con estos filtros.</p> : (
        <div className="p-tabla-envoltura">
          <table className="p-tabla">
            <thead><tr><th>Persona</th><th>Libro</th><th>Tipo</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {datos.map((a) => (
                <tr key={a.id} className={a.vigencia !== 'vigente' ? 'inactivo' : ''}>
                  <td>{a.nombre || a.correo}<br /><span className="p-tenue">{a.nombre ? a.correo : ''}</span></td>
                  <td>{a.titulo}</td>
                  <td>{TIPO[a.tipo] ?? a.tipo}</td>
                  <td className="p-nowrap">{a.vence_en ? fecha(a.vence_en) : 'Permanente'}</td>
                  <td>{a.vigencia === 'vigente' ? 'Vigente' : a.vigencia === 'vencido' ? 'Vencido' : 'Revocado'}</td>
                  <td>{a.vigencia === 'vigente' && <button className="p-enlace peligro" onClick={() => confirm(`¿Quitar a ${a.correo} el acceso a «${a.titulo}»?`) &&
                    api(`/admin/accesos/${a.id}`, { metodo: 'DELETE' }).then(() => { setAviso({ t: 'Acceso quitado.' }); recargar() }, (e) => setAviso({ t: e.message, tipo: 'error' }))}>Quitar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Aviso texto={aviso?.t ?? null} tipo={aviso?.tipo} alCerrar={() => setAviso(null)} />
    </>
  )
}
