// PROVISIONAL: el backend lo reemplaza. Aquí solo registra el correo en consola y en correos_enviados.
import type { Env } from '../env'

export async function enviarCorreo(env: Env, m: { para: string; asunto: string; html: string; texto?: string }) {
  console.log(`[correo simulado] para=${m.para} asunto=${m.asunto}`)
  await env.DB.prepare(`INSERT INTO correos_enviados (id, para, asunto, plantilla, estado) VALUES (?, ?, ?, 'ventanilla', 'simulado')`)
    .bind(crypto.randomUUID(), m.para, m.asunto).run()
}
