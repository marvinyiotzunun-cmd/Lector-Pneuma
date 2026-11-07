import type { Env, Usuario } from '../env'
import { ajuste, ajusteNum } from '../lib/ajustes'
import { enviarCorreo, marcoCorreo } from '../lib/correo'
import type { FilaLibro } from '../lib/libros'
import { aGtq, ahora, enDias, escaparHtml, falla, nuevoId, texto } from '../lib/util'
import { crearCheckoutRecurrente } from '../pagos/recurrente'
import { crearOrdenPaypal } from '../pagos/paypal'

export type Metodo = 'recurrente' | 'paypal' | 'transferencia' | 'billetera' | 'gratis'
export type Estado = 'pendiente' | 'en_revision' | 'pagado' | 'enviado' | 'entregado' | 'cancelado' | 'reembolsado'
export type Modalidad = 'impreso' | 'compra' | 'alquiler' | 'plan'

export interface FilaPedido {
  id: string
  codigo: string
  usuario_id: string | null
  correo: string | null
  nombre: string | null
  telefono: string | null
  canal: 'web' | 'whatsapp' | 'admin'
  estado: Estado
  metodo: Metodo
  subtotal_centavos: number
  envio_centavos: number
  total_centavos: number
  moneda: string
  entrega: string | null
  proveedor_id: string | null
  enlace_pago: string | null
  referencia: string | null
  comprobante_clave: string | null
  notas: string | null
  confirmado_por: string | null
  creado_en: string
  actualizado_en: string
  pagado_en: string | null
}

export interface ItemEntrada {
  modalidad?: unknown
  libro_id?: unknown
  plan_id?: unknown
  cantidad?: unknown
}

export interface Entrega {
  nombre?: string | null
  direccion: string
  municipio: string | null
  departamento: string | null
  referencia: string | null
}

export interface NuevoPedido {
  items: ItemEntrada[]
  metodo: Metodo
  canal: 'web' | 'whatsapp' | 'admin'
  usuario: Usuario | null
  correo: string | null
  nombre: string | null
  telefono: string | null
  entrega: Entrega | null
  iglesiaNombre?: string | null
  notas?: string | null
}

const TRANSICIONES: Record<Estado, Estado[]> = {
  pendiente: ['en_revision', 'pagado', 'cancelado'],
  en_revision: ['pagado', 'cancelado', 'pendiente'],
  pagado: ['enviado', 'entregado', 'reembolsado'],
  enviado: ['entregado', 'reembolsado'],
  entregado: ['reembolsado'],
  cancelado: [],
  reembolsado: [],
}

export function normalizarMetodo(m: unknown): Metodo {
  const v = m === 'tarjeta' ? 'recurrente' : m
  if (v === 'recurrente' || v === 'paypal' || v === 'transferencia' || v === 'billetera') return v
  throw falla(400, 'metodo_invalido', 'Método de pago inválido (recurrente, tarjeta, paypal, transferencia o billetera).')
}

export function validarEntrega(e: unknown): Entrega | null {
  if (e == null) return null
  if (typeof e !== 'object') throw falla(400, 'entrega_invalida', 'Datos de entrega inválidos.')
  const o = e as Record<string, unknown>
  const direccion = texto(o.direccion, 400)
  if (!direccion) throw falla(400, 'entrega_invalida', 'Falta la dirección de entrega.')
  return {
    nombre: texto(o.nombre, 120),
    direccion,
    municipio: texto(o.municipio, 80),
    departamento: texto(o.departamento, 80),
    referencia: texto(o.referencia, 300),
  }
}

async function siguienteCodigo(env: Env): Promise<string> {
  const r = await env.DB.prepare("UPDATE contadores SET valor = valor + 1 WHERE nombre = 'pedidos' RETURNING valor").first<{
    valor: number
  }>()
  return `PN-${String(r!.valor).padStart(6, '0')}`
}

interface LineaCalculada {
  modalidad: Modalidad
  libro_id: string | null
  plan_id: string | null
  descripcion: string
  cantidad: number
  precio: number
}

