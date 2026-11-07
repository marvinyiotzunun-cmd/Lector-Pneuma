import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fecha, type Rol } from '../api'
import { Aviso, Cabecera, Cargando, useDatos } from '../comunes'
import { useSesion } from '../Panel'

interface UsuarioFila { id: string; correo: string; nombre: string | null; telefono: string | null; rol: Rol
  creado_en: string; ultimo_ingreso: string | null; accesos: number; ministerios: string | null }
const ROL: Record<Rol, string> = { lector: 'Lector', ministerio: 'Ministerio', editor: 'Editor', admin: 'Administrador' }

export default function Usuarios() {
  const { usuario: yo } = useSesion()
  const [q, setQ] = useState('')
  const [buscar, setBuscar] = useState('')
  const [rol, setRol] = useState('')
  const consulta = new URLSearchParams({ ...(buscar && { q: buscar }), ...(rol && { rol }) }).toString()
  const { datos, error, recargar } = useDatos(() => api<UsuarioFila[]>(`/admin/usuarios?${consulta}`), [consulta])
  const [aviso, setAviso] = useState<{ t: string; tipo?: 'error' } | null>(null)
  const fallo = (e: unknown) => setAviso({ t: (e as Error).message, tipo: 'error' })
  const rolesPermitidos: Rol[] = yo.rol === 'admin' ? ['lector', 'ministerio', 'editor', 'admin'] : ['lector', 'ministerio']

  async function crear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    try { await api('/admin/usuarios', { cuerpo: Object.fromEntries(new FormData(form)) }); form.reset(); setAviso({ t: 'Cuenta creada. La persona entra con su correo.' }); recargar() }
    catch (err) { fallo(err) }
  }

  return (
    <>
      <Cabecera titulo="Usuarios" sub="Lectores, cuentas de ministerios y equipo editorial." />
      <div className="p-filtros">
        <form onSubmit={(e) => { e.preventDefault(); setBuscar(q.trim()) }}><input type="search" placeholder="Correo o nombre" value={q} onChange={(e) => setQ(e.target.value)} /></form>
        <select value={rol} onChange={(e) => setRol(e.target.value)} aria-label="Rol"><option value="">Todos los roles</option>{(Object.keys(ROL) as Rol[]).map((r) => <option key={r} value={r}>{ROL[r]}</option>)}</select>
      </div>
      {!datos ? <Cargando error={error} /> : (
        <div className="p-tabla-envoltura">
          <table className="p-tabla">
            <thead><tr><th>Persona</th><th>Rol</th><th>Ministerio</th><th>Libros</th><th>Último ingreso</th></tr></thead>
            <tbody>
              {datos.map((u) => {
                const bloqueado = !rolesPermitidos.includes(u.rol) || (u.id === yo.id)
                return (
                  <tr key={u.id}>
                    <td><strong>{u.nombre || '—'}</strong><br /><span className="p-tenue">{u.correo}</span></td>
                    <td>
                      <select value={u.rol} disabled={bloqueado} aria-label={`Rol de ${u.correo}`}
                        onChange={(e) => api(`/admin/usuarios/${u.id}`, { metodo: 'PATCH', cuerpo: { rol: e.target.value } }).then(() => { setAviso({ t: 'Rol cambiado.' }); recargar() }, fallo)}>
                        {(bloqueado ? [u.rol] : rolesPermitidos).map((r) => <option key={r} value={r}>{ROL[r]}</option>)}
                      </select>
                    </td>
                    <td>{u.ministerios ?? '—'}</td>
                    <td><Link to={`/admin/lecturas?usuario=${u.id}`}>{u.accesos}</Link></td>
                    <td className="p-nowrap">{fecha(u.ultimo_ingreso)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <form className="p-tarjeta p-accion" onSubmit={crear}>
        <h2>Crear cuenta</h2>
        <p className="p-tenue">Para cuentas de ministerio use la pantalla Ministerios, que además las liga y envía la invitación.</p>
        <div className="p-campos">
          <label>Correo<input name="correo" type="email" required /></label>
          <label>Nombre<input name="nombre" /></label>
          <label>Rol<select name="rol" defaultValue="lector">{rolesPermitidos.map((r) => <option key={r} value={r}>{ROL[r]}</option>)}</select></label>
        </div>
        <button className="btn secundario">Crear</button>
      </form>
      <Aviso texto={aviso?.t ?? null} tipo={aviso?.tipo} alCerrar={() => setAviso(null)} />
    </>
  )
}
