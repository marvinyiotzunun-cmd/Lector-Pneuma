import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, tamano, type Expediente } from '../api'
import { Cabecera } from '../comunes'
import { useSesion } from '../Panel'

const MAX = 40 * 1024 * 1024

function Archivo({ nombre, etiqueta, ayuda, acepta, requerido, multiple }: {
  nombre: string; etiqueta: string; ayuda: string; acepta: string; requerido?: boolean; multiple?: boolean
}) {
  const [archivos, setArchivos] = useState<File[]>([])
  const grande = archivos.find((a) => a.size > MAX)
  return (
    <label className="p-archivo">
      <span className="p-etiqueta">{etiqueta}{requerido && <em> · obligatorio</em>}</span>
      <span className="p-ayuda">{ayuda}</span>
      <input type="file" name={nombre} accept={acepta} required={requerido} multiple={multiple}
        onChange={(e) => setArchivos([...(e.target.files ?? [])])} />
      {archivos.length > 0 && (
        <span className={grande ? 'error' : 'p-tenue'}>
          {archivos.map((a) => `${a.name} (${tamano(a.size)})`).join(', ')}{grande && ' · pesa más de 40 MB'}
        </span>
      )}
    </label>
  )
}

export default function NuevaSolicitud() {
  const { ministerios } = useSesion()
  const ir = useNavigate()
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEnviando(true); setError(null)
    try {
      const exp = await api<Expediente>('/ventanilla/expedientes', { cuerpo: new FormData(e.currentTarget) })
      ir(`/ventanilla/${exp.codigo}?nueva=1`)
    } catch (err) {
      setError((err as Error).message); setEnviando(false)
    }
  }

  if (!ministerios.length) return (
    <div className="p-tarjeta p-alerta">Su cuenta no está ligada a un ministerio. <Link to="/ventanilla">Volver</Link></div>
  )

  return (
    <>
      <Cabecera titulo="Presentar una obra" sub="Al enviar, la obra recibe un número de expediente y le avisaremos por correo de cada avance." />
      <form className="p-form" onSubmit={enviar}>
        <section className="p-tarjeta">
          <h2>La obra</h2>
          <div className="p-campos">
            <label className="ancho">Ministerio
              <select name="ministerio_id" required defaultValue={ministerios.length === 1 ? ministerios[0].id : ''}>
                {ministerios.length > 1 && <option value="" disabled>Elija el ministerio</option>}
                {ministerios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </label>
            <label className="ancho">Título<input name="titulo" required maxLength={200} /></label>
            <label className="ancho">Subtítulo<input name="subtitulo" maxLength={200} /></label>
            <label className="ancho">Autor o autores<input name="autores" required maxLength={300} placeholder="Como irán en la portada" /></label>
            <label>Género
              <select name="genero" defaultValue="">
                <option value="">Elija</option>
                {['Estudio bíblico', 'Devocional', 'Doctrina', 'Testimonio', 'Liderazgo', 'Educación cristiana', 'Himnario o música', 'Material para niños', 'Otro'].map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
            <label>Público<input name="publico" maxLength={200} placeholder="Jóvenes, pastores, escuela dominical…" /></label>
            <label>Páginas aproximadas<input name="paginas_aprox" type="number" min={1} max={5000} /></label>
            <label>Modalidad
              <select name="modalidad" defaultValue="impreso">
                <option value="impreso">Impreso</option>
                <option value="digital">Digital (lector Pneuma)</option>
                <option value="ambos">Impreso y digital</option>
              </select>
            </label>
            <label>Tiraje estimado<input name="tiraje_estimado" type="number" min={0} placeholder="Ejemplares" /></label>
            <label className="ancho">Sinopsis<textarea name="sinopsis" required maxLength={4000} rows={5} placeholder="De qué trata la obra y por qué es necesaria" /></label>
            <label className="ancho">Sobre el autor<textarea name="semblanza_autor" maxLength={3000} rows={3} placeholder="Nombre completo, ministerio que ejerce, formación y obras anteriores" /></label>
            <label className="ancho">Mensaje para la Dirección Editorial<textarea name="mensaje" maxLength={2000} rows={3} placeholder="Opcional" /></label>
          </div>
        </section>
        <section className="p-tarjeta">
          <h2>Documentos</h2>
          <p className="p-tenue">Esta solicitud hace las veces del formulario de propuesta de obra. Máximo 40 MB por archivo; los formatos oficiales se descargan en el sitio de Pneuma.</p>
          <div className="p-archivos">
            <Archivo nombre="manuscrito" etiqueta="Manuscrito" requerido acepta=".doc,.docx,.odt,.rtf" ayuda="Completo, en Word (o la muestra, si es un encargo)." />
            <Archivo nombre="curriculum" etiqueta="Currículum del autor" requerido acepta=".pdf,.doc,.docx,.odt" ayuda="Formación, ministerio y obras anteriores." />
            <Archivo nombre="declaracion" etiqueta="Declaración de originalidad y uso de IA" requerido acepta=".pdf,.jpg,.jpeg,.png,.doc,.docx" ayuda="Firmada por el autor." />
            <Archivo nombre="carta_autorizacion" etiqueta="Carta de Autorización" requerido acepta=".pdf,.jpg,.jpeg,.png,.doc,.docx" ayuda="Firmada por el pastor o líder del ministerio." />
            <Archivo nombre="creditos" etiqueta="Formato de Créditos" requerido acepta=".pdf,.jpg,.jpeg,.png,.doc,.docx" ayuda="Lleno con los créditos de la obra." />
            <Archivo nombre="indice" etiqueta="Índice" acepta=".pdf,.doc,.docx,.odt" ayuda="Si no viene dentro del manuscrito." />
            <Archivo nombre="permisos" etiqueta="Permisos de terceros" multiple acepta=".pdf,.jpg,.jpeg,.png,.doc,.docx" ayuda="Los que ya tenga (citas, imágenes, versiones bíblicas)." />
            <Archivo nombre="foto_autor" etiqueta="Fotografía del autor" acepta=".jpg,.jpeg,.png,.webp,.heic" ayuda="Opcional." />
            <Archivo nombre="portada" etiqueta="Propuesta de portada" acepta=".jpg,.jpeg,.png,.webp,.pdf" ayuda="Opcional." />
            <Archivo nombre="otro" etiqueta="Otros documentos" multiple acepta=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.webp,.zip,.xlsx,.txt" ayuda="Anexos." />
          </div>
        </section>
        {error && <p className="error">{error}</p>}
        <div className="p-acciones">
          <Link className="btn secundario" to="/ventanilla">Cancelar</Link>
          <button className="btn" disabled={enviando}>{enviando ? 'Enviando solicitud…' : 'Enviar solicitud'}</button>
        </div>
      </form>
    </>
  )
}
