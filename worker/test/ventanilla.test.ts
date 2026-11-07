import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { json, libro, pedir, usuario } from './ayuda'

const archivo = (nombre: string, contenido = 'contenido de prueba') => new File([contenido], nombre)

/** Formulario completo de solicitud con los documentos obligatorios. */
function solicitud(ministerioId: string, extra: Record<string, string | File> = {}) {
  const f = new FormData()
  f.set('ministerio_id', ministerioId)
  f.set('titulo', 'Caminando en el Espíritu')
  f.set('autores', 'Juan Pérez')
  f.set('sinopsis', 'Un estudio de Gálatas 5.')
  f.set('modalidad', 'ambos')
  f.set('manuscrito', archivo('manuscrito.docx'))
  f.set('curriculum', archivo('cv.pdf'))
  f.set('declaracion', archivo('declaracion.pdf'))
  f.set('carta_autorizacion', archivo('carta.pdf'))
  f.set('creditos', archivo('creditos.pdf'))
  for (const [k, v] of Object.entries(extra)) f.set(k, v)
  return f
}

async function ministerioConCuenta() {
  const editor = await usuario('editor')
  const cuenta = await usuario('lector')
  const m = await json(await pedir('/admin/ministerios', { method: 'POST', token: editor.token, json: { nombre: `Ministerio ${cuenta.id}`, contacto_correo: 'min@correo.test' } }))
  const r = await pedir(`/admin/ministerios/${m.id}/miembros`, { method: 'POST', token: editor.token, json: { correo: cuenta.correo, cargo: 'Director' } })
  expect(r.status).toBe(201)
  return { editor, cuenta, ministerioId: m.id as string }
}