async function calcularLineas(env: Env, items: ItemEntrada[], modalidadPorDefecto: Modalidad): Promise<LineaCalculada[]> {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw falla(400, 'items_invalidos', 'El pedido no tiene productos.')
  const lineas: LineaCalculada[] = []
  for (const it of items) {
    const modalidad = (it.modalidad ?? modalidadPorDefecto) as Modalidad
    const cantidad = it.cantidad == null ? 1 : Number(it.cantidad)
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 500) throw falla(400, 'cantidad_invalida', 'Cantidad inválida.')
    if (modalidad === 'plan') {
      const plan = await env.DB.prepare('SELECT id, nombre, precio_centavos FROM planes WHERE id = ? AND activo = 1')
        .bind(String(it.plan_id ?? ''))
        .first<{ id: string; nombre: string; precio_centavos: number }>()
      if (!plan) throw falla(400, 'plan_invalido', 'Ese plan no existe.')
      lineas.push({ modalidad, libro_id: null, plan_id: plan.id, descripcion: `Suscripción: ${plan.nombre}`, cantidad: 1, precio: plan.precio_centavos })
      continue
    }
    if (!['impreso', 'compra', 'alquiler'].includes(modalidad)) throw falla(400, 'modalidad_invalida', 'Modalidad inválida.')
    const l = await env.DB.prepare('SELECT * FROM libros WHERE id = ? AND publicado = 1').bind(String(it.libro_id ?? '')).first<FilaLibro>()
    if (!l) throw falla(400, 'libro_invalido', 'Uno de los libros no está disponible.')
    if (modalidad === 'impreso') {
      if (!l.impreso || l.precio_impreso_centavos == null) throw falla(400, 'no_impreso', `«${l.titulo}» no se vende impreso.`)
      if (l.existencias != null && l.existencias < cantidad) throw falla(409, 'sin_existencias', `No hay suficientes ejemplares de «${l.titulo}».`)
      lineas.push({ modalidad, libro_id: l.id, plan_id: null, descripcion: `${l.titulo} (impreso)`, cantidad, precio: l.precio_impreso_centavos })
    } else {
      const precio = modalidad === 'compra' ? l.precio_compra_centavos : l.precio_alquiler_centavos
      if (!l.digital_activo || !l.formato_digital || precio == null) {
        throw falla(400, 'no_digital', `«${l.titulo}» no está disponible en ${modalidad === 'compra' ? 'compra' : 'alquiler'} digital.`)
      }
      const desc = modalidad === 'compra' ? `${l.titulo} (digital)` : `${l.titulo} (alquiler ${l.dias_alquiler} días)`
      lineas.push({ modalidad, libro_id: l.id, plan_id: null, descripcion: desc, cantidad: 1, precio })
    }
  }
  return lineas
}

