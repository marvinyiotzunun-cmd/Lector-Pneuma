import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { json, libro, pedir, usuario } from './ayuda'

describe('pedidos y accesos', () => {
  it('transferencia: crea el pedido, recibe comprobante, el editor confirma y se entrega el libro digital', async () => {
    const l = await libro()
    const u = await usuario()
    const r = await pedir('/pedidos', { method: 'POST', token: u.token, json: { metodo: 'transferencia', items: [{ modalidad: 'compra', libro_id: l.id }] } })
    expect(r.status).toBe(201)
    const { pedido, instrucciones_pago, enlace_pago } = await json(r)
    expect(pedido.codigo).toMatch(/^PN-\d{6}$/)
    expect(pedido.total_gtq).toBe(60)
    expect(enlace_pago).toBeNull()
    expect(instrucciones_pago.referencia).toBe(pedido.codigo)

    const c = await pedir(`/pedidos/${pedido.id}/comprobante?referencia=123456`, {
      method: 'POST',
      token: u.token,
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71]),
    })
    expect(c.status).toBe(200)
    expect((await json(c)).estado).toBe('en_revision')

    // Un lector no puede confirmar.
    expect((await pedir(`/admin/pedidos/${pedido.id}/estado`, { method: 'POST', token: u.token, json: { estado: 'pagado' } })).status).toBe(403)
    const editor = await usuario('editor')
    const ok = await pedir(`/admin/pedidos/${pedido.id}/estado`, { method: 'POST', token: editor.token, json: { estado: 'pagado' } })
    expect((await json(ok)).estado).toBe('pagado')

    const bib = await json(await pedir('/biblioteca', { token: u.token }))
    expect(bib.map((b: any) => b.libro.id)).toContain(l.id)
    expect(bib[0].acceso.tipo).toBe('compra')

    const correo = await env.DB.prepare("SELECT 1 FROM correos_enviados WHERE para = ? AND plantilla = 'pedido_pagado'").bind(u.correo).first()
    expect(correo).not.toBeNull()
  })

  it('impreso sin sesión: suma envío, y el comprador consulta con código y correo', async () => {
    const l = await libro({ digital_activo: false })
    const r = await pedir('/pedidos', {
      method: 'POST',
      json: {
        metodo: 'billetera',
        correo: 'compra@correo.test',
        nombre: 'Ana',
        items: [{ modalidad: 'impreso', libro_id: l.id, cantidad: 2 }],
        entrega: { nombre: 'Ana', direccion: '5a calle 1-23', municipio: 'Mixco', departamento: 'Guatemala' },
      },
    })
    expect(r.status).toBe(201)
    const { pedido } = await json(r)
    expect(pedido.subtotal_gtq).toBe(170)
    expect(pedido.envio_gtq).toBe(35)
    expect(pedido.total_gtq).toBe(205)
    expect((await pedir(`/pedidos/${pedido.id}`)).status).toBe(404)
    const visto = await pedir(`/pedidos/${pedido.codigo}?codigo=${pedido.codigo}&correo=compra@correo.test`)
    expect((await json(visto)).id).toBe(pedido.id)

    // Recoger en oficina: sin envío.
    const recoger = await json(
      await pedir('/pedidos', { method: 'POST', json: { metodo: 'transferencia', telefono: '55555555', items: [{ modalidad: 'impreso', libro_id: l.id }] } }),
    )
    expect(recoger.pedido.envio_gtq).toBe(0)
  })

  it('tarjeta sin llaves de Recurrente responde 503 y no deja el pedido pendiente', async () => {
    const l = await libro()
    const u = await usuario()
    const r = await pedir('/pedidos', { method: 'POST', token: u.token, json: { metodo: 'recurrente', items: [{ modalidad: 'compra', libro_id: l.id }] } })
    expect(r.status).toBe(503)
    expect((await json(r)).error.codigo).toBe('pasarela_no_configurada')
    const p = await env.DB.prepare("SELECT estado FROM pedidos WHERE usuario_id = ? ORDER BY creado_en DESC").bind(u.id).first<any>()
    expect(p.estado).toBe('cancelado')
  })

  it('alquiler vence y suscripción de iglesia cubre a sus miembros', async () => {
    const l = await libro()
    const admin = await usuario('admin')
    const plan = await json(
      await pedir('/admin/planes', { method: 'POST', token: admin.token, json: { nombre: 'Iglesia 30', tipo: 'iglesia', precio_gtq: 300, dias: 30, max_miembros: 2 } }),
    )
    const pastor = await usuario()
    const r = await json(
      await pedir('/pedidos', { method: 'POST', token: pastor.token, json: { metodo: 'transferencia', iglesia_nombre: 'IDEC Zona 11', items: [{ modalidad: 'plan', plan_id: plan.id }] } }),
    )
    await pedir(`/admin/pedidos/${r.pedido.id}/estado`, { method: 'POST', token: admin.token, json: { estado: 'pagado' } })
    const sus = await json(await pedir('/suscripciones', { token: pastor.token }))
    expect(sus[0].soy_titular).toBe(true)
    expect(sus[0].iglesia).toBe('IDEC Zona 11')

    const miembro = await usuario()
    const agregar = await pedir(`/iglesias/${sus[0].iglesia_id}/miembros`, { method: 'POST', token: pastor.token, json: { correos: [miembro.correo, 'otro@correo.test'] } })
    expect(agregar.status).toBe(200)
    const lleno = await pedir(`/iglesias/${sus[0].iglesia_id}/miembros`, { method: 'POST', token: pastor.token, json: { correos: ['tercero@correo.test'] } })
    expect(lleno.status).toBe(409)
    const m = await json(await pedir(`/obras/${l.id}/progreso`, { token: miembro.token }))
    expect(m).toBeNull()
    const bib = await json(await pedir('/biblioteca', { token: miembro.token }))
    expect(bib.find((b: any) => b.libro.id === l.id)?.acceso.tipo).toBe('suscripcion')

    // Alquiler vencido: ya no da acceso.
    const lector = await usuario()
    await env.DB.prepare("INSERT INTO accesos (id, usuario_id, libro_id, tipo, vence_en) VALUES (?, ?, ?, 'alquiler', ?)")
      .bind(`acc_${lector.id}`, lector.id, l.id, new Date(Date.now() - 1000).toISOString())
      .run()
    expect(await json(await pedir('/biblioteca', { token: lector.token }))).toHaveLength(0)
  })

  it('códigos de canje: un uso por persona y respeta usos_max', async () => {
    const l = await libro()
    const editor = await usuario('editor')
    const lote = await json(await pedir('/admin/codigos', { method: 'POST', token: editor.token, json: { libro_id: l.id, cantidad: 1, usos_max: 1 } }))
    const codigo = lote.codigos[0]
    const a = await usuario()
    const b = await usuario()
    const r = await pedir('/canjear', { method: 'POST', token: a.token, json: { codigo: codigo.toLowerCase() } })
    expect(r.status).toBe(200)
    expect((await json(r)).tipo).toBe('libro')
    expect((await pedir('/canjear', { method: 'POST', token: a.token, json: { codigo } })).status).toBe(409)
    expect((await pedir('/canjear', { method: 'POST', token: b.token, json: { codigo } })).status).toBe(410)
  })

  it('interno (WhatsApp): token, pedido impreso y comprobante', async () => {
    const l = await libro()
    expect((await pedir('/interno/pedidos', { method: 'POST', json: {} })).status).toBe(401)
    const r = await pedir('/interno/pedidos', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-interno-pruebas' },
      json: { canal: 'whatsapp', cliente: { telefono: '50255555555', nombre: 'Luis' }, items: [{ libro_id: l.id, cantidad: 1 }], entrega: null, metodo_pago: 'transferencia' },
    })
    expect(r.status).toBe(201)
    const d = await json(r)
    expect(d.codigo).toMatch(/^PN-/)
    expect(d.total_gtq).toBe(85)
    const c = await pedir(`/interno/pedidos/${d.pedido_id}/comprobante`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-interno-pruebas', 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([255, 216, 255]),
    })
    expect((await json(c)).estado).toBe('en_revision')
    // El token interno no sirve como sesión de usuario.
    expect((await pedir('/yo', { token: 'token-interno-pruebas' })).status).toBe(401)
  })
})

describe('catálogo y ajustes públicos', () => {
  it('lista solo publicados con precios en quetzales', async () => {
    await libro({ titulo: 'Oculto', publicado: false })
    const l = await libro({ titulo: 'Visible en catálogo' })
    const cat = await json(await pedir('/catalogo?q=Visible'))
    expect(cat).toHaveLength(1)
    expect(cat[0].impreso.precio_gtq).toBe(85)
    expect(cat[0].digital.precio_alquiler_gtq).toBe(25)
    expect(cat[0].ficha_url).toBe(`https://pneuma.test/libros/${l.slug}`)
    expect((await json(await pedir('/catalogo?q=Oculto'))).length).toBe(0)
    const aj = await json(await pedir('/ajustes/publicos'))
    expect(aj.envio_gtq).toBe(35)
  })

  it('el asistente sin llave responde 503 para que el sitio muestre WhatsApp', async () => {
    const r = await pedir('/asistente', { method: 'POST', json: { mensajes: [{ rol: 'usuario', texto: '¿Cómo publico?' }] } })
    expect(r.status).toBe(503)
    expect((await json(r)).error.codigo).toBe('asistente_agotado')
  })
})