describe('ventanilla editorial', () => {
  it('abre la cuenta del ministerio y le cambia el rol', async () => {
    const { cuenta, ministerioId } = await ministerioConCuenta()
    const yo = await json(await pedir('/ventanilla/yo', { token: cuenta.token }))
    expect(yo.usuario.rol).toBe('ministerio')
    expect(yo.ministerios.map((m: any) => m.id)).toEqual([ministerioId])
    const invitacion = await env.DB.prepare('SELECT asunto FROM correos_enviados WHERE para = ?').bind(cuenta.correo).first<any>()
    expect(invitacion.asunto).toContain('ventanilla')
  })

  it('exige los documentos obligatorios y no gasta correlativos en solicitudes inválidas', async () => {
    const { cuenta, ministerioId } = await ministerioConCuenta()
    const sinCarta = solicitud(ministerioId)
    sinCarta.delete('carta_autorizacion')
    const r1 = await pedir('/ventanilla/expedientes', { method: 'POST', token: cuenta.token, body: sinCarta })
    expect(r1.status).toBe(400)
    expect((await json(r1)).error.mensaje).toContain('Carta de Autorización')

    const r2 = await pedir('/ventanilla/expedientes', { method: 'POST', token: cuenta.token, body: solicitud(ministerioId, { manuscrito: archivo('virus.exe') }) })
    expect(r2.status).toBe(400)

    const antes = await env.DB.prepare('SELECT ultimo FROM expediente_secuencia').first<any>()
    const r3 = await pedir('/ventanilla/expedientes', { method: 'POST', token: cuenta.token, body: solicitud(ministerioId) })
    expect(r3.status).toBe(201)
    const exp = await json(r3)
    const n = (antes?.ultimo ?? 0) + 1
    expect(exp.codigo).toBe(`PNE-${new Date().getUTCFullYear()}-${String(n).padStart(3, '0')}`)
    expect(exp.etapa).toBe(1)
    const docs = await env.DB.prepare('SELECT COUNT(*) AS n FROM expediente_documentos WHERE expediente_id = ?').bind(exp.id).first<any>()
    expect(docs.n).toBe(5)
  })

  it('no deja presentar por un ministerio ajeno ni ver expedientes de otros', async () => {
    const { cuenta, ministerioId } = await ministerioConCuenta()
    const extrano = await usuario('lector')
    expect((await pedir('/ventanilla/expedientes', { method: 'POST', token: extrano.token, body: solicitud(ministerioId) })).status).toBe(403)
    const exp = await json(await pedir('/ventanilla/expedientes', { method: 'POST', token: cuenta.token, body: solicitud(ministerioId) }))
    expect((await pedir(`/ventanilla/expedientes/${exp.codigo}`, { token: extrano.token })).status).toBe(404)
    const detalle = await json(await pedir(`/ventanilla/expedientes/${exp.codigo}`, { token: cuenta.token }))
    const doc = detalle.documentos[0].id
    expect((await pedir(`/ventanilla/documentos/${doc}`, { token: extrano.token })).status).toBe(404)
    const descarga = await pedir(`/ventanilla/documentos/${doc}`, { token: cuenta.token })
    expect(descarga.status).toBe(200)
    expect(descarga.headers.get('content-disposition')).toContain('attachment')
    expect((await pedir('/admin/expedientes', { token: cuenta.token })).status).toBe(403)
  })

  it('mueve etapas, avisa por correo, oculta notas internas y publica en la última', async () => {
    const { editor, cuenta, ministerioId } = await ministerioConCuenta()
    const exp = await json(await pedir('/ventanilla/expedientes', { method: 'POST', token: cuenta.token, body: solicitud(ministerioId) }))

    const e2 = await pedir(`/admin/expedientes/${exp.id}/etapa`, { method: 'POST', token: editor.token, json: { etapa: 2, nota: 'Solicitud completa.' } })
    expect((await json(e2)).etapa_nombre).toBe('Revisión de admisión')
    await pedir(`/admin/expedientes/${exp.id}/notas`, { method: 'POST', token: editor.token, json: { nota: 'Asignar revisor', visible_ministerio: false } })
    const sinNota = await pedir(`/admin/expedientes/${exp.id}/estado`, { method: 'POST', token: editor.token, json: { estado: 'requiere_cambios' } })
    expect(sinNota.status).toBe(400)
    await pedir(`/admin/expedientes/${exp.id}/estado`, { method: 'POST', token: editor.token, json: { estado: 'requiere_cambios', nota: 'Falta el índice.' } })
    await pedir(`/admin/expedientes/${exp.id}`, { method: 'PATCH', token: editor.token, json: { revision: 'A', dictamen: 'aprobada_con_cambios' } })

    const vista = await json(await pedir(`/ventanilla/expedientes/${exp.codigo}`, { token: cuenta.token }))
    expect(vista.estado).toBe('requiere_cambios')
    expect(vista.historial.some((h: any) => h.nota === 'Asignar revisor')).toBe(false)
    expect(vista.historial.some((h: any) => h.nota?.includes('Aprobada con cambios'))).toBe(true)

    const f = new FormData()
    f.set('tipo', 'indice')
    f.set('archivo', archivo('indice.pdf'))
    expect((await pedir(`/ventanilla/expedientes/${exp.codigo}/documentos`, { method: 'POST', token: cuenta.token, body: f })).status).toBe(201)

    const final = await json(await pedir(`/admin/expedientes/${exp.id}/etapa`, { method: 'POST', token: editor.token, json: { etapa: 8 } }))
    expect(final.estado).toBe('publicado')
    expect((await pedir(`/admin/expedientes/${exp.id}/etapa`, { method: 'POST', token: editor.token, json: { etapa: 9 } })).status).toBe(400)

    // Los avisos se mandan después de responder; damos un momento a waitUntil.
    await new Promise((r) => setTimeout(r, 50))
    const { results } = await env.DB.prepare('SELECT asunto FROM correos_enviados WHERE para = ?').bind(cuenta.correo).all<any>()
    const asuntos = results.map((r) => r.asunto).join('\n')
    expect(asuntos).toContain('Solicitud recibida')
    expect(asuntos).toContain('Revisión de admisión')
    expect(asuntos).toContain('Requiere cambios')
    expect(asuntos).toContain('Mensaje de la Dirección Editorial')
    expect(asuntos).toContain('Publicada y en distribución')

    const resumen = await json(await pedir('/admin/expedientes/resumen', { token: editor.token }))
    expect(resumen.por_etapa).toHaveLength(8)
  })

  it('edita contenidos públicos, formatos y etapas del sitio', async () => {
    const editor = await usuario('editor')
    await pedir('/admin/contenidos/quienes-somos', { method: 'PUT', token: editor.token, json: { titulo: 'Quiénes somos', cuerpo: '# Pneuma' } })
    expect((await json(await pedir('/contenidos/quienes-somos'))).cuerpo).toBe('# Pneuma')
    const f = new FormData()
    f.set('nombre', 'Carta de Autorización')
    f.set('archivo', archivo('carta.pdf'))
    expect((await pedir('/admin/formatos', { method: 'POST', token: editor.token, body: f })).status).toBe(201)
    const formatos = await json(await pedir('/formatos'))
    expect(formatos[0].url).toContain('/api/formatos/')
    expect((await pedir(new URL(formatos[0].url).pathname.replace('/api', ''))).status).toBe(200)
    expect((await json(await pedir('/proceso/etapas')))[2].nombre).toBe('Dictamen de la Junta Editorial')
  })

  it('da y quita accesos de cortesía y reporta quién lee qué', async () => {
    const { id: libroId, admin } = await libro()
    const r = await json(await pedir('/admin/accesos', { method: 'POST', token: admin.token, json: { correos: 'nueva@correo.test, malo', libro_id: libroId, dias: 30 } }))
    expect(r.otorgados).toEqual(['nueva@correo.test'])
    const otra = await json(await pedir('/admin/accesos', { method: 'POST', token: admin.token, json: { correos: ['nueva@correo.test'], libro_id: libroId } }))
    expect(otra.ya_tenian).toEqual(['nueva@correo.test'])
    const accesos = await json(await pedir(`/admin/accesos?libro=${libroId}`, { token: admin.token }))
    expect(accesos[0].tipo).toBe('cortesia')
    expect(accesos[0].vigencia).toBe('vigente')

    const lectora = await env.DB.prepare('SELECT id FROM usuarios WHERE correo = ?').bind('nueva@correo.test').first<any>()
    await env.DB.prepare("INSERT INTO eventos_lectura (usuario_id, libro_id, pagina, huella) VALUES (?, ?, 1, 'h1')").bind(lectora.id, libroId).run()
    const lecturas = await json(await pedir('/admin/lecturas', { token: admin.token }))
    const fila = lecturas.libros.find((l: any) => l.id === libroId)
    expect(fila.lectores_activos).toBe(1)
    const lectores = await json(await pedir(`/admin/lecturas/libros/${libroId}`, { token: admin.token }))
    expect(lectores[0].correo).toBe('nueva@correo.test')

    expect((await pedir(`/admin/accesos/${accesos[0].id}`, { method: 'DELETE', token: admin.token })).status).toBe(200)
  })

  it('solo un administrador da el rol de editor', async () => {
    const editor = await usuario('editor')
    const admin = await usuario('admin')
    const lector = await usuario('lector')
    expect((await pedir(`/admin/usuarios/${lector.id}`, { method: 'PATCH', token: editor.token, json: { rol: 'editor' } })).status).toBe(403)
    expect((await pedir(`/admin/usuarios/${lector.id}`, { method: 'PATCH', token: admin.token, json: { rol: 'editor' } })).status).toBe(200)
  })
})