export async function crearPedido(env: Env, p: NuevoPedido) {
  const lineas = await calcularLineas(env, p.items, p.canal === 'whatsapp' ? 'impreso' : 'compra')
  const digitales = lineas.some((l) => l.modalidad !== 'impreso')
  const correo = p.usuario?.correo ?? p.correo
  if (digitales && !correo) throw falla(400, 'falta_correo', 'Los libros digitales y suscripciones necesitan un correo.')
  if (!correo && !p.telefono) throw falla(400, 'falta_contacto', 'Indica un correo o un teléfono.')
  const hayImpresos = lineas.some((l) => l.modalidad === 'impreso')
  const subtotal = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0)
  // Sin entrega = recoge en la oficina de Pneuma, sin costo de envío.
  const envio = hayImpresos && p.entrega ? await ajusteNum(env, 'envio_centavos', 0) : 0
  const total = subtotal + envio
  const metodo: Metodo = total === 0 ? 'gratis' : p.metodo

  const id = nuevoId('ped')
  const codigo = await siguienteCodigo(env)
  const notas = [p.notas, p.iglesiaNombre ? `Iglesia: ${p.iglesiaNombre}` : null].filter(Boolean).join('\n') || null
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pedidos (id, codigo, usuario_id, correo, nombre, telefono, canal, metodo, subtotal_centavos, envio_centavos, total_centavos, entrega, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      codigo,
      p.usuario?.id ?? null,
      correo,
      p.nombre ?? p.usuario?.nombre ?? null,
      p.telefono ?? p.usuario?.telefono ?? null,
      p.canal,
      metodo,
      subtotal,
      envio,
      total,
      p.entrega ? JSON.stringify(p.entrega) : null,
      notas,
    ),
    ...lineas.map((l) =>
      env.DB.prepare(
        `INSERT INTO pedido_items (id, pedido_id, modalidad, libro_id, plan_id, descripcion, cantidad, precio_unitario_centavos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(nuevoId('itm'), id, l.modalidad, l.libro_id, l.plan_id, l.descripcion, l.cantidad, l.precio),
    ),
  ])

  if (metodo === 'gratis') {
    await cambiarEstado(env, id, 'pagado', { nota: 'Total cero' })
    return { pedido: await pedidoPublico(env, id), enlace_pago: null, instrucciones_pago: null }
  }

  const exito = `${env.SITIO_URL}/pedido/${codigo}?estado=exito`
  const cancelar = `${env.SITIO_URL}/pedido/${codigo}?estado=cancelado`
  let enlace: string | null = null
  try {
    if (metodo === 'recurrente') {
      const items = lineas.map((l) => ({ nombre: l.descripcion, centavos: l.precio, cantidad: l.cantidad }))
      if (envio) items.push({ nombre: 'Envío a domicilio', centavos: envio, cantidad: 1 })
      const ch = await crearCheckoutRecurrente(env, { items, correo, exito, cancelar, metadata: { pedido_id: id, codigo } })
      enlace = ch.url
      await env.DB.prepare('UPDATE pedidos SET proveedor_id = ?, enlace_pago = ? WHERE id = ?').bind(ch.id, ch.url, id).run()
    } else if (metodo === 'paypal') {
      const tc = Number(await ajuste(env, 'tipo_cambio_usd', '7.63'))
      const o = await crearOrdenPaypal(env, { pedidoId: id, codigo, totalCentavosGtq: total, tipoCambio: tc, exito: `${exito}&pedido=${id}`, cancelar })
      enlace = o.url
      await env.DB.prepare('UPDATE pedidos SET proveedor_id = ?, enlace_pago = ?, notas = COALESCE(notas || char(10), \'\') || ? WHERE id = ?')
        .bind(o.id, o.url, `PayPal: US$${o.usd}`, id)
        .run()
    }
  } catch (e) {
    // Si la pasarela falla, el pedido queda cancelado para no dejar basura.
    await env.DB.prepare("UPDATE pedidos SET estado = 'cancelado', notas = COALESCE(notas || char(10), '') || 'Pasarela no disponible' WHERE id = ?")
      .bind(id)
      .run()
    throw e
  }

  const instrucciones = metodo === 'transferencia' || metodo === 'billetera' ? await instruccionesPago(env, metodo, codigo, total) : null
  const pedido = await pedidoPublico(env, id)
  if (correo) {
    await enviarCorreo(env, {
      para: correo,
      asunto: `Recibimos tu pedido ${codigo}`,
      plantilla: 'pedido_creado',
      html: marcoCorreo(
        `Pedido ${codigo}`,
        `${tablaItems(pedido)}${
          instrucciones
            ? `<p><strong>Cómo pagar:</strong> ${escaparHtml(instrucciones.texto)}</p><p>Cuando pagues, sube la foto de la boleta en la página de tu pedido.</p>`
            : enlace
              ? '<p>Si no terminaste el pago, usa el botón.</p>'
              : ''
        }`,
        enlace ? { texto: 'Pagar ahora', url: enlace } : { texto: 'Ver mi pedido', url: `${env.SITIO_URL}/pedido/${codigo}` },
      ),
    })
  }
  return { pedido, enlace_pago: enlace, instrucciones_pago: instrucciones }
}

export async function instruccionesPago(env: Env, metodo: 'transferencia' | 'billetera', codigo: string, total: number) {
  const parse = (s: string) => {
    try {
      const v = JSON.parse(s)
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  const cuentas = parse(await ajuste(env, metodo === 'transferencia' ? 'cuentas_bancarias' : 'billeteras', '[]'))
  const monto = `Q${aGtq(total)!.toFixed(2)}`
  const detalle = cuentas
    .map((c: Record<string, string>) => [c.banco ?? c.nombre, c.tipo, c.numero, c.nombre && c.banco ? `a nombre de ${c.nombre}` : c.instrucciones].filter(Boolean).join(' · '))
    .join(' | ')
  return {
    metodo,
    monto_gtq: aGtq(total),
    referencia: codigo,
    cuentas,
    texto: `${metodo === 'transferencia' ? 'Deposita o transfiere' : 'Paga con tu billetera'} ${monto} ${detalle ? `a: ${detalle}` : '(Pneuma te enviará los datos de pago)'}. Escribe ${codigo} como referencia.`,
  }
}

export async function pedidoPublico(env: Env, id: string) {
  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first<FilaPedido>()
  if (!p) throw falla(404, 'no_existe', 'Ese pedido no existe.')
  const { results: items } = await env.DB.prepare(
    'SELECT modalidad, libro_id, plan_id, descripcion, cantidad, precio_unitario_centavos FROM pedido_items WHERE pedido_id = ?',
  )
    .bind(id)
    .all<{ modalidad: Modalidad; libro_id: string | null; plan_id: string | null; descripcion: string; cantidad: number; precio_unitario_centavos: number }>()
  return {
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
    metodo: p.metodo,
    canal: p.canal,
    correo: p.correo,
    nombre: p.nombre,
    telefono: p.telefono,
    subtotal_gtq: aGtq(p.subtotal_centavos),
    envio_gtq: aGtq(p.envio_centavos),
    total_gtq: aGtq(p.total_centavos),
    entrega: p.entrega ? (JSON.parse(p.entrega) as Entrega) : null,
    enlace_pago: p.estado === 'pendiente' ? p.enlace_pago : null,
    referencia: p.referencia,
    tiene_comprobante: !!p.comprobante_clave,
    creado_en: p.creado_en,
    pagado_en: p.pagado_en,
    items: items.map(({ precio_unitario_centavos, ...i }) => ({ ...i, precio_unitario_gtq: aGtq(precio_unitario_centavos) })),
  }
}

type PedidoPublico = Awaited<ReturnType<typeof pedidoPublico>>

function tablaItems(p: PedidoPublico) {
  const filas = p.items
    .map((i) => `<tr><td style="padding:4px 0">${i.cantidad} × ${escaparHtml(i.descripcion)}</td><td align="right">Q${(i.precio_unitario_gtq! * i.cantidad).toFixed(2)}</td></tr>`)
    .join('')
  const envio = p.envio_gtq ? `<tr><td>Envío</td><td align="right">Q${p.envio_gtq.toFixed(2)}</td></tr>` : ''
  return `<table width="100%" style="font-size:14px;border-collapse:collapse">${filas}${envio}<tr><td style="border-top:1px solid #ddd;padding-top:6px"><strong>Total</strong></td><td align="right" style="border-top:1px solid #ddd;padding-top:6px"><strong>Q${p.total_gtq!.toFixed(2)}</strong></td></tr></table>`
}

/** Busca o crea la cuenta de lector para un correo (para entregar libros digitales comprados sin sesión). */
async function usuarioParaCorreo(env: Env, correo: string, nombre: string | null): Promise<string> {
  const u = await env.DB.prepare('SELECT id FROM usuarios WHERE correo = ?').bind(correo).first<{ id: string }>()
  if (u) return u.id
  const id = nuevoId('usr')
  await env.DB.prepare('INSERT INTO usuarios (id, correo, nombre) VALUES (?, ?, ?) ON CONFLICT (correo) DO NOTHING').bind(id, correo, nombre).run()
  return (await env.DB.prepare('SELECT id FROM usuarios WHERE correo = ?').bind(correo).first<{ id: string }>())!.id
}

/** Entrega lo comprado: accesos digitales, suscripciones y descuento de existencias. */
async function entregar(env: Env, p: FilaPedido) {
  const { results: items } = await env.DB.prepare('SELECT * FROM pedido_items WHERE pedido_id = ?').bind(p.id).all<{
    modalidad: Modalidad
    libro_id: string | null
    plan_id: string | null
    cantidad: number
  }>()
  const stmts: D1PreparedStatement[] = []
  let usuarioId = p.usuario_id
  if (items.some((i) => i.modalidad !== 'impreso') && !usuarioId && p.correo) {
    usuarioId = await usuarioParaCorreo(env, p.correo, p.nombre)
    stmts.push(env.DB.prepare('UPDATE pedidos SET usuario_id = ? WHERE id = ?').bind(usuarioId, p.id))
  }
  const t = ahora()
  for (const i of items) {
    if (i.modalidad === 'impreso' && i.libro_id) {
      stmts.push(env.DB.prepare('UPDATE libros SET existencias = MAX(existencias - ?, 0) WHERE id = ? AND existencias IS NOT NULL').bind(i.cantidad, i.libro_id))
    } else if ((i.modalidad === 'compra' || i.modalidad === 'alquiler') && i.libro_id && usuarioId) {
      let vence: string | null = null
      if (i.modalidad === 'alquiler') {
        const l = await env.DB.prepare('SELECT dias_alquiler FROM libros WHERE id = ?').bind(i.libro_id).first<{ dias_alquiler: number }>()
        vence = enDias(l?.dias_alquiler ?? 30)
      }
      stmts.push(
        env.DB.prepare('INSERT INTO accesos (id, usuario_id, libro_id, tipo, vence_en, pedido_id) VALUES (?, ?, ?, ?, ?, ?)').bind(
          nuevoId('acc'),
          usuarioId,
          i.libro_id,
          i.modalidad,
          vence,
          p.id,
        ),
      )
    } else if (i.modalidad === 'plan' && i.plan_id && usuarioId) {
      const plan = await env.DB.prepare('SELECT id, tipo, dias, nombre FROM planes WHERE id = ?').bind(i.plan_id).first<{
        id: string
        tipo: 'individual' | 'iglesia'
        dias: number
        nombre: string
      }>()
      if (!plan) continue
      let iglesiaId: string | null = null
      if (plan.tipo === 'iglesia') {
        const ex = await env.DB.prepare('SELECT id FROM iglesias WHERE titular_id = ? ORDER BY creado_en LIMIT 1').bind(usuarioId).first<{ id: string }>()
        iglesiaId = ex?.id ?? nuevoId('igl')
        if (!ex) {
          const nombre = p.notas?.match(/Iglesia: (.+)/)?.[1] ?? `Iglesia de ${p.nombre ?? p.correo}`
          stmts.push(env.DB.prepare('INSERT INTO iglesias (id, nombre, titular_id) VALUES (?, ?, ?)').bind(iglesiaId, nombre, usuarioId))
        }
      }
      // Renovar: empieza cuando vence la vigente del mismo titular.
      const vigente = await env.DB.prepare(
        `SELECT vence_en FROM suscripciones WHERE estado = 'activa' AND vence_en > ? AND ${iglesiaId ? 'iglesia_id' : 'usuario_id'} = ?
          ORDER BY vence_en DESC LIMIT 1`,
      )
        .bind(t, iglesiaId ?? usuarioId)
        .first<{ vence_en: string }>()
      const inicia = vigente?.vence_en ?? t
      stmts.push(
        env.DB.prepare('INSERT INTO suscripciones (id, plan_id, usuario_id, iglesia_id, inicia_en, vence_en, pedido_id) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
          nuevoId('sus'),
          plan.id,
          iglesiaId ? null : usuarioId,
          iglesiaId,
          inicia,
          enDias(plan.dias, new Date(inicia)),
          p.id,
        ),
      )
    }
  }
  if (stmts.length) await env.DB.batch(stmts)
}

async function avisarWhatsapp(env: Env, p: FilaPedido, estado: Estado) {
  if (p.canal !== 'whatsapp' || !env.WHATSAPP_WORKER_URL || !env.INTERNAL_TOKEN) return
  if (!['en_revision', 'pagado', 'enviado', 'entregado', 'cancelado'].includes(estado)) return
  try {
    const r = await fetch(`${env.WHATSAPP_WORKER_URL.replace(/\/$/, '')}/interno/eventos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.INTERNAL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: `pedido.${estado}`, pedido_id: p.id, codigo: p.codigo, canal: p.canal, telefono: p.telefono, total_gtq: aGtq(p.total_centavos) }),
    })
    if (!r.ok) console.error('Aviso a WhatsApp falló', r.status)
  } catch (e) {
    console.error('Aviso a WhatsApp falló', e)
  }
}

