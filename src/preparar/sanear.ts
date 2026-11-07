// Limpia el HTML de un EPUB: solo quedan etiquetas de texto y las imágenes ya convertidas a data:.
const PERMITIDAS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'em', 'i', 'strong', 'b', 'u',
  'sup', 'sub', 'small', 'br', 'hr', 'span', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'pre', 'code', 'cite', 'q', 'dl', 'dt', 'dd', 'abbr',
])
const QUITAR_CON_CONTENIDO = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math', 'audio', 'video', 'nav', 'head', 'title', 'link', 'meta'])

export function sanearNodo(nodo: Node, doc: Document): Node | null {
  if (nodo.nodeType === Node.TEXT_NODE) return doc.createTextNode(nodo.textContent ?? '')
  if (nodo.nodeType !== Node.ELEMENT_NODE) return null
  const el = nodo as Element
  const nombre = el.localName.toLowerCase()
  if (QUITAR_CON_CONTENIDO.has(nombre)) return null

  const hijos = Array.from(el.childNodes).map((h) => sanearNodo(h, doc)).filter((h): h is Node => !!h)
  if (!PERMITIDAS.has(nombre)) {
    // Contenedores como div, section o a: se conservan sus hijos sin la etiqueta.
    const frag = doc.createDocumentFragment()
    hijos.forEach((h) => frag.appendChild(h))
    return frag
  }
  const limpio = doc.createElement(nombre)
  if (nombre === 'img') {
    const src = el.getAttribute('src') ?? ''
    if (!src.startsWith('data:image/')) return null
    limpio.setAttribute('src', src)
    limpio.setAttribute('alt', el.getAttribute('alt') ?? '')
  }
  if ((nombre === 'td' || nombre === 'th') && el.getAttribute('colspan')) limpio.setAttribute('colspan', el.getAttribute('colspan')!)
  hijos.forEach((h) => limpio.appendChild(h))
  return limpio
}
