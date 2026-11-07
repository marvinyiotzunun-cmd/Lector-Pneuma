// Asistente inteligente: POST /api/asistente con los últimos mensajes. Sin API, responde con preguntas frecuentes locales.
import { api, ErrorApi, sinApi } from './api'

type Mensaje = { rol: 'usuario' | 'asistente'; texto: string }

const FAQ: [RegExp, string][] = [
  [/public|manuscrit|obra|autor|ventanilla/i, 'Para publicar, el ministerio presenta su obra en la ventanilla digital (botón «Presentar una obra») con el manuscrito y la Carta de Autorización. La obra pasa por ocho etapas, desde la revisión de admisión hasta la publicación, y tú sigues cada etapa con tu código de expediente. Mira el detalle en /proceso.'],
  [/env[ií]o|domicilio|entrega|courier/i, 'Sí, enviamos los libros impresos a domicilio en toda Guatemala. El costo del envío se suma al total del pedido y depende de la tarifa del courier.'],
  [/pag|tarjeta|paypal|transfer|dep[oó]sito|billetera/i, 'Puedes pagar con tarjeta (enlace de pago seguro), PayPal, transferencia o depósito bancario, o billetera electrónica. Con transferencia o billetera subes la foto de la boleta y el equipo confirma el pago.'],
  [/digital|lector|leer|pdf|epub|kindle/i, 'Algunos libros también se ofrecen en versión digital para leer en el lector de Pneuma (celular, tableta o computadora). En la ficha de cada libro verás si está disponible en digital.'],
  [/amazon|google|play/i, 'Algunas obras también están en Amazon y Google Play Libros. Cuando lo estén, la ficha del libro muestra los enlaces a esas tiendas.'],
  [/formato|dictamen|carta|cr[eé]dito|descarg/i, 'Los formatos oficiales (Solicitud, Carta de Autorización, Dictamen y Créditos) se descargan en la página /formatos.'],
  [/precio|cu[aá]nto|costo|cat[aá]logo|libro/i, 'Todos los libros, con su precio, están en el catálogo (/catalogo). Puedes buscarlos por título, autor o ministerio.'],
]

function respuestaLocal(t: string, wa: string) {
  for (const [re, r] of FAQ) if (re.test(t)) return r
  return `No tengo esa respuesta todavía. Escríbenos por WhatsApp y el equipo te atiende: ${wa}`
}

function enlazar(texto: string) {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return esc
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(\/[a-z][a-z0-9\-/]*)/g, '$1<a href="$2">$2</a>')
}

export function iniciarAsistente() {
  const panel = document.getElementById('asistente')
  if (!panel) return
  const abrir = document.querySelector<HTMLButtonElement>('[data-abrir-asistente]')!
  const lista = panel.querySelector<HTMLElement>('[data-mensajes]')!
  const form = panel.querySelector<HTMLFormElement>('[data-form-asistente]')!
  const input = form.querySelector('input')!
  const sugerencias = panel.querySelector<HTMLElement>('[data-sugerencias]')!
  const wa = panel.dataset.whatsapp ?? ''
  const historial: Mensaje[] = []
  let ocupado = false

  const mostrar = (v: boolean) => {
    panel.hidden = !v
    abrir.setAttribute('aria-expanded', String(v))
    if (v) input.focus()
  }
  abrir.addEventListener('click', (e) => { e.stopPropagation(); mostrar(panel.hidden) })
  panel.querySelector('[data-cerrar-asistente]')!.addEventListener('click', () => mostrar(false))
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target as Node) && !abrir.contains(e.target as Node)) mostrar(false) })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { mostrar(false); abrir.focus() } })

  const burbuja = (rol: Mensaje['rol'], html: string) => {
    const b = document.createElement('div')
    b.className = `burbuja ${rol === 'usuario' ? 'usu' : 'asis'}`
    b.innerHTML = html
    lista.append(b)
    lista.scrollTop = lista.scrollHeight
    return b
  }

  async function preguntar(texto: string) {
    if (ocupado || !texto.trim()) return
    ocupado = true
    sugerencias.hidden = true
    burbuja('usuario', enlazar(texto))
    historial.push({ rol: 'usuario', texto })
    const espera = burbuja('asistente', '<span class="escribiendo" aria-label="Escribiendo"><i></i><i></i><i></i></span>')
    let respuesta: string
    try {
      respuesta = (await api<{ respuesta: string }>('/asistente', { method: 'POST', body: JSON.stringify({ mensajes: historial.slice(-12) }) })).respuesta
    } catch (e) {
      if (sinApi(e)) respuesta = respuestaLocal(texto, wa)
      else if (e instanceof ErrorApi && (e.codigo === 'asistente_agotado' || e.estado === 429)) respuesta = `El asistente no está disponible en este momento. Escríbenos por WhatsApp y te atendemos: ${wa}`
      else respuesta = `No pude responder ahora. Puedes escribirnos por WhatsApp: ${wa}`
    }
    historial.push({ rol: 'asistente', texto: respuesta })
    espera.innerHTML = enlazar(respuesta)
    lista.scrollTop = lista.scrollHeight
    ocupado = false
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value; input.value = ''; preguntar(t) })
  sugerencias.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => preguntar(b.textContent ?? '')))
}