const ASUNTOS: Partial<Record<Estado, string>> = {
  en_revision: 'Recibimos tu comprobante',
  pagado: 'Pago confirmado',
  enviado: 'Tu pedido va en camino',
  entregado: 'Pedido entregado',
  cancelado: 'Pedido cancelado',
  reembolsado: 'Reembolso de tu pedido',
}

async function correoDeEstado(env: Env, p: FilaPedido, estado: Estado) {
  if (!p.correo || !ASUNTOS[estado]) return
  const pub = await pedidoPublico(env, p.id)
  const digital = pub.items.some((i) => i.modalidad !== 'impreso')
  const mensajes: Partial<Record<Estado, string>> = {
    en_revision: 'El equipo de Pneuma revisará tu pago y te avisará en cuanto lo confirme.',
    pagado: digital
      ? 'Tus libros digitales ya están en tu biblioteca. Entra con este mismo correo para leerlos.'
      : 'Prepararemos tu pedido y te avisaremos cuando salga.',
    enviado: 'Tu pedido salió hacia la dirección que indicaste.',
    entregado: 'Gracias por tu compra. Que Dios te bendiga en la lectura.',
    cancelado: 'Si fue un error, escríbenos y lo resolvemos.',
    reembolsado: 'Procesamos el reembolso de tu pedido.',
  }
  const boton =
    estado === 'pagado' && digital
      ? { texto: 'Ir a mi biblioteca', url: `${env.SITIO_URL}/biblioteca` }
      : { texto: 'Ver mi pedido', url: `${env.SITIO_URL}/pedido/${p.codigo}` }
  await enviarCorreo(env, {
    para: p.correo,
    asunto: `${ASUNTOS[estado]} · ${p.codigo}`,
    plantilla: `pedido_${estado}`,
    html: marcoCorreo(`${ASUNTOS[estado]}`, `<p>${mensajes[estado]}</p>${tablaItems(pub)}`, boton),
  })
}

