import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fecha, NOMBRE_DICTAMEN, NOMBRE_ESTADO, REVISION, tamano, TIPO_DOCUMENTO, urlApi, type Dictamen, type Estado, type Etapa, type ExpedienteDetalle, type Usuario } from '../api'
import { Aviso, Cabecera, Cargando, Insignia, Linea, useDatos } from '../comunes'

export default function ExpedienteEditorial() {
  const { id = '' } = useParams()
  const { datos: exp, error, recargar } = useDatos(() => api<ExpedienteDetalle>(`/admin/expedientes/${id}`), [id])
  const { datos: etapas } = useDatos(() => api<Etapa[]>('/admin/etapas'))
  const { datos: editores } = useDatos(() => Promise.all([
    api<Usuario[]>('/admin/usuarios?rol=editor'), api<Usuario[]>('/admin/usuarios?rol=admin'),
  ]).then(([a, b]) => [...a, ...b]))
  const [aviso, setAviso] = useState<{ t: string; tipo?: 'error' } | null>(null)
  if (!exp) return <Cargando error={error} />

  const hacer = async (ruta: string, cuerpo: unknown, ok: string, metodo = 'POST') => {
    try { await api(`/admin/expedientes/${exp.id}${ruta}`, { metodo, cuerpo }); setAviso({ t: ok }); await recargar(); return true }
    catch (e) { setAviso({ t: (e as Error).message, tipo: 'error' }); return false }
  }
  const nombreEtapa = (n: number | null) => etapas?.find((e) => e.numero === n)?.nombre ?? `Etapa ${n}`

  return (
    <>
      <p className="p-migas"><Link to="/editorial">Tablero</Link> / <Link to="/editorial/expedientes">Expedientes</Link> / {exp.codigo}</p>
      <Cabecera titulo={exp.titulo} sub={<><span className="p-codigo">{exp.codigo}</span> · {exp.autores} · {exp.ministerio}</>}>
        {exp.dictamen && <span className="p-insignia">Dictamen: {NOMBRE_DICTAMEN[exp.dictamen]}</span>}
        <Insignia estado={exp.estado} />
      </Cabecera>
      <div className="p-tarjeta">
        <div className="p-fila-sep"><strong>Etapa {exp.etapa} de {etapas?.length ?? '…'} · {exp.etapa_nombre}</strong><span className="p-tenue">Recibido {fecha(exp.creado_en)}</span></div>
        <Linea etapa={exp.etapa} estado={exp.estado} />
      </div>

      <div className="p-dos">
        <div className="p-columna">
          <MoverEtapa exp={exp} etapas={etapas ?? []} alMover={(etapa, nota, avisar) =>
            hacer('/etapa', { etapa, nota, avisar }, avisar ? 'Etapa cambiada. Se avisó al ministerio por correo.' : 'Etapa cambiada.')} />
          <CambiarEstado exp={exp} alCambiar={(estado, nota) => hacer('/estado', { estado, nota }, `Estado: ${NOMBRE_ESTADO[estado]}. Se avisó al ministerio.`)} />
          <Nota alGuardar={(nota, visible) => hacer('/notas', { nota, visible_ministerio: visible }, visible ? 'Nota enviada al ministerio.' : 'Nota interna guardada.')} />

          <section className="p-tarjeta">
            <h2>Historial</h2>
            <ul className="p-historial">
              {[...exp.historial].reverse().map((h) => (
                <li key={h.id} className={h.visible_ministerio ? '' : 'interna'}>
                  <time>{fecha(h.creado_en, true)}{h.autor ? ` · ${h.autor}` : ''}{!h.visible_ministerio && ' · interna'}{h.correo_enviado ? ' · ✉' : ''}</time>
                  <strong>{h.tipo === 'creado' ? 'Solicitud recibida'
                    : h.tipo === 'etapa' ? `Etapa ${h.etapa_anterior} → ${h.etapa_nueva}: ${nombreEtapa(h.etapa_nueva)}`
                    : h.tipo === 'estado' ? `Estado: ${NOMBRE_ESTADO[h.estado_nuevo!]}` : h.tipo === 'documento' ? 'Documentos' : 'Nota'}</strong>
                  {h.nota && <p>{h.nota}</p>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="p-columna">
          <section className="p-tarjeta">
            <h2>Ficha</h2>
            <dl className="p-ficha-datos">
              <dt>Ministerio</dt><dd>{exp.ministerio}</dd>
              <dt>Solicitante</dt><dd>{exp.solicitante?.nombre ?? '—'}<br /><span className="p-tenue">{exp.solicitante?.correo}{exp.solicitante?.telefono ? ` · ${exp.solicitante.telefono}` : ''}</span></dd>
              {exp.subtitulo && <><dt>Subtítulo</dt><dd>{exp.subtitulo}</dd></>}
              <dt>Género</dt><dd>{exp.genero ?? '—'}</dd>
              <dt>Público</dt><dd>{exp.publico ?? '—'}</dd>
              <dt>Modalidad</dt><dd>{{ impreso: 'Impreso', digital: 'Digital', ambos: 'Impreso y digital' }[exp.modalidad]}</dd>
              <dt>Páginas</dt><dd>{exp.paginas_aprox ?? '—'}</dd>
              <dt>Tiraje</dt><dd>{exp.tiraje_estimado ?? '—'}</dd>
              <dt>Sinopsis</dt><dd className="p-pre">{exp.sinopsis}</dd>
              {exp.semblanza_autor && <><dt>Sobre el autor</dt><dd className="p-pre">{exp.semblanza_autor}</dd></>}
            </dl>
          </section>
          <Asignar exp={exp} editores={editores ?? []} alGuardar={(c) => hacer('', c, 'Datos guardados.', 'PATCH')} />
          <section className="p-tarjeta">
            <h2>Documentos</h2>
            <ul className="p-docs">
              {exp.documentos.map((d) => (
                <li key={d.id}>
                  <a href={urlApi(`/admin/expedientes/documentos/${d.id}`)}>{d.nombre}</a>
                  <span className="p-tenue">{TIPO_DOCUMENTO[d.tipo] ?? d.tipo} · {tamano(d.tamano)} · {fecha(d.creado_en)}{d.subido_por ? ` · ${d.subido_por}` : ''}</span>
                </li>
              ))}
            </ul>
            <AdjuntarEditorial id={exp.id} alSubir={() => { setAviso({ t: 'Documento adjuntado.' }); recargar() }} alFallar={(t) => setAviso({ t, tipo: 'error' })} />
          </section>
        </div>
      </div>
      <Aviso texto={aviso?.t ?? null} tipo={aviso?.tipo} alCerrar={() => setAviso(null)} />
    </>
  )
}

function MoverEtapa({ exp, etapas, alMover }: { exp: ExpedienteDetalle; etapas: Etapa[]; alMover: (e: number, nota: string, avisar: boolean) => Promise<boolean> }) {
  const ultima = etapas.length ? etapas[etapas.length - 1].numero : exp.etapa + 1
  const [etapa, setEtapa] = useState(Math.min(exp.etapa + 1, ultima))
  const publica = etapas.find((e) => e.publica)?.numero ?? ultima
  const [nota, setNota] = useState('')
  const [avisar, setAvisar] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const cerrado = exp.estado === 'rechazado'
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (etapa >= publica && exp.etapa < publica && !confirm('Esta etapa marca la obra como publicada. ¿Continuar?')) return
    setOcupado(true)
    if (await alMover(etapa, nota, avisar)) setNota('')
    setOcupado(false)
  }
  return (
    <form className="p-tarjeta p-accion" onSubmit={enviar}>
      <h2>Mover de etapa</h2>
      <select value={etapa} onChange={(e) => setEtapa(Number(e.target.value))} disabled={cerrado}>
        {etapas.map((et) => <option key={et.numero} value={et.numero} disabled={et.numero === exp.etapa}>{et.numero}. {et.nombre}{et.numero === exp.etapa ? ' (actual)' : ''}</option>)}
      </select>
      <textarea rows={3} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Mensaje para el ministerio (va en el correo)" disabled={cerrado} />
      <label className="p-check"><input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} /> Avisar al ministerio por correo</label>
      <button className="btn" disabled={ocupado || cerrado}>{ocupado ? 'Guardando…' : 'Cambiar etapa'}</button>
      {cerrado && <p className="p-tenue">La obra no fue aprobada. Reanude el expediente para moverlo.</p>}
    </form>
  )
}

function CambiarEstado({ exp, alCambiar }: { exp: ExpedienteDetalle; alCambiar: (e: Estado, nota: string) => Promise<boolean> }) {
  const [nota, setNota] = useState('')
  const opciones: Estado[] = (['en_curso', 'requiere_cambios', 'en_pausa', 'rechazado'] as Estado[]).filter((e) => e !== exp.estado)
  if (exp.estado === 'publicado') return null
  const pedir = async (e: Estado) => {
    if ((e === 'requiere_cambios' || e === 'rechazado') && !nota.trim()) { alert('Escriba en la nota qué debe cambiar el ministerio o por qué no se aprobó.'); return }
    if (e === 'rechazado' && !confirm('¿Marcar la obra como no aprobada? Se avisará al ministerio.')) return
    if (await alCambiar(e, nota)) setNota('')
  }
  return (
    <section className="p-tarjeta p-accion">
      <h2>Estado</h2>
      <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Explicación para el ministerio" />
      <div className="p-fila">
        {opciones.map((e) => (
          <button key={e} type="button" className={`btn secundario${e === 'rechazado' ? ' peligro' : ''}`} onClick={() => pedir(e)}>
            {{ en_curso: 'Reanudar', requiere_cambios: 'Pedir cambios', en_pausa: 'Pausar', rechazado: 'No aprobar', publicado: '' }[e]}
          </button>
        ))}
      </div>
    </section>
  )
}

function Nota({ alGuardar }: { alGuardar: (nota: string, visible: boolean) => Promise<boolean> }) {
  const [nota, setNota] = useState('')
  const [visible, setVisible] = useState(false)
  return (
    <form className="p-tarjeta p-accion" onSubmit={async (e) => { e.preventDefault(); if (await alGuardar(nota, visible)) setNota('') }}>
      <h2>Agregar nota</h2>
      <textarea rows={2} required value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Revisor asignado, observaciones de la Junta…" />
      <label className="p-check"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible para el ministerio (se le avisa por correo)</label>
      <button className="btn secundario">Guardar nota</button>
    </form>
  )
}

function Asignar({ exp, editores, alGuardar }: { exp: ExpedienteDetalle; editores: Usuario[]; alGuardar: (c: Record<string, unknown>) => Promise<boolean> }) {
  const [revision, setRevision] = useState(exp.revision ?? '')
  const [responsable, setResponsable] = useState(exp.responsable_id ?? '')
  const [dictamen, setDictamen] = useState<Dictamen | ''>(exp.dictamen ?? '')
  const [notaDictamen, setNotaDictamen] = useState('')
  const [libro, setLibro] = useState(exp.libro_id ?? '')
  const cambiaDictamen = dictamen !== (exp.dictamen ?? '')
  return (
    <form className="p-tarjeta p-accion" onSubmit={async (e) => {
      e.preventDefault()
      if (await alGuardar({ revision, responsable_id: responsable, libro_id: libro, ...(cambiaDictamen && dictamen ? { dictamen, nota: notaDictamen } : {}) })) setNotaDictamen('')
    }}>
      <h2>Revisión y dictamen</h2>
      <label>Modalidad de revisión
        <select value={revision} onChange={(e) => setRevision(e.target.value)}>
          <option value="">Sin asignar</option>
          {Object.entries(REVISION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Responsable
        <select value={responsable} onChange={(e) => setResponsable(e.target.value)}>
          <option value="">Sin asignar</option>
          {editores.map((u) => <option key={u.id} value={u.id}>{u.nombre || u.correo}</option>)}
        </select>
      </label>
      <label>Dictamen de la Junta Editorial
        <select value={dictamen} onChange={(e) => setDictamen(e.target.value as Dictamen | '')}>
          <option value="">Pendiente</option>
          {(Object.keys(NOMBRE_DICTAMEN) as Dictamen[]).map((d) => <option key={d} value={d}>{NOMBRE_DICTAMEN[d]}</option>)}
        </select>
      </label>
      {cambiaDictamen && dictamen && <>
        <textarea rows={2} value={notaDictamen} onChange={(e) => setNotaDictamen(e.target.value)} placeholder="Observaciones del dictamen para el ministerio" />
        <p className="p-tenue">Al guardar, el dictamen queda en el historial y se avisa al ministerio por correo.</p>
      </>}
      <label>Libro del catálogo (al publicar)
        <input value={libro} onChange={(e) => setLibro(e.target.value)} placeholder="Id del libro" />
      </label>
      <button className="btn secundario">Guardar</button>
    </form>
  )
}

function AdjuntarEditorial({ id, alSubir, alFallar }: { id: string; alSubir: () => void; alFallar: (t: string) => void }) {
  const [ocupado, setOcupado] = useState(false)
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    setOcupado(true)
    try { await api(`/admin/expedientes/${id}/documentos`, { cuerpo: new FormData(f) }); f.reset(); alSubir() }
    catch (err) { alFallar((err as Error).message) }
    setOcupado(false)
  }
  return (
    <form className="p-subir" onSubmit={enviar}>
      <h3>Adjuntar</h3>
      <div className="p-fila">
        <select name="tipo" defaultValue="dictamen" aria-label="Tipo">
          {Object.entries(TIPO_DOCUMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="file" name="archivo" multiple required />
      </div>
      <label className="p-check"><input type="checkbox" name="visible_ministerio" value="1" /> Mostrar en el historial del ministerio</label>
      <button className="btn secundario" disabled={ocupado}>{ocupado ? 'Subiendo…' : 'Adjuntar'}</button>
    </form>
  )
}
