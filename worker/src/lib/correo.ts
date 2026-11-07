import type { Env } from '../env'
import { escaparHtml, nuevoId } from './util'

export interface Correo {
  para: string
  asunto: string
  html: string
  texto?: string
  plantilla?: string
}

function separarRemitente(r: string): { email: string; name: string } | string {
  const m = r.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return m && m[1] ? { name: m[1], email: m[2] } : (m?.[2] ?? r.trim())
}

function htmlATexto(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2: $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Envía un correo transaccional y lo registra en correos_enviados.
 * Proveedor según CORREO_PROVEEDOR: "cloudflare" (binding EMAIL), "resend" (RESEND_API_KEY) o "consola" (solo registra).
 * Nunca lanza: devuelve false si falló, para no romper el flujo que lo llama.
 */
export async function enviarCorreo(env: Env, c: Correo): Promise<boolean> {
  const texto = c.texto ?? htmlATexto(c.html)
  const remitente = separarRemitente(env.CORREO_REMITENTE || 'Publicaciones Pneuma <no-responder@pneuma.gt>')
  let estado: 'enviado' | 'fallido' | 'simulado' = 'simulado'
  let error: string | null = null
  try {
    const proveedor = env.CORREO_PROVEEDOR || 'consola'
    if (proveedor === 'cloudflare' && env.EMAIL) {
      await env.EMAIL.send({ from: remitente, to: c.para, subject: c.asunto, html: c.html, text: texto })
      estado = 'enviado'
    } else if (proveedor === 'resend' && env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.CORREO_REMITENTE,
          to: [c.para],
          subject: c.asunto,
          html: c.html,
          text: texto,
        }),
      })
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`)
      estado = 'enviado'
    } else {
      console.log(`[correo simulado] para=${c.para} asunto=${c.asunto}\n${texto}`)
    }
  } catch (e) {
    estado = 'fallido'
    error = String((e as Error)?.message ?? e).slice(0, 500)
    console.error('Fallo al enviar correo', error)
  }
  await env.DB.prepare(
    'INSERT INTO correos_enviados (id, para, asunto, plantilla, estado, error) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(nuevoId('cor'), c.para, c.asunto, c.plantilla ?? null, estado, error)
    .run()
  return estado !== 'fallido'
}

/** Marco común de los correos con la marca de Pneuma (navy #04044A, rojo #CD0100). */
export function marcoCorreo(titulo: string, cuerpoHtml: string, boton?: { texto: string; url: string }): string {
  const btn = boton
    ? `<p style="margin:28px 0"><a href="${escaparHtml(boton.url)}" style="background:#CD0100;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">${escaparHtml(boton.texto)}</a></p>`
    : ''
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f2ee;font-family:Inter,Arial,sans-serif;color:#1a1a2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#04044A;color:#fff;padding:18px 24px;font-size:18px;font-weight:700;letter-spacing:.3px">Publicaciones Pneuma</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 14px;color:#04044A">${escaparHtml(titulo)}</h1>
${cuerpoHtml}${btn}
</td></tr>
<tr><td style="padding:14px 24px;background:#faf9f6;color:#666;font-size:12px">Publicaciones Pneuma · Iglesia de Dios Evangelio Completo de Guatemala</td></tr>
</table></td></tr></table></body></html>`
}
