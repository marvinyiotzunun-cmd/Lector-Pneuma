import { useState, type FormEvent } from 'react'
import { api, fecha } from '../api'
import { Aviso, Cabecera, Cargando, useDatos } from '../comunes'

interface MinisterioFila { id: string; nombre: string; siglas: string | null; contacto_nombre: string | null; contacto_correo: string | null
  contacto_telefono: string | null; activo: number; cuentas: number; expedientes: number; abiertos: number }
interface Miembro { id: string; correo: string; nombre: string | null; cargo: string | null; ultimo_ingreso: string | null }

export default function Ministerios() {
  const { datos, error, recargar } = useDatos(() => api<MinisterioFila[]>('/admin/ministerios'))
  const [abierto, setAbierto] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ t: string; tipo?: 'error' } | null>(null)
  const fallo = (e: unknown) => setAviso({ t: (e as Error).message, tipo: 'error' })

  async function crear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    try { await api('/admin/ministerios', { cuerpo: Object.fromEntries(new FormData(form)) }); form.reset(); setAviso({ t: 'Ministerio creado. Ahora ábrale cuentas.' }); recargar() }
    catch (err) { fallo(err) }
  }

  if (!datos) return <Cargando error={error} />
  return (
    <>
      <Cabecera titulo="Ministerios" sub="Cada ministerio presenta sus obras desde sus propias cuentas." />
      <form className="p-tarjeta p-accion" onSubmit={crear}>
        <h2>Agregar ministerio</h2>
        <div className="p-campos">
          <label className="ancho">Nombre<input name="nombre" required /></label>
          <label>Siglas<input name="siglas" /></label>
          <label>Contacto<input name="contacto_nombre" /></label>
          <label>Correo del ministerio<input name="contacto_correo" type="email" /></label>
          <label>Teléfono<input name="contacto_telefono" /></label>
        </div>
        <button className="btn secundario">Agregar</button>
      </form>
      <div className="p-lista">
        {datos.map((m) => (
          <div key={m.id} className={`p-tarjeta${m.activo ? '' : ' inactivo'}`}>
            <div className="p-fila-sep">
              <div><strong>{m.nombre}</strong>{m.siglas && <span className="p-tenue"> · {m.siglas}</span>}<br />
                <span className="p-tenue">{m.cuentas} cuenta(s) · {m.expedientes} expediente(s), {m.abiertos} abierto(s){m.contacto_correo ? ` · ${m.contacto_correo}` : ''}</span></div>
              <div className="p-fila">
                <button className="btn secundario" onClick={() => setAbierto(abierto === m.id ? null : m.id)}>{abierto === m.id ? 'Cerrar' : 'Cuentas'}</button>
                <button className="p-enlace" onClick={() => api(`/admin/ministerios/${m.id}`, { metodo: 'PATCH', cuerpo: { activo: !m.activo } }).then(recargar, fallo)}>{m.activo ? 'Desactivar' : 'Activar'}</button>
              </div>
            </div>
            {abierto === m.id && <Miembros ministerio={m} alCambiar={(t) => { setAviso({ t }); recargar() }} alFallar={fallo} />}
          </div>
        ))}
      </div>
      <Aviso texto={aviso?.t ?? null} tipo={aviso?.tipo} alCerrar={() => setAviso(null)} />
    </>
  )
}

function Miembros({ ministerio, alCambiar, alFallar }: { ministerio: MinisterioFila; alCambiar: (t: string) => void; alFallar: (e: unknown) => void }) {
  const { datos, recargar } = useDatos(() => api<Miembro[]>(`/admin/ministerios/${ministerio.id}/miembros`), [ministerio.id])
  async function agregar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    try {
      await api(`/admin/ministerios/${ministerio.id}/miembros`, { cuerpo: { correo: f.get('correo'), nombre: f.get('nombre'), cargo: f.get('cargo'), invitar: f.has('invitar') } })
      form.reset(); recargar(); alCambiar('Cuenta agregada. Se le envió la invitación por correo.')
    } catch (err) { alFallar(err) }
  }
  return (
    <div className="p-sub">
      {!datos ? <Cargando /> : datos.length === 0 ? <p className="p-tenue">Sin cuentas todavía.</p> : (
        <ul className="p-docs">
          {datos.map((u) => (
            <li key={u.id}>
              <strong>{u.nombre || u.correo}</strong>
              <span className="p-tenue">{u.correo}{u.cargo ? ` · ${u.cargo}` : ''} · {u.ultimo_ingreso ? `entró el ${fecha(u.ultimo_ingreso)}` : 'no ha entrado'}</span>
              <button className="p-enlace peligro" onClick={() => confirm(`¿Quitar a ${u.correo} de ${ministerio.nombre}?`) &&
                api(`/admin/ministerios/${ministerio.id}/miembros/${u.id}`, { metodo: 'DELETE' }).then(() => { recargar(); alCambiar('Cuenta quitada del ministerio.') }, alFallar)}>Quitar</button>
            </li>
          ))}
        </ul>
      )}
      <form className="p-subir" onSubmit={agregar}>
        <h3>Abrir una cuenta</h3>
        <div className="p-campos">
          <label>Correo<input name="correo" type="email" required /></label>
          <label>Nombre<input name="nombre" /></label>
          <label>Cargo<input name="cargo" placeholder="Director, secretaria…" /></label>
        </div>
        <label className="p-check"><input type="checkbox" name="invitar" defaultChecked /> Enviarle la invitación por correo</label>
        <button className="btn secundario">Agregar cuenta</button>
      </form>
    </div>
  )
}
