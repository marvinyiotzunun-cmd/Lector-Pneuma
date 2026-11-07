import { useState } from 'react'
import { api, type Etapa } from '../api'
import { Aviso, Cabecera, Cargando, olvidarEtapas, useDatos } from '../comunes'

export default function Etapas() {
  const { datos, error, recargar } = useDatos(() => api<Etapa[]>('/admin/etapas'))
  const [aviso, setAviso] = useState<{ t: string; tipo?: 'error' } | null>(null)
  const hecho = (t: string) => { olvidarEtapas(); setAviso({ t }); recargar() }
  const fallo = (e: unknown) => setAviso({ t: (e as Error).message, tipo: 'error' })
  if (!datos) return <Cargando error={error} />
  const ultima = datos[datos.length - 1]
  return (
    <>
      <Cabecera titulo="Etapas del proceso" sub="Los nombres y plazos que ven los ministerios, el sitio y los correos. Un expediente que pasa el plazo de su etapa aparece como atrasado." />
      <div className="p-lista">
        {datos.map((et) => <FilaEtapa key={et.numero} etapa={et} alGuardar={(c) =>
          api(`/admin/etapas/${et.numero}`, { metodo: 'PUT', cuerpo: c }).then(() => hecho(`Etapa ${et.numero} guardada.`), fallo)} />)}
      </div>
      <div className="p-fila" style={{ marginTop: 16 }}>
        <button className="btn secundario" onClick={() => {
          const nombre = prompt('Nombre de la etapa nueva (se agrega al final):')
          if (nombre?.trim()) api('/admin/etapas', { cuerpo: { nombre } }).then(() => hecho('Etapa agregada.'), fallo)
        }}>Agregar etapa al final</button>
        {ultima && <button className="p-enlace peligro" onClick={() => confirm(`¿Quitar la etapa ${ultima.numero}, «${ultima.nombre}»?`) &&
          api(`/admin/etapas/${ultima.numero}`, { metodo: 'DELETE' }).then(() => hecho('Etapa quitada.'), fallo)}>Quitar la última etapa</button>}
      </div>
      <Aviso texto={aviso?.t ?? null} tipo={aviso?.tipo} alCerrar={() => setAviso(null)} />
    </>
  )
}

function FilaEtapa({ etapa, alGuardar }: { etapa: Etapa; alGuardar: (c: Record<string, unknown>) => void }) {
  const [nombre, setNombre] = useState(etapa.nombre)
  const [descripcion, setDescripcion] = useState(etapa.descripcion)
  const [responsable, setResponsable] = useState(etapa.responsable ?? '')
  const [dias, setDias] = useState(etapa.dias_estimados?.toString() ?? '')
  const [publica, setPublica] = useState(!!etapa.publica)
  const cambio = nombre !== etapa.nombre || descripcion !== etapa.descripcion || responsable !== (etapa.responsable ?? '')
    || dias !== (etapa.dias_estimados?.toString() ?? '') || publica !== !!etapa.publica
  return (
    <form className="p-tarjeta p-etapa-edit" onSubmit={(e) => { e.preventDefault(); alGuardar({ nombre, descripcion, responsable, dias_estimados: dias ? Number(dias) : null, publica }) }}>
      <span className="n">{etapa.numero}</span>
      <div className="p-campos">
        <label className="ancho">Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={80} /></label>
        <label className="ancho">Descripción<textarea rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={500} /></label>
        <label>Responsable<input value={responsable} onChange={(e) => setResponsable(e.target.value)} maxLength={120} /></label>
        <label>Plazo en días<input type="number" min={0} value={dias} onChange={(e) => setDias(e.target.value)} placeholder="Sin plazo" /></label>
        <label className="p-check ancho"><input type="checkbox" checked={publica} onChange={(e) => setPublica(e.target.checked)} /> Al llegar aquí la obra queda como publicada</label>
      </div>
      <button className="btn secundario" disabled={!cambio}>Guardar</button>
    </form>
  )
}