/**
 * Cambia el estado de un pedido respetando las transiciones válidas.
 * Al pasar a "pagado" entrega accesos y suscripciones. Idempotente: si ya está en ese estado no hace nada.
 */
export async function cambiarEstado(
  env: Env,
  id: string,
  estado: Estado,
  op: { nota?: string | null; por?: string | null; referencia?: string | null } = {},
): Promise<boolean> {
  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first<FilaPedido>()
  if (!p) throw falla(404, 'no_existe', 'Ese pedido no existe.')
  if (p.estado === estado) return false
  if (!TRANSICIONES[p.estado].includes(estado)) {
    throw falla(409, 'transicion_invalida', `Un pedido ${p.estado.replace('_', ' ')} no puede pasar a ${estado.replace('_', ' ')}.`)
  }
  const t = ahora()
  // Condición sobre el estado anterior: si dos avisos llegan a la vez, solo uno gana.
  const r = await env.DB.prepare(
    `UPDATE pedidos SET estado = ?, actualizado_en = ?, pagado_en = CASE WHEN ? = 'pagado' THEN ? ELSE pagado_en END,
            confirmado_por = COALESCE(?, confirmado_por), referencia = COALESCE(?, referencia),
            notas = CASE WHEN ? IS NULL THEN notas ELSE COALESCE(notas || char(10), '') || ? END
      WHERE id = ? AND estado = ?`,
  )
    .bind(estado, t, estado, t, op.por ?? null, op.referencia ?? null, op.nota ?? null, op.nota ?? null, id, p.estado)
    .run()
  if (!r.meta.changes) return false
  if (estado === 'pagado') await entregar(env, p)
  if (estado === 'reembolsado' || estado === 'cancelado') {
    await env.DB.batch([
      env.DB.prepare("UPDATE accesos SET revocado_en = ? WHERE pedido_id = ? AND revocado_en IS NULL").bind(t, id),
      env.DB.prepare("UPDATE suscripciones SET estado = 'cancelada' WHERE pedido_id = ?").bind(id),
    ])
  }
  const actualizado = { ...p, estado }
  await Promise.all([correoDeEstado(env, actualizado, estado), avisarWhatsapp(env, actualizado, estado)])
  return true
}

