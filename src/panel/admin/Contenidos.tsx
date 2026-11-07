import { useState, type FormEvent } from 'react'
import { api, fecha, tamano, urlApi } from '../api'
import { Aviso, Cabecera, Cargando, useDatos } from '../comunes'

interface Contenido { clave: string; titulo: string; cuerpo: string; publicado: number; actualizado_en: string; actualizado_por_nombre: string | null }
interface Formato { id: string; nombre: string; descripcion: string; nombre_archivo: string; tamano: number; orden: number; publicado: number }

// Páginas que el sitio espera (acordado con el sitio web).
const CLAVES: Record<string, string> = { inicio: 'Frase de la portada', 'quienes-somos': 'Quiénes somos', proceso: 'Proceso de publicación (introducción)', contacto: 'Contacto' }

export default function Contenidos() {
  const { datos, error, recargar } = useDatos(() => api<Contenido[]>('/admin/contenidos'))
  const { datos: formatos, recargar: recargarFormatos } = useDatos(() => api<Formato[]>('/admin/formatos'))
  const [abierta, setAbierta] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ t: string; tipo?: 'error' } | null>(null)
  const [publicando, setPublicando] = useState(false)
  const fallo = (e: unknown) => setAviso({ t: (e as Error).message, tipo: 'error' })

  async function publicar() {
    setPublicando(true)
    try { await api('/admin/sitio/reconstruir', { cuerpo: {} }); setAviso({ t: 'El sitio se está reconstruyendo; los cambios se verán en uno o dos minutos.' }) }
    catch (e) { fallo(e) }
    setPublicando(false)
  }

  if (!datos) return <Cargando error={error} />
  const faltantes = Object.keys(CLAVES).filter((k) => !datos.some((d) => d.clave === k))
  return (
    <>
      <Cabecera titulo="Contenidos del sitio" sub="Los textos y formatos que muestra el sitio de Pneuma. Después de cambiar algo, publique los cambios.">
        <button className="btn" onClick={publicar} disabled={publicando}>
          {publicando ? 'Publicando…' : 'Publicar cambios en el sitio'}
        </button>
      </Cabecera>
      <h2 className="p-seccion">Páginas</h2>
      <div className="p-lista">
        {[...datos, ...faltantes.map((k) => ({ clave: k, titulo: CLAVES[k], cuerpo: '', publicado: 1, actualizado_en: '', actualizado_por_nombre: null }))].map((c) => (
          <div key={c.clave} className="p-tarjeta">
            <div className="p-fila-sep">
              <div><strong>{c.titulo}</strong> <span className="p-tenue">· {CLAVES[c.clave] ?? c.clave}{c.actualizado_en ? ` · ${fecha(c.actualizado_en)}${c.actualizado_por_nombre ? ` por ${c.actualizado_por_nombre}` : ''}` : ' · sin texto todavía'}</span></div>
              <button className="btn secundario" onClick={() => setAbierta(abierta === c.clave ? null : c.clave)}>{abierta === c.clave ? 'Cerrar' : 'Editar'}</button>
            </div>
            {abierta === c.clave && <EditarPagina contenido={c} alGuardar={async (cuerpo) => {
              try { await api(`/admin/contenidos/${c.clave}`, { metodo: 'PUT', cuerpo }); setAviso({ t: 'Página guardada. Publique los cambios para verlos en el sitio.' }); setAbierta(null); recargar() }
              catch (e) { fallo(e) }
            }} />}
          </div>
        ))}
      </div>

      <h2 className="p-seccion">Formatos oficiales para descargar</h2>
      <div className="p-tarjeta">
        {!formatos ? <Cargando /> : formatos.length === 0 ? <p className="p-tenue">Aún no hay formatos.</p> : (
          <ul className="p-docs">
            {formatos.map((f) => (
              <li key={f.id}>
                <a href={urlApi(`/formatos/${f.id}/archivo`)}>{f.nombre}</a>
                <span className="p-tenue">{f.nombre_archivo} · {tamano(f.tamano)}{f.publicado ? '' : ' · oculto'}</span>
                <span className="p-fila">
                  <button className="p-enlace" onClick={() => api(`/admin/formatos/${f.id}`, { metodo: 'PATCH', cuerpo: { publicado: !f.publicado } }).then(recargarFormatos, fallo)}>{f.publicado ? 'Ocultar' : 'Mostrar'}</button>
                  <button className="p-enlace peligro" onClick={() => confirm(`¿Borrar «${f.nombre}»?`) && api(`/admin/formatos/${f.id}`, { metodo: 'DELETE' }).then(recargarFormatos, fallo)}>Borrar</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <SubirFormato alSubir={() => { setAviso({ t: 'Formato agregado.' }); recargarFormatos() }} alFallar={fallo} />
      </div>
      <Aviso texto={aviso?.t ?? null} tipo={aviso?.tipo} alCerrar={() => setAviso(null)} />
    </>
  )
}

function EditarPagina({ contenido, alGuardar }: { contenido: Contenido; alGuardar: (c: { titulo: string; cuerpo: string; publicado: boolean }) => void }) {
  const [titulo, setTitulo] = useState(contenido.titulo)
  const [cuerpo, setCuerpo] = useState(contenido.cuerpo)
  const [publicado, setPublicado] = useState(!!contenido.publicado)
  return (
    <form className="p-editor" onSubmit={(e) => { e.preventDefault(); alGuardar({ titulo, cuerpo, publicado }) }}>
      <label>Título<input value={titulo} onChange={(e) => setTitulo(e.target.value)} required /></label>
      <label>Texto <span className="p-tenue">(Markdown: # Título, **negrita**, - lista, [enlace](https://…))</span>
        <textarea rows={12} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} /></label>
      <label className="p-check"><input type="checkbox" checked={publicado} onChange={(e) => setPublicado(e.target.checked)} /> Visible en el sitio</label>
      <button className="btn">Guardar</button>
    </form>
  )
}

function SubirFormato({ alSubir, alFallar }: { alSubir: () => void; alFallar: (e: unknown) => void }) {
  const [ocupado, setOcupado] = useState(false)
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    setOcupado(true)
    try { await api('/admin/formatos', { cuerpo: new FormData(f) }); f.reset(); alSubir() } catch (err) { alFallar(err) }
    setOcupado(false)
  }
  return (
    <form className="p-subir" onSubmit={enviar}>
      <h3>Agregar formato</h3>
      <div className="p-campos">
        <label>Nombre<input name="nombre" required placeholder="Carta de Autorización" /></label>
        <label>Orden<input name="orden" type="number" defaultValue={0} /></label>
        <label className="ancho">Descripción<input name="descripcion" placeholder="Para qué sirve y quién lo firma" /></label>
        <label className="ancho">Archivo<input name="archivo" type="file" required /></label>
      </div>
      <button className="btn secundario" disabled={ocupado}>{ocupado ? 'Subiendo…' : 'Agregar'}</button>
    </form>
  )
}
