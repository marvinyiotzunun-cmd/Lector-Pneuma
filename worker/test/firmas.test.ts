import { describe, expect, it } from 'vitest'
import { verificarFirmaRecurrente } from '../src/pagos/recurrente'

async function firmar(secretoB64: string, id: string, ts: string, cuerpo: string) {
  const raw = Uint8Array.from(atob(secretoB64), (c) => c.charCodeAt(0))
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${cuerpo}`)))
  return btoa(String.fromCharCode(...s))
}

describe('firma Svix de Recurrente', () => {
  const secreto = btoa('secreto-de-prueba-para-svix-0123')
  const env = { RECURRENTE_WEBHOOK_SECRET: `whsec_${secreto}` } as any
  const cuerpo = '{"event_type":"intent.succeeded","checkout":{"id":"ch_1"}}'

  it('acepta una firma válida y rechaza una alterada o vieja', async () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const firma = await firmar(secreto, 'msg_1', ts, cuerpo)
    const req = (f: string, t = ts) => new Request('https://x', { headers: { 'svix-id': 'msg_1', 'svix-timestamp': t, 'svix-signature': `v1,${f}` } })
    expect(await verificarFirmaRecurrente(env, req(firma), cuerpo)).toBe(true)
    expect(await verificarFirmaRecurrente(env, req(firma), cuerpo + ' ')).toBe(false)
    expect(await verificarFirmaRecurrente(env, req('AAAA' + firma.slice(4)), cuerpo)).toBe(false)
    const viejo = String(Math.floor(Date.now() / 1000) - 3600)
    expect(await verificarFirmaRecurrente(env, req(await firmar(secreto, 'msg_1', viejo, cuerpo), viejo), cuerpo)).toBe(false)
  })
})
