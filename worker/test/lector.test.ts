import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { json, libro, paginasHtml, pedir, usuario } from './ayuda'
import { leerHuellaInvisible } from '../src/lib/marca'

describe('lector protegido', () => {
  it('sirve la muestra a cualquiera con sesión y bloquea el resto sin acceso', async () => {
    const l = await libro()
    await paginasHtml(l.id, l.admin.token, 5)
    const u = await usuario()
    const m = await json(await pedir(`/obras/${l.id}/manifiesto`, { token: u.token }))
    expect(m.total_paginas).toBe(5)
    expect(m.acceso).toBeNull()
    expect(m.paginas_permitidas).toBe(2)

    const p1 = await pedir(`/obras/${l.id}/paginas/1`, { token: u.token })
    expect(p1.status).toBe(200)
    expect(p1.headers.get('cache-control')).toContain('no-store')
    const html = await p1.text()
    expect(html).toContain(u.correo)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onclick')
    const huella = p1.headers.get('x-pneuma-huella')!
    expect(leerHuellaInvisible(html)).toBe(huella)

    const p3 = await pedir(`/obras/${l.id}/paginas/3`, { token: u.token })
    expect(p3.status).toBe(403)

    // La huella lleva al usuario que pidió la página.
    const rastreo = await json(await pedir(`/admin/huella/${huella}`, { token: l.admin.token }))
    expect(rastreo.correo).toBe(u.correo)
    expect(rastreo.pagina).toBe(1)
  })

  it('exige dispositivo registrado y limita páginas por minuto', async () => {
    const l = await libro({ paginas_muestra: 5 })
    await paginasHtml(l.id, l.admin.token, 5)
    const sinDisp = await usuario('lector', { dispositivo: false })
    expect((await pedir(`/obras/${l.id}/paginas/1`, { token: sinDisp.token })).status).toBe(428)

    await env.DB.prepare("UPDATE ajustes SET valor = '3' WHERE clave = 'paginas_por_minuto'").run()
    const u = await usuario()
    for (let i = 1; i <= 3; i++) expect((await pedir(`/obras/${l.id}/paginas/${i}`, { token: u.token })).status).toBe(200)
    expect((await pedir(`/obras/${l.id}/paginas/4`, { token: u.token })).status).toBe(429)
    await env.DB.prepare("UPDATE ajustes SET valor = '40' WHERE clave = 'paginas_por_minuto'").run()
  })

  it('envuelve las páginas de imagen en SVG con marca de agua', async () => {
    const l = await libro()
    await pedir(`/admin/libros/${l.id}/manifiesto`, {
      method: 'PUT',
      token: l.admin.token,
      json: { formato: 'pdf', tipo_pagina: 'webp', total_paginas: 1, ancho: 600, alto: 800 },
    })
    await pedir(`/admin/libros/${l.id}/paginas/1`, {
      method: 'PUT',
      token: l.admin.token,
      headers: { 'Content-Type': 'image/webp' },
      body: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]),
    })
    const u = await usuario()
    const r = await pedir(`/obras/${l.id}/paginas/1`, { token: u.token })
    expect(r.headers.get('content-type')).toBe('image/svg+xml')
    const svg = await r.text()
    expect(svg).toContain('data:image/webp;base64,')
    expect(svg).toContain(u.correo)
  })

  it('guarda progreso, marcadores y subrayados', async () => {
    const l = await libro()
    await paginasHtml(l.id, l.admin.token, 3)
    const u = await usuario()
    expect((await pedir(`/obras/${l.id}/progreso`, { method: 'PUT', token: u.token, json: { ubicacion: '2', porcentaje: 40 } })).status).toBe(200)
    expect((await json(await pedir(`/obras/${l.id}/progreso`, { token: u.token }))).porcentaje).toBe(40)
    await pedir(`/obras/${l.id}/marcadores`, { method: 'POST', token: u.token, json: { id: 'marcador-1', ubicacion: '2', etiqueta: 'Aquí' } })
    expect(await json(await pedir(`/obras/${l.id}/marcadores`, { token: u.token }))).toHaveLength(1)
    const s = await json(await pedir(`/obras/${l.id}/subrayados`, { method: 'POST', token: u.token, json: { ubicacion: '1', texto: 'Página 1' } }))
    await pedir(`/obras/${l.id}/subrayados/${s.id}`, { method: 'PATCH', token: u.token, json: { nota: 'Importante' } })
    const lista = await json(await pedir(`/obras/${l.id}/subrayados`, { token: u.token }))
    expect(lista[0].nota).toBe('Importante')
  })
})

describe('lectura sin conexión', () => {
  it('emite licencia con la clave envuelta y entrega páginas cifradas que el dispositivo descifra', async () => {
    const l = await libro()
    await paginasHtml(l.id, l.admin.token, 2)
    const u = await usuario('lector', { plataforma: 'android' })
    await env.DB.prepare("INSERT INTO accesos (id, usuario_id, libro_id, tipo) VALUES ('acc_offline', ?, ?, 'compra')").bind(u.id, l.id).run()

    const par = (await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt'],
    )) as CryptoKeyPair
    const spki = new Uint8Array((await crypto.subtle.exportKey('spki', par.publicKey)) as ArrayBuffer)
    const b64 = btoa(String.fromCharCode(...spki))
    const r = await pedir(`/obras/${l.id}/licencia-offline`, { method: 'POST', token: u.token, json: { id_dispositivo: u.dispositivo, clave_publica: b64 } })
    expect(r.status).toBe(200)
    const lic = await json(r)
    expect(lic.total_paginas).toBe(2)

    const envuelta = Uint8Array.from(atob(lic.clave_envuelta), (ch) => ch.charCodeAt(0))
    const claveRaw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, par.privateKey, envuelta)
    const clave = await crypto.subtle.importKey('raw', claveRaw, 'AES-GCM', false, ['decrypt'])
    const paquete = new Uint8Array(await (await pedir(`/obras/${l.id}/paquete/1`, { token: u.token })).arrayBuffer())
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: paquete.slice(0, 12) }, clave, paquete.slice(12))
    expect(new TextDecoder().decode(claro)).toContain('Página 1')
  })

  it('no da licencia en web ni sin acceso completo', async () => {
    const l = await libro()
    await paginasHtml(l.id, l.admin.token, 2)
    const web = await usuario('lector', { plataforma: 'web' })
    expect((await pedir(`/obras/${l.id}/licencia-offline`, { method: 'POST', token: web.token, json: { clave_publica: 'x' } })).status).toBe(403)
    const app = await usuario('lector', { plataforma: 'android' })
    expect((await pedir(`/obras/${l.id}/licencia-offline`, { method: 'POST', token: app.token, json: { clave_publica: 'x' } })).status).toBe(403)
    expect((await pedir(`/obras/${l.id}/paquete/1`, { token: app.token })).status).toBe(403)
  })
})
