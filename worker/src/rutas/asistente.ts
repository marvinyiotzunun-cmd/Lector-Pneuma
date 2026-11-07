import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'
import type { App, Env } from '../env'
import { ajuste, ajusteNum } from '../lib/ajustes'
import { libroPublico, type FilaLibro } from '../lib/libros'
import { falla, ip, leerJson } from '../lib/util'

// Precio por millón de tokens en US$ (entrada, salida). Se usa para el tope mensual.
const PRECIOS: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
}
const MENSAJES_POR_HORA_IP = 20

const mesActual = () => new Date().toISOString().slice(0, 7)

async function contexto(env: Env): Promise<string> {
  const [{ results: faq }, { results: libros }, whatsapp, recogida] = await Promise.all([
    env.DB.prepare('SELECT tema, pregunta, respuesta FROM asistente_faq WHERE activo = 1 ORDER BY tema, orden').all<{
      tema: string
      pregunta: string
      respuesta: string
    }>(),
    env.DB.prepare('SELECT * FROM libros WHERE publicado = 1 ORDER BY orden, titulo LIMIT 300').all<FilaLibro>(),
    ajuste(env, 'whatsapp', ''),
    ajuste(env, 'direccion_recogida', ''),
  ])
  const catalogo = libros
    .map((l) => {
      const p = libroPublico(env, l)
      const precios = [
        p.impreso ? `impreso Q${p.impreso.precio_gtq}${p.impreso.disponible ? '' : ' (agotado)'}` : null,
        p.digital?.precio_compra_gtq != null ? `digital Q${p.digital.precio_compra_gtq}` : null,
        p.digital?.precio_alquiler_gtq != null ? `alquiler Q${p.digital.precio_alquiler_gtq} por ${p.digital.dias_alquiler} días` : null,
      ]
        .filter(Boolean)
        .join('; ')
      return `- «${p.titulo}», ${p.autor}${p.ministerio ? ` (${p.ministerio})` : ''}. ${precios}. Ficha: ${p.ficha_url}${p.sinopsis ? `. ${p.sinopsis.slice(0, 240)}` : ''}`
    })
    .join('\n')
  const preguntas = faq.map((f) => `[${f.tema}] P: ${f.pregunta}\nR: ${f.respuesta}`).join('\n\n')
  return `## Preguntas frecuentes
${preguntas || '(Todavía no hay preguntas frecuentes cargadas.)'}

## Catálogo publicado
${catalogo || '(El catálogo todavía está vacío.)'}

## Contacto
WhatsApp: ${whatsapp || 'no configurado'}. Oficina: ${recogida || 'no configurada'}.`
}

const INSTRUCCIONES = `Eres el asistente del sitio de Publicaciones Pneuma, el sello editorial de la Iglesia de Dios Evangelio Completo de Guatemala.
Respondes en español de Guatemala, con calidez y en pocas oraciones, a lectores, ministerios y autores.
Temas: el proceso para publicar una obra con Pneuma, el catálogo y sus precios en quetzales, cómo comprar, alquilar o suscribirse, el lector digital, pagos, envíos y canje de códigos.
Usa solo la información de las preguntas frecuentes y del catálogo que siguen. Si algo no está ahí, dilo con sencillez y ofrece el contacto por WhatsApp; no inventes precios, fechas, políticas ni datos bancarios.
Cuando recomiendes un libro, incluye el enlace a su ficha. No hables de temas ajenos a Pneuma; si te piden otra cosa, redirige con amabilidad.`

export const asistente = new Hono<App>()

