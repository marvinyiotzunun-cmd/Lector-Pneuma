import { Hono, type Context } from 'hono'
import type { App } from '../env'
import { ajuste, ajusteNum } from '../lib/ajustes'
import { requiereInterno, requiereSesion, usuarioActual } from '../lib/sesion'
import { aGtq, falla, leerJson, normalizarCorreo, nuevoId, texto } from '../lib/util'
import { capturarOrdenPaypal, verificarWebhookPaypal } from '../pagos/paypal'
import { estadoCheckoutRecurrente, verificarFirmaRecurrente } from '../pagos/recurrente'
import {
  cambiarEstado,
  crearPedido,
  guardarComprobante,
  normalizarMetodo,
  pedidoPublico,
  validarEntrega,
  type FilaPedido,
} from '../servicios/pedidos'

export const pedidos = new Hono<App>()

pedidos.get('/ajustes/publicos', async (c) => {
  const json = async (k: string) => {
    try {
      return JSON.parse(await ajuste(c.env, k, '[]'))
    } catch {
      return []
    }
  }
  c.header('Cache-Control', 'public, max-age=300')
  return c.json({
    envio_gtq: aGtq(await ajusteNum(c.env, 'envio_centavos', 0)),
    whatsapp: (await ajuste(c.env, 'whatsapp', '')) || null,
    direccion_recogida: (await ajuste(c.env, 'direccion_recogida', '')) || null,
    cuentas_bancarias: await json('cuentas_bancarias'),
    billeteras: await json('billeteras'),
    tipo_cambio_usd: Number(await ajuste(c.env, 'tipo_cambio_usd', '7.63')),
  })
})

pedidos.post('/pedidos', async (c) => {
  const b = await leerJson(c.req.raw)
  const usuario = c.get('usuario')
  const correo = usuario ? usuario.correo : b.correo ? normalizarCorreo(b.correo) : null
  const r = await crearPedido(c.env, {
    items: b.items as never,
    metodo: normalizarMetodo(b.metodo),
    canal: 'web',
    usuario,
    correo,
    nombre: texto(b.nombre, 120),
    telefono: texto(b.telefono, 30),
    entrega: validarEntrega(b.entrega),
    iglesiaNombre: texto(b.iglesia_nombre, 160),
    notas: texto(b.notas, 1000),
  })
  return c.json(r, 201)
})

pedidos.get('/pedidos', requiereSesion, async (c) => {
  const u = usuarioActual(c)
  const { results } = await c.env.DB.prepare(
    'SELECT id FROM pedidos WHERE usuario_id = ? OR correo = ? ORDER BY creado_en DESC LIMIT 100',
  )
    .bind(u.id, u.correo)
    .all<{ id: string }>()
  return c.json(await Promise.all(results.map((r) => pedidoPublico(c.env, r.id))))
})

/** Dueño: sesión con el mismo usuario o correo, o bien ?codigo=&correo= sin sesión. */
async function pedidoDelDueno(c: Context<App>): Promise<FilaPedido> {
  const id = c.req.param('id')!
  const p = await c.env.DB.prepare('SELECT * FROM pedidos WHERE id = ?1 OR codigo = ?1').bind(id).first<FilaPedido>()
  if (!p) throw falla(404, 'no_existe', 'Ese pedido no existe.')
  const u = c.get('usuario')
  if (u && (p.usuario_id === u.id || (p.correo && p.correo === u.correo) || u.rol === 'admin' || u.rol === 'editor')) return p
  const codigo = c.req.query('codigo')
  const correo = c.req.query('correo')
  if (codigo && correo && p.codigo === codigo.toUpperCase() && p.correo && p.correo === correo.trim().toLowerCase()) return p
  throw falla(404, 'no_existe', 'Ese pedido no existe.')
}

pedidos.get('/pedidos/:id', async (c) => {
  const p = await pedidoDelDueno(c)
  return c.json(await pedidoPublico(c.env, p.id))
})

pedidos.post('/pedidos/:id/comprobante', async (c) => {
  const p = await pedidoDelDueno(c)
  return c.json(await guardarComprobante(c.env, p.id, c.req.raw, texto(c.req.query('referencia'), 80)))
})

pedidos.post('/pedidos/:id/paypal/capturar', async (c) => {
  const p = await pedidoDelDueno(c)
  if (p.metodo !== 'paypal' || !p.proveedor_id) throw falla(400, 'no_paypal', 'Este pedido no se paga con PayPal.')
  if (p.estado === 'pendiente' && (await capturarOrdenPaypal(c.env, p.proveedor_id))) {
    await cambiarEstado(c.env, p.id, 'pagado', { nota: 'PayPal capturado' })
  }
  return c.json(await pedidoPublico(c.env, p.id))
})

/* ---------- Avisos de las pasarelas ---------- */

