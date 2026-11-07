import { aBase64 } from './cripto'
import { escaparHtml } from './util'

/** Huella invisible: el código en caracteres de ancho cero, para rastrear texto copiado. */
export function huellaInvisible(codigo: string): string {
  const bits = [...new TextEncoder().encode(codigo)].map((b) => b.toString(2).padStart(8, '0')).join('')
  return '⁣' + [...bits].map((b) => (b === '0' ? '​' : '‌')).join('') + '⁣'
}

export function leerHuellaInvisible(texto: string): string | null {
  const m = texto.match(/⁣([​‌]+)⁣/)
  if (!m) return null
  const bits = [...m[1]].map((ch) => (ch === '​' ? '0' : '1')).join('')
  const bytes = bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * Página de imagen envuelta en SVG con la marca de agua dibujada encima (correo y huella en diagonal).
 * El navegador la muestra como una imagen más; la marca queda en cualquier captura.
 */
export function paginaSvg(imagen: Uint8Array, tipo: string, ancho: number, alto: number, correo: string, codigo: string): string {
  const linea = escaparHtml(`${correo} · ${codigo}`)
  const tam = Math.max(14, Math.round(ancho / 38))
  const filas: string[] = []
  const paso = tam * 9
  for (let y = -alto; y < alto * 2; y += paso) {
    filas.push(`<text x="${-ancho / 2}" y="${y}">${linea}  ·  ${linea}  ·  ${linea}</text>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">
<image href="data:${tipo};base64,${aBase64(imagen)}" x="0" y="0" width="${ancho}" height="${alto}" preserveAspectRatio="xMidYMid meet"/>
<g transform="rotate(-30 ${ancho / 2} ${alto / 2})" fill="#04044A" fill-opacity="0.07" font-family="Arial, sans-serif" font-size="${tam}">${filas.join('')}</g>
<text x="${ancho - 12}" y="${alto - 10}" text-anchor="end" fill="#04044A" fill-opacity="0.35" font-family="Arial, sans-serif" font-size="${Math.round(tam * 0.7)}">${linea}</text>
</svg>`
}

/** Quita scripts, manejadores on* y URLs javascript: (el panel ya sanea; esto es una segunda barrera). */
export function sanearHtml(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
}

/** Página HTML con marca de agua visible y huella invisible insertada en cada párrafo. */
export function paginaHtml(html: string, correo: string, codigo: string): string {
  const invisible = huellaInvisible(codigo)
  const cuerpo = sanearHtml(html).replace(/<\/p>/gi, `${invisible}</p>`)
  const linea = escaparHtml(`${correo} · ${codigo}`)
  return `<div class="pneuma-pagina" data-huella="${codigo}">${cuerpo}${invisible}<div class="pneuma-marca" aria-hidden="true">${linea}</div></div>`
}
