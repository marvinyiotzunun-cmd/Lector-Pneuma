import { env, exports } from 'cloudflare:workers'

const cod = new TextEncoder()
export async function sha256(t: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', cod.encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function pedir(ruta: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers)
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const r = await (exports as any).default.fetch(new Request(`https://pneuma.test/api${ruta}`, { ...init, headers, body }))
  return r as Response
}

export async function json<T = any>(r: Response): Promise<T> {
  return (await r.json()) as T
}

let n = 0
/** Crea un usuario con sesión (y dispositivo opcional) directamente en la base. */
export async function usuario(rol = 'lector', opciones: { dispositivo?: string | false; plataforma?: string } = {}) {
  n++
  const id = `usr_prueba_${n}_${Math.random().toString(36).slice(2, 8)}`
  const correo = `${id}@correo.test`
  const token = `tok_${id}`
  const dispositivo = opciones.dispositivo === false ? null : (opciones.dispositivo ?? `disp_${id}`)
  await env.DB.prepare('INSERT INTO usuarios (id, correo, rol) VALUES (?, ?, ?)').bind(id, correo, rol).run()
  if (dispositivo) {
    await env.DB.prepare('INSERT INTO dispositivos (id, usuario_id, plataforma) VALUES (?, ?, ?)').bind(dispositivo, id, opciones.plataforma ?? 'web').run()
  }
  await env.DB.prepare('INSERT INTO sesiones (token_hash, usuario_id, dispositivo_id, expira_en) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), id, dispositivo, new Date(Date.now() + 86_400_000).toISOString())
    .run()
  return { id, correo, token, dispositivo }
}

export async function libro(campos: Record<string, unknown> = {}) {
  const admin = await usuario('admin')
  const r = await pedir('/admin/libros', {
    method: 'POST',
    token: admin.token,
    json: {
      titulo: 'Libro de prueba',
      autor: 'Autor',
      publicado: true,
      impreso: true,
      precio_impreso_gtq: 85,
      formato_digital: 'pdf',
      digital_activo: true,
      precio_compra_gtq: 60,
      precio_alquiler_gtq: 25,
      dias_alquiler: 30,
      paginas_muestra: 2,
      ...campos,
    },
  })
  if (r.status !== 201) throw new Error(`crear libro: ${r.status} ${await r.text()}`)
  return { ...(await json(r)), admin }
}

/** Sube un manifiesto y n páginas HTML a R2 (como lo haría el panel). */
export async function paginasHtml(libroId: string, adminToken: string, total = 5) {
  await pedir(`/admin/libros/${libroId}/manifiesto`, {
    method: 'PUT',
    token: adminToken,
    json: { formato: 'epub', tipo_pagina: 'html', total_paginas: total, indice: [{ etiqueta: 'Capítulo 1', pagina: 1, nivel: 0 }] },
  })
  for (let i = 1; i <= total; i++) {
    await pedir(`/admin/libros/${libroId}/paginas/${i}`, {
      method: 'PUT',
      token: adminToken,
      headers: { 'Content-Type': 'text/html' },
      body: `<p>Página ${i}</p><script>alert(1)</script><p onclick="x()">Fin</p>`,
    })
  }
}