const MIME_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

export async function guardarComprobante(env: Env, id: string, req: Request, referencia: string | null) {
  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first<FilaPedido>()
  if (!p) throw falla(404, 'no_existe', 'Ese pedido no existe.')
  if (!['pendiente', 'en_revision'].includes(p.estado)) throw falla(409, 'pedido_cerrado', 'Este pedido ya no espera comprobante.')
  const tipo = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!MIME_COMPROBANTE.includes(tipo)) throw falla(415, 'tipo_invalido', 'Sube una foto (JPG, PNG, WEBP) o un PDF.')
  const largo = Number(req.headers.get('content-length') ?? 0)
  if (largo > 8 * 1024 * 1024) throw falla(413, 'muy_grande', 'El archivo pesa más de 8 MB.')
  const datos = await req.arrayBuffer()
  if (!datos.byteLength) throw falla(400, 'vacio', 'El archivo está vacío.')
  if (datos.byteLength > 8 * 1024 * 1024) throw falla(413, 'muy_grande', 'El archivo pesa más de 8 MB.')
  const ext = tipo === 'application/pdf' ? 'pdf' : tipo.split('/')[1]
  const clave = `comprobantes/${id}/${Date.now()}.${ext}`
  await env.ARCHIVOS.put(clave, datos, { httpMetadata: { contentType: tipo } })
  await env.DB.prepare('UPDATE pedidos SET comprobante_clave = ?, referencia = COALESCE(?, referencia), actualizado_en = ? WHERE id = ?')
    .bind(clave, referencia, ahora(), id)
    .run()
  if (p.estado === 'pendiente') await cambiarEstado(env, id, 'en_revision')
  return pedidoPublico(env, id)
}