asistente.post('/asistente', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) throw falla(503, 'asistente_agotado', 'El asistente no está disponible. Escríbenos por WhatsApp.')
  const b = await leerJson<{ mensajes?: unknown }>(c.req.raw)
  if (!Array.isArray(b.mensajes) || !b.mensajes.length) throw falla(400, 'mensajes_invalidos', 'Envía al menos un mensaje.')
  const mensajes = b.mensajes.slice(-12).map((m) => {
    const o = m as { rol?: string; texto?: string }
    if ((o.rol !== 'usuario' && o.rol !== 'asistente') || typeof o.texto !== 'string' || !o.texto.trim()) {
      throw falla(400, 'mensajes_invalidos', 'Mensaje con formato inválido.')
    }
    return { role: o.rol === 'usuario' ? ('user' as const) : ('assistant' as const), content: o.texto.slice(0, 2000) }
  })
  if (mensajes[0].role !== 'user') mensajes.shift()
  if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') throw falla(400, 'mensajes_invalidos', 'El último mensaje debe ser del usuario.')

  // Límite aproximado por IP y hora, en la caché del centro de datos (sin costo de escritura en D1).
  const quien = ip(c.req.raw) ?? 'sin-ip'
  const cache = caches.default
  const claveIp = new Request(`https://limite.pneuma/asistente/${encodeURIComponent(quien)}/${new Date().toISOString().slice(0, 13)}`)
  const previo = Number((await (await cache.match(claveIp))?.text()) ?? 0)
  if (previo >= MENSAJES_POR_HORA_IP) throw falla(429, 'demasiados_mensajes', 'Has hecho muchas preguntas seguidas. Intenta en un rato o escríbenos por WhatsApp.')
  c.executionCtx.waitUntil(cache.put(claveIp, new Response(String(previo + 1), { headers: { 'Cache-Control': 'max-age=3600' } })))

  // Tope de gasto mensual.
  const mes = mesActual()
  const tope = (await ajusteNum(c.env, 'asistente_tope_centavos_usd', 1000)) * 10_000 // centavos de US$ a microdólares
  const uso = await c.env.DB.prepare('SELECT costo_microdolares FROM asistente_uso WHERE mes = ?').bind(mes).first<{ costo_microdolares: number }>()
  if ((uso?.costo_microdolares ?? 0) >= tope) {
    throw falla(503, 'asistente_agotado', 'El asistente llegó a su límite de este mes. Escríbenos por WhatsApp y con gusto te ayudamos.')
  }

  const modelo = c.env.ASISTENTE_MODELO || 'claude-opus-5-5'
  const cliente = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY, maxRetries: 1 })
  let respuesta: Anthropic.Message
  try {
    respuesta = await cliente.messages.create({
      model: modelo,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: INSTRUCCIONES },
        { type: 'text', text: await contexto(c.env), cache_control: { type: 'ephemeral' } },
      ],
      messages: mensajes,
    })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw falla(503, 'asistente_ocupado', 'El asistente está ocupado. Intenta en un momento.')
    if (e instanceof Anthropic.APIError) {
      console.error('Anthropic', e.status, e.message)
      throw falla(503, 'asistente_no_disponible', 'El asistente no está disponible ahora. Escríbenos por WhatsApp.')
    }
    throw e
  }

  const usage = respuesta.usage
  const [pe, ps] = PRECIOS[modelo] ?? PRECIOS['claude-opus-5-5']
  const entrada = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1
  const costo = Math.ceil(entrada * pe + usage.output_tokens * ps) // microdólares (tokens × US$/M)
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO asistente_uso (mes, consultas, tokens_entrada, tokens_salida, costo_microdolares) VALUES (?1, 1, ?2, ?3, ?4)
       ON CONFLICT (mes) DO UPDATE SET consultas = consultas + 1, tokens_entrada = tokens_entrada + ?2,
         tokens_salida = tokens_salida + ?3, costo_microdolares = costo_microdolares + ?4`,
    )
      .bind(mes, Math.round(entrada), usage.output_tokens, costo)
      .run(),
  )

  if (respuesta.stop_reason === 'refusal') {
    return c.json({ respuesta: 'No puedo ayudarte con eso. Si tienes una pregunta sobre Pneuma, sus libros o el proceso de publicación, con gusto te ayudo.' })
  }
  const textoRespuesta = respuesta.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
  return c.json({ respuesta: textoRespuesta || 'No tengo una respuesta para eso. Escríbenos por WhatsApp.' })
})
