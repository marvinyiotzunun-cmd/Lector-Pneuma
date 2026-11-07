import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { Aviso, Cabecera, Cargando, useDatos } from '../comunes'
import { siNo, type LibroAdmin } from './libros'

export default function LibroFicha() {
  const { id = '' } = useParams()
  const ir = useNavigate()
  const { datos: l, error, recargar } = useDatos(() => api<LibroAdmin>(`/admin/libros/${id}`), [id])
  const [aviso, setAviso] = useState<{ t: string; tipo?: 'error' } | null>(null)
  if (!l) return <Cargando error={error} />

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const txt = (k: string) => (String(f.get(k) ?? '').trim() || null)
    const num = (k: string) => { const v = String(f.get(k) ?? '').trim(); return v === '' ? null : Number(v) }
    const cuerpo = {
      titulo: txt('titulo'), autor: txt('autor'), ministerio: txt('ministerio'), sinopsis: txt('sinopsis'), isbn: txt('isbn'),
      paginas: num('paginas'), categoria: txt('categoria'), slug: txt('slug'),
      impreso: f.has('impreso'), precio_impreso_gtq: num('precio_impreso_gtq'), existencias: num('existencias'),
      formato_digital: txt('formato_digital'), digital_activo: f.has('digital_activo'),
      precio_compra_gtq: num('precio_compra_gtq'), precio_alquiler_gtq: num('precio_alquiler_gtq'), dias_alquiler: num('dias_alquiler') ?? 30,
      en_suscripcion: f.has('en_suscripcion'), paginas_muestra: num('paginas_muestra') ?? 0,
      url_amazon: txt('url_amazon'), url_google_play: txt('url_google_play'), publicado: f.has('publicado'), orden: num('orden') ?? 0,
    }
    try { await api(`/admin/libros/${l!.id}`, { metodo: 'PATCH', cuerpo }); setAviso({ t: 'Ficha guardada. Use "Publicar cambios en el sitio" en Contenidos para que el sitio la muestre.' }); recargar() }
    catch (err) { setAviso({ t: (err as Error).message, tipo: 'error' }) }
  }

  async function portada(archivo: File) {
    try { await api(`/admin/libros/${l!.id}/portada`, { metodo: 'PUT', cuerpo: archivo, tipo: archivo.type }); setAviso({ t: 'Portada actualizada.' }); recargar() }
    catch (err) { setAviso({ t: (err as Error).message, tipo: 'error' }) }
  }

  async function borrar() {
    if (!confirm(`¿Borrar «${l!.titulo}»? Esta acción no se puede deshacer.`)) return
    try { await api(`/admin/libros/${l!.id}`, { metodo: 'DELETE' }); ir('/admin/libros') }
    catch (err) { setAviso({ t: (err as Error).message, tipo: 'error' }) }
  }

  return (
    <>
      <p className="p-migas"><Link to="/admin/libros">Libros</Link> / {l.titulo}</p>
      <Cabecera titulo={l.titulo} sub={l.autor}><button className="btn secundario peligro" onClick={borrar}>Borrar</button></Cabecera>
      <div className="p-dos">
        <form className="p-tarjeta" onSubmit={guardar}>
          <h2>Ficha</h2>
          <div className="p-campos">
            <label className="ancho">Título<input name="titulo" defaultValue={l.titulo} required /></label>
            <label>Autor<input name="autor" defaultValue={l.autor} required /></label>
            <label>Ministerio<input name="ministerio" defaultValue={l.ministerio ?? ''} /></label>
            <label>ISBN<input name="isbn" defaultValue={l.isbn ?? ''} /></label>
            <label>Páginas<input name="paginas" type="number" min={1} defaultValue={l.paginas ?? ''} /></label>
            <label>Categoría<input name="categoria" defaultValue={l.categoria ?? ''} /></label>
            <label>Dirección en el sitio<input name="slug" defaultValue={l.slug} pattern="[a-z0-9-]+" title="Minúsculas, números y guiones" /></label>
            <label className="ancho">Sinopsis<textarea name="sinopsis" rows={5} defaultValue={l.sinopsis ?? ''} /></label>
          </div>
          <h3>Impreso</h3>
          <div className="p-campos">
            <label className="p-check ancho"><input type="checkbox" name="impreso" defaultChecked={siNo(l.impreso)} /> Se vende impreso con envío a domicilio</label>
            <label>Precio (Q)<input name="precio_impreso_gtq" type="number" step="0.01" min={0} defaultValue={l.precio_impreso_gtq ?? ''} /></label>
            <label>Existencias<input name="existencias" type="number" min={0} defaultValue={l.existencias ?? ''} placeholder="Sin control" /></label>
          </div>
          <h3>Digital (lector Pneuma)</h3>
          <div className="p-campos">
            <label>Formato original
              <select name="formato_digital" defaultValue={l.formato_digital ?? ''}><option value="">No se ofrece digital</option><option value="pdf">PDF</option><option value="epub">EPUB</option></select>
            </label>
            <label className="p-check"><input type="checkbox" name="digital_activo" defaultChecked={siNo(l.digital_activo)} /> Activo en el lector</label>
            <label>Precio de compra (Q)<input name="precio_compra_gtq" type="number" step="0.01" min={0} defaultValue={l.precio_compra_gtq ?? ''} /></label>
            <label>Precio de alquiler (Q)<input name="precio_alquiler_gtq" type="number" step="0.01" min={0} defaultValue={l.precio_alquiler_gtq ?? ''} /></label>
            <label>Días de alquiler<input name="dias_alquiler" type="number" min={1} defaultValue={l.dias_alquiler} /></label>
            <label>Páginas de muestra gratis<input name="paginas_muestra" type="number" min={0} defaultValue={l.paginas_muestra} /></label>
            <label className="p-check ancho"><input type="checkbox" name="en_suscripcion" defaultChecked={siNo(l.en_suscripcion)} /> Incluido en las suscripciones</label>
          </div>
          <h3>Tiendas y sitio</h3>
          <div className="p-campos">
            <label className="ancho">Enlace en Amazon<input name="url_amazon" type="url" defaultValue={l.url_amazon ?? ''} /></label>
            <label className="ancho">Enlace en Google Play Libros<input name="url_google_play" type="url" defaultValue={l.url_google_play ?? ''} /></label>
            <label>Orden en el catálogo<input name="orden" type="number" defaultValue={l.orden} /></label>
            <label className="p-check"><input type="checkbox" name="publicado" defaultChecked={siNo(l.publicado)} /> Publicado en el sitio</label>
          </div>
          <button className="btn">Guardar ficha</button>
        </form>
        <div className="p-columna">
          <section className="p-tarjeta">
            <h2>Portada</h2>
            {l.portada_url ? <img className="p-portada" src={`${l.portada_url}?v=${encodeURIComponent(l.actualizado_en)}`} alt={`Portada de ${l.titulo}`} /> : <p className="p-tenue">Sin portada.</p>}
            <label className="p-archivo"><span className="p-ayuda">JPG, PNG o WebP, vertical.</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && portada(e.target.files[0])} /></label>
          </section>
          <SubirAlLector libro={l} alTerminar={(t, error) => { setAviso({ t, tipo: error ? 'error' : undefined }); if (!error) recargar() }} />
        </div>
      </div>
      <Aviso texto={aviso?.t ?? null} tipo={aviso?.tipo} alCerrar={() => setAviso(null)} />
    </>
  )
}

