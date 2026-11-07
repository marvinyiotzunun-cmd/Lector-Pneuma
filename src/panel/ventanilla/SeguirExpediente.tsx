import { useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, fecha, NOMBRE_ESTADO, tamano, TIPO_DOCUMENTO, urlApi, type ExpedienteDetalle } from '../api'
import { Cabecera, Cargando, Insignia, useDatos, useEtapas } from '../comunes'

export default function SeguirExpediente() {
  const { codigo = '' } = useParams()
  const [busqueda] = useSearchParams()
  const { datos: exp, error, recargar } = useDatos(() => api<ExpedienteDetalle>(`/ventanilla/expedientes/${codigo}`), [codigo])
  const etapas = useEtapas()
  if (!exp) return <Cargando error={error} />
  const cerrado = exp.estado === 'rechazado' || exp.estado === 'publicado'

  return (
    <>
      <p className="p-migas"><Link to="/ventanilla">Mis obras</Link> / {exp.codigo}</p>
      {busqueda.get('nueva') && (
        <div className="p-tarjeta p-exito">
          Recibimos su solicitud. Su número de expediente es <strong>{exp.codigo}</strong>. Le enviamos la confirmación por correo.
        </div>
      )}
      <Cabecera titulo={exp.titulo} sub={<>{exp.autores} · {exp.ministerio} · <span className="p-codigo">{exp.codigo}</span></>}>
        <Insignia estado={exp.estado} />
      </Cabecera>
      {exp.estado === 'requiere_cambios' && (
        <div className="p-tarjeta p-alerta">La Dirección Editorial pidió cambios. Lea la nota en el historial y suba los documentos corregidos abajo.</div>
      )}

      <div className="p-dos">
        <section className="p-tarjeta">
          <h2>Etapas del proceso</h2>
          <ol className="p-etapas">
            {(etapas ?? []).map((et) => {
              const clase = et.numero < exp.etapa || (exp.estado === 'publicado' && et.numero === exp.etapa) ? 'hecha' : et.numero === exp.etapa ? 'actual' : ''
              return (
                <li key={et.numero} className={clase}>
                  <span className="n">{et.numero}</span>
                  <div><strong>{et.nombre}</strong>{clase === 'actual' && <p>{et.descripcion}</p>}</div>
                </li>
              )
            })}
          </ol>
        </section>
        <div className="p-columna">
          <section className="p-tarjeta">
            <h2>Historial</h2>
            <ul className="p-historial">
              {[...exp.historial].reverse().map((h) => (
                <li key={h.id}>
                  <time>{fecha(h.creado_en, true)}</time>
                  <strong>{h.tipo === 'creado' ? 'Solicitud enviada'
                    : h.tipo === 'etapa' ? `Pasó a la etapa ${h.etapa_nueva}: ${etapas?.find((e) => e.numero === h.etapa_nueva)?.nombre ?? ''}`
                    : h.tipo === 'estado' ? `Estado: ${NOMBRE_ESTADO[h.estado_nuevo!]}`
                    : h.tipo === 'documento' ? 'Documentos agregados' : 'Nota de la Dirección Editorial'}</strong>
                  {h.nota && <p>{h.nota}</p>}
                </li>
              ))}
            </ul>
          </section>
          <section className="p-tarjeta">
            <h2>Documentos</h2>
            <ul className="p-docs">
              {exp.documentos.map((d) => (
                <li key={d.id}>
                  <a href={urlApi(`/ventanilla/documentos/${d.id}`)}>{d.nombre}</a>
                  <span className="p-tenue">{TIPO_DOCUMENTO[d.tipo] ?? d.tipo} · {tamano(d.tamano)} · {fecha(d.creado_en)}</span>
                </li>
              ))}
            </ul>
            {!cerrado && <SubirDocumentos codigo={exp.codigo} alSubir={recargar} />}
          </section>
        </div>
      </div>
    </>
  )
}

function SubirDocumentos({ codigo, alSubir }: { codigo: string; alSubir: () => void }) {
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<{ t: string; error?: boolean } | null>(null)
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setEnviando(true); setMensaje(null)
    try {
      await api(`/ventanilla/expedientes/${codigo}/documentos`, { cuerpo: new FormData(form) })
      form.reset(); setMensaje({ t: 'Documentos enviados. La Dirección Editorial recibió el aviso.' }); alSubir()
    } catch (err) { setMensaje({ t: (err as Error).message, error: true }) }
    setEnviando(false)
  }
  return (
    <form className="p-subir" onSubmit={enviar}>
      <h3>Agregar documentos</h3>
      <div className="p-fila">
        <select name="tipo" defaultValue="manuscrito" aria-label="Tipo de documento">
          {['manuscrito', 'indice', 'curriculum', 'declaracion', 'carta_autorizacion', 'creditos', 'permisos', 'foto_autor', 'portada', 'pruebas', 'otro']
            .map((t) => <option key={t} value={t}>{TIPO_DOCUMENTO[t]}</option>)}
        </select>
        <input type="file" name="archivo" multiple required />
      </div>
      <textarea name="nota" rows={2} placeholder="Nota para la Dirección Editorial (opcional)" maxLength={2000} />
      {mensaje && <p className={mensaje.error ? 'error' : 'p-ok'}>{mensaje.t}</p>}
      <button className="btn" disabled={enviando}>{enviando ? 'Subiendo…' : 'Enviar documentos'}</button>
    </form>
  )
}