async function registrarEvento(c: Context<App>, id: string, proveedor: string, tipo: string, pedidoId: string | null, cuerpo: string) {
  const r = await c.env.DB.prepare(
    'INSERT INTO pagos_eventos (id, proveedor, tipo, pedido_id, cuerpo) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
  )
    .bind(id, proveedor, tipo, pedidoId, cuerpo.slice(0, 20000))
    .run()
  return r.meta.changes > 0
}

pedidos.post('/pagos/recurrente/webhook', async (c) => {
  const cuerpo = await c.req.text()
  if (!(await verificarFirmaRecurrente(c.env, c.req.raw, cuerpo))) throw falla(401, 'firma_invalida', 'Firma inválida.')
  const ev = JSON.parse(cuerpo) as { id?: string; event_type?: string; type?: string; checkout?: { id?: string; status?: string } }
  const tipo = ev.event_type ?? ev.type ?? 'desconocido'
  const checkoutId = ev.checkout?.id
  const p = checkoutId
    ? await c.env.DB.prepare("SELECT id FROM pedidos WHERE proveedor_id = ? AND metodo = 'recurrente'").bind(checkoutId).first<{ id: string }>()
    : null
  const nuevo = await registrarEvento(c, `rec_${c.req.header('svix-id') ?? ev.id ?? nuevoId('ev')}`, 'recurrente', tipo, p?.id ?? null, cuerpo)
  if (nuevo && p && (tipo === 'intent.succeeded' || tipo === 'payment_intent.succeeded')) {
    // Doble verificación con la API antes de entregar.
    const estado = await estadoCheckoutRecurrente(c.env, checkoutId!)
    if (estado === 'paid' || ev.checkout?.status === 'paid') {
      await cambiarEstado(c.env, p.id, 'pagado', { nota: 'Recurrente: pago confirmado' }).catch((e) => console.error(e))
    }
  }
  return c.json({ ok: true })
})

pedidos.post('/pagos/paypal/webhook', async (c) => {
  const cuerpo = await c.req.text()
  if (!(await verificarWebhookPaypal(c.env, c.req.raw, cuerpo))) throw falla(401, 'firma_invalida', 'Firma inválida.')
  const ev = JSON.parse(cuerpo) as {
    id: string
    event_type: string
    resource?: { id?: string; custom_id?: string; supplementary_data?: { related_ids?: { order_id?: string } }; purchase_units?: { custom_id?: string }[] }
  }
  const pedidoId = ev.resource?.custom_id ?? ev.resource?.purchase_units?.[0]?.custom_id ?? null
  const nuevo = await registrarEvento(c, `pp_${ev.id}`, 'paypal', ev.event_type, pedidoId, cuerpo)
  if (!nuevo || !pedidoId) return c.json({ ok: true })
  const p = await c.env.DB.prepare("SELECT * FROM pedidos WHERE id = ? AND metodo = 'paypal'").bind(pedidoId).first<FilaPedido>()
  if (!p || p.estado !== 'pendiente') return c.json({ ok: true })
  if (ev.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    await cambiarEstado(c.env, p.id, 'pagado', { nota: 'PayPal: captura completada' })
  } else if (ev.event_type === 'CHECKOUT.ORDER.APPROVED' && p.proveedor_id) {
    if (await capturarOrdenPaypal(c.env, p.proveedor_id)) await cambiarEstado(c.env, p.id, 'pagado', { nota: 'PayPal capturado (aviso)' })
  }
  return c.json({ ok: true })
})

/* ---------- Interno: Worker de WhatsApp ---------- */

export const interno = new Hono<App>()
interno.use('*', requiereInterno)

interno.post('/pedidos', async (c) => {
  const b = await leerJson(c.req.raw)
  const cliente = (b.cliente ?? {}) as Record<string, unknown>
  const r = await crearPedido(c.env, {
    items: b.items as never,
    metodo: normalizarMetodo(b.metodo_pago),
    canal: b.canal === 'admin' ? 'admin' : 'whatsapp',
    usuario: null,
    correo: cliente.correo ? normalizarCorreo(cliente.correo) : null,
    nombre: texto(cliente.nombre, 120),
    telefono: texto(cliente.telefono, 30),
    entrega: validarEntrega(b.entrega),
    notas: texto(b.notas, 1000),
  })
  return c.json(
    {
      pedido_id: r.pedido.id,
      codigo: r.pedido.codigo,
      total_gtq: r.pedido.total_gtq,
      envio_gtq: r.pedido.envio_gtq,
      estado: r.pedido.estado,
      enlace_pago: r.enlace_pago,
      instrucciones_pago: r.instrucciones_pago,
      pedido: r.pedido,
    },
    201,
  )
})

interno.get('/pedidos/:id', async (c) => c.json(await pedidoPublico(c.env, c.req.param('id'))))

interno.post('/pedidos/:id/comprobante', async (c) =>
  c.json(await guardarComprobante(c.env, c.req.param('id'), c.req.raw, texto(c.req.query('referencia'), 80))),
)