/** Convierte el EPUB o PDF en el navegador (preparar-obra) y sube manifiesto, páginas y portada. */
function SubirAlLector({ libro, alTerminar }: { libro: LibroAdmin; alTerminar: (t: string, error?: boolean) => void }) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [fase, setFase] = useState<{ texto: string; hechas: number; total: number } | null>(null)

  async function subir() {
    if (!archivo) return
    try {
      setFase({ texto: 'Preparando las páginas…', hechas: 0, total: 1 })
      const { prepararObra } = await import('../../preparar/preparar-obra')
      const obra = await prepararObra(archivo, { alProgresar: (hechas, total) => setFase({ texto: 'Preparando las páginas…', hechas, total }) })
      const paginas = obra.archivos.filter((a) => a.ruta.startsWith('p/'))
      let hechas = 0
      setFase({ texto: 'Subiendo las páginas…', hechas, total: paginas.length })
      // Subidas en paralelo de 4 en 4.
      const cola = [...paginas]
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let a = cola.shift(); a; a = cola.shift()) {
          const n = Number(a.ruta.match(/p\/(\d+)/)![1])
          await api(`/admin/libros/${libro.id}/paginas/${n}`, { metodo: 'PUT', cuerpo: a.datos, tipo: a.tipo })
          setFase({ texto: 'Subiendo las páginas…', hechas: ++hechas, total: paginas.length })
        }
      }))
      const portada = obra.archivos.find((a) => a.ruta === 'portada.webp')
      if (portada && !libro.portada_url) await api(`/admin/libros/${libro.id}/portada`, { metodo: 'PUT', cuerpo: portada.datos, tipo: portada.tipo })
      // El manifiesto va al final: hasta entonces el lector no ve la obra nueva a medias.
      const manifiesto = obra.archivos.find((a) => a.ruta === 'manifiesto.json')!
      await api(`/admin/libros/${libro.id}/manifiesto`, { metodo: 'PUT', cuerpo: manifiesto.datos, tipo: 'application/json' })
      setFase(null); setArchivo(null)
      alTerminar(`Listo: ${obra.manifiesto.total_paginas} páginas cargadas al lector.`)
    } catch (e) {
      setFase(null)
      alTerminar(`No se pudo cargar la obra: ${(e as Error).message}`, true)
    }
  }

  return (
    <section className="p-tarjeta">
      <h2>Obra en el lector</h2>
      <p className="p-tenue">{libro.total_paginas_digital ? `Cargada: ${libro.total_paginas_digital} páginas.` : 'Todavía no se ha cargado el archivo.'} El archivo se convierte aquí mismo en páginas protegidas; el original no se sube.</p>
      <label className="p-archivo"><span className="p-ayuda">EPUB o PDF</span>
        <input type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" disabled={!!fase} onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></label>
      {fase && <div className="p-progreso"><span>{fase.texto} {fase.hechas} de {fase.total}</span><progress value={fase.hechas} max={fase.total} /></div>}
      <button className="btn" disabled={!archivo || !!fase} onClick={subir}>{libro.total_paginas_digital ? 'Reemplazar la obra' : 'Cargar al lector'}</button>
    </section>
  )
}
