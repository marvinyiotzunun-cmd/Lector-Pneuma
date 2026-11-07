import type { Env } from '../env'
import { deBase64, aBase64, igualSeguro } from '../lib/cripto'
import { falla } from '../lib/util'

const BASE = 'https://app.recurrente.com/api'

export const recurrenteConfigurado = (env: Env) => !!(env.RECURRENTE_PUBLIC_KEY && env.RECURRENTE_SECRET_KEY)

function cabeceras(env: Env) {
  return {
    'X-PUBLIC-KEY': env.RECURRENTE_PUBLIC_KEY!,
    'X-SECRET-KEY': env.RECURRENTE_SECRET_KEY!,
    'Content-Type': 'application/json',
  }
}

export interface ItemCobro {
  nombre: string
  centavos: number
  cantidad: number
}

/** Crea un checkout de Recurrente (cobro con tarjeta) y devuelve su id y enlace. */
export async function crearCheckoutRecurrente(
  env: Env,
  p: { items: ItemCobro[]; correo: string | null; exito: string; cancelar: string; metadata: Record<string, string> },
): Promise<{ id: string; url: string }> {
  if (!recurrenteConfigurado(env)) throw falla(503, 'pasarela_no_configurada', 'El cobro con tarjeta todavía no está activo.')
  const r = await fetch(`${BASE}/checkouts`, {
    method: 'POST',
    headers: cabeceras(env),
    body: JSON.stringify({
      items: p.items.map((i) => ({ name: i.nombre.slice(0, 120), amount_in_cents: i.centavos, currency: 'GTQ', quantity: i.cantidad })),
      success_url: p.exito,
      cancel_url: p.cancelar,
      ...(p.correo ? { customer_email: p.correo } : {}),
      metadata: p.metadata,
    }),
  })
  const d = (await r.json().catch(() => ({}))) as { id?: string; checkout_url?: string }
  if (!r.ok || !d.id || !d.checkout_url) {
    console.error('Recurrente', r.status, JSON.stringify(d).slice(0, 300))
    throw falla(502, 'pasarela_error', 'No se pudo crear el enlace de pago. Intenta de nuevo o paga por transferencia.')
  }
  return { id: d.id, url: d.checkout_url }
}

export async function estadoCheckoutRecurrente(env: Env, id: string): Promise<string | null> {
  const r = await fetch(`${BASE}/checkouts/${encodeURIComponent(id)}`, { headers: cabeceras(env) })
  if (!r.ok) return null
  const d = (await r.json()) as { status?: string }
  return d.status ?? null
}

/** Verifica la firma Svix de un webhook de Recurrente. */
export async function verificarFirmaRecurrente(env: Env, req: Request, cuerpo: string): Promise<boolean> {
  const secreto = env.RECURRENTE_WEBHOOK_SECRET
  if (!secreto) return false
  const id = req.headers.get('svix-id')
  const ts = req.headers.get('svix-timestamp')
  const firmas = req.headers.get('svix-signature')
  if (!id || !ts || !firmas) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const raw = deBase64(secreto.replace(/^whsec_/, ''))
  const llave = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const esperada = aBase64(await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(`${id}.${ts}.${cuerpo}`)))
  return firmas.split(' ').some((f) => {
    const [version, valor] = f.split(',')
    return version === 'v1' && !!valor && igualSeguro(valor, esperada)
  })
}
