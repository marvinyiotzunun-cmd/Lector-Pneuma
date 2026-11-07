import type { Env } from '../env'
import { falla } from '../lib/util'

export const paypalConfigurado = (env: Env) => !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET)
const base = (env: Env) => (env.PAYPAL_MODO === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com')

async function tokenPaypal(env: Env): Promise<string> {
  const r = await fetch(`${base(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const d = (await r.json().catch(() => ({}))) as { access_token?: string }
  if (!r.ok || !d.access_token) throw falla(502, 'pasarela_error', 'No se pudo conectar con PayPal.')
  return d.access_token
}

/**
 * PayPal no acepta quetzales: se cobra en USD al tipo de cambio de ajustes.tipo_cambio_usd (Q por US$1).
 */
export async function crearOrdenPaypal(
  env: Env,
  p: { pedidoId: string; codigo: string; totalCentavosGtq: number; tipoCambio: number; exito: string; cancelar: string },
): Promise<{ id: string; url: string; usd: string }> {
  if (!paypalConfigurado(env)) throw falla(503, 'pasarela_no_configurada', 'El pago con PayPal todavía no está activo.')
  const usd = (Math.ceil((p.totalCentavosGtq / p.tipoCambio)) / 100).toFixed(2)
  const r = await fetch(`${base(env)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await tokenPaypal(env)}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': p.pedidoId },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: p.pedidoId,
          custom_id: p.pedidoId,
          invoice_id: p.codigo,
          description: `Pedido ${p.codigo} · Publicaciones Pneuma`,
          amount: { currency_code: 'USD', value: usd },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Publicaciones Pneuma',
            locale: 'es-GT',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: p.exito,
            cancel_url: p.cancelar,
          },
        },
      },
    }),
  })
  const d = (await r.json().catch(() => ({}))) as { id?: string; links?: { rel: string; href: string }[] }
  const url = d.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href
  if (!r.ok || !d.id || !url) {
    console.error('PayPal', r.status, JSON.stringify(d).slice(0, 300))
    throw falla(502, 'pasarela_error', 'No se pudo crear el pago con PayPal.')
  }
  return { id: d.id, url, usd }
}

/** Captura una orden aprobada. Devuelve true si quedó pagada. */
export async function capturarOrdenPaypal(env: Env, ordenId: string): Promise<boolean> {
  const token = await tokenPaypal(env)
  const r = await fetch(`${base(env)}/v2/checkout/orders/${encodeURIComponent(ordenId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const d = (await r.json().catch(() => ({}))) as { status?: string; details?: { issue?: string }[] }
  if (r.ok && d.status === 'COMPLETED') return true
  // Ya capturada antes (por el webhook o un doble clic).
  if (d.details?.some((x) => x.issue === 'ORDER_ALREADY_CAPTURED')) return true
  const g = await fetch(`${base(env)}/v2/checkout/orders/${encodeURIComponent(ordenId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const o = (await g.json().catch(() => ({}))) as { status?: string }
  return o.status === 'COMPLETED'
}

/** Verifica un webhook con la API de PayPal (verify-webhook-signature). */
export async function verificarWebhookPaypal(env: Env, req: Request, cuerpo: string): Promise<boolean> {
  if (!paypalConfigurado(env) || !env.PAYPAL_WEBHOOK_ID) return false
  const h = (n: string) => req.headers.get(n)
  const r = await fetch(`${base(env)}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await tokenPaypal(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: JSON.parse(cuerpo),
    }),
  })
  const d = (await r.json().catch(() => ({}))) as { verification_status?: string }
  return d.verification_status === 'SUCCESS'
}
