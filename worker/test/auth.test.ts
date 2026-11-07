import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { json, pedir, sha256, usuario } from './ayuda'

describe('enlace mágico', () => {
  it('envía el enlace, lo verifica una sola vez y crea la cuenta', async () => {
    const r = await pedir('/auth/enlace', { method: 'POST', json: { correo: 'Lectora@Correo.test', destino: '/biblioteca' } })
    expect(r.status).toBe(200)
    const enviado = await env.DB.prepare("SELECT * FROM correos_enviados WHERE para = 'lectora@correo.test'").first<any>()
    expect(enviado.plantilla).toBe('enlace_acceso')

    // El token real solo va en el correo; para la prueba insertamos uno conocido.
    await env.DB.prepare('INSERT INTO enlaces_acceso (token_hash, correo, destino, expira_en) VALUES (?, ?, ?, ?)')
      .bind(await sha256('token-conocido'), 'lectora@correo.test', '/biblioteca', new Date(Date.now() + 60_000).toISOString())
      .run()
    const v = await pedir('/auth/verificar', {
      method: 'POST',
      json: { token: 'token-conocido', dispositivo: { id: 'disp-lectora-1', nombre: 'Celular', plataforma: 'android' } },
    })
    expect(v.status).toBe(200)
    const d = await json(v)
    expect(d.usuario.correo).toBe('lectora@correo.test')
    expect(d.usuario.rol).toBe('lector')
    expect(d.destino).toBe('/biblioteca')
    expect(v.headers.get('set-cookie')).toContain('pneuma_sesion=')

    const yo = await json(await pedir('/yo', { token: d.sesion.token }))
    expect(yo.dispositivo_id).toBe('disp-lectora-1')

    const otraVez = await pedir('/auth/verificar', { method: 'POST', json: { token: 'token-conocido' } })
    expect(otraVez.status).toBe(400)
  })

  it('da rol admin a los correos de ADMIN_CORREOS', async () => {
    await env.DB.prepare('INSERT INTO enlaces_acceso (token_hash, correo, expira_en) VALUES (?, ?, ?)')
      .bind(await sha256('tok-admin'), 'admin@pneuma.gt', new Date(Date.now() + 60_000).toISOString())
      .run()
    const d = await json(await pedir('/auth/verificar', { method: 'POST', json: { token: 'tok-admin' } }))
    expect(d.usuario.rol).toBe('admin')
  })

  it('rechaza enlaces vencidos y limita los envíos por hora', async () => {
    await env.DB.prepare('INSERT INTO enlaces_acceso (token_hash, correo, expira_en) VALUES (?, ?, ?)')
      .bind(await sha256('vencido'), 'x@correo.test', new Date(Date.now() - 1000).toISOString())
      .run()
    expect((await pedir('/auth/verificar', { method: 'POST', json: { token: 'vencido' } })).status).toBe(400)
    for (let i = 0; i < 5; i++) await pedir('/auth/enlace', { method: 'POST', json: { correo: 'spam@correo.test' } })
    expect((await pedir('/auth/enlace', { method: 'POST', json: { correo: 'spam@correo.test' } })).status).toBe(429)
  })

  it('sin sesión responde 401', async () => {
    const r = await pedir('/yo')
    expect(r.status).toBe(401)
    expect((await json(r)).error.codigo).toBe('sin_sesion')
  })
})

describe('dispositivos', () => {
  it('respeta el límite y permite liberar uno', async () => {
    const u = await usuario('lector', { dispositivo: false })
    for (let i = 1; i <= 3; i++) {
      const r = await pedir('/dispositivos', { method: 'POST', token: u.token, json: { id: `disp-limite-${u.id}-${i}`, plataforma: 'web' } })
      expect(r.status).toBe(200)
    }
    const cuarto = await pedir('/dispositivos', { method: 'POST', token: u.token, json: { id: `disp-limite-${u.id}-4` } })
    expect(cuarto.status).toBe(409)
    const d = await json(cuarto)
    expect(d.error.codigo).toBe('limite_dispositivos')
    expect(d.dispositivos).toHaveLength(3)

    // Quitar el 1 (que también cierra la sesión ligada a él: la sesión actual quedó en el 3).
    expect((await pedir(`/dispositivos/disp-limite-${u.id}-1`, { method: 'DELETE', token: u.token })).status).toBe(200)
    expect((await pedir('/dispositivos', { method: 'POST', token: u.token, json: { id: `disp-limite-${u.id}-4` } })).status).toBe(200)
  })
})
