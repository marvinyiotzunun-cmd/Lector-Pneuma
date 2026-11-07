// Carrito guardado en este navegador. Cada línea es un libro en una modalidad (impreso, compra digital o alquiler).
export type Modalidad = 'impreso' | 'compra' | 'alquiler'
export type Linea = { libro_id: string; slug: string; titulo: string; autor: string; portada_url: string | null; modalidad: Modalidad; precio: number; cantidad: number }

const CLAVE = 'pneuma_carrito'
const avisar = () => window.dispatchEvent(new Event('carrito'))

export function leerCarrito(): Linea[] {
  try { const v = JSON.parse(localStorage.getItem(CLAVE) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function guardar(l: Linea[]) {
  try { localStorage.setItem(CLAVE, JSON.stringify(l)) } catch { /* almacenamiento bloqueado: el carrito vive solo en esta página */ }
  avisar()
}
export function agregar(linea: Linea) {
  const l = leerCarrito()
  const i = l.findIndex((x) => x.libro_id === linea.libro_id && x.modalidad === linea.modalidad)
  if (i >= 0) l[i].cantidad = linea.modalidad === 'impreso' ? Math.min(99, l[i].cantidad + linea.cantidad) : 1
  else l.push({ ...linea, cantidad: linea.modalidad === 'impreso' ? linea.cantidad : 1 })
  guardar(l)
}
export function cambiarCantidad(libro_id: string, modalidad: Modalidad, cantidad: number) {
  const l = leerCarrito().map((x) => (x.libro_id === libro_id && x.modalidad === modalidad ? { ...x, cantidad: Math.max(1, Math.min(99, cantidad)) } : x))
  guardar(l)
}
export function quitar(libro_id: string, modalidad: Modalidad) { guardar(leerCarrito().filter((x) => !(x.libro_id === libro_id && x.modalidad === modalidad))) }
export function vaciar() { guardar([]) }
export const contarCarrito = () => leerCarrito().reduce((s, x) => s + x.cantidad, 0)
export const subtotal = (l = leerCarrito()) => l.reduce((s, x) => s + x.precio * x.cantidad, 0)
export const tieneImpresos = (l = leerCarrito()) => l.some((x) => x.modalidad === 'impreso')
export const quetzales = (n: number) => 'Q' + n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const nombreModalidad = (m: Modalidad) => ({ impreso: 'Libro impreso', compra: 'Digital (compra)', alquiler: 'Digital (alquiler)' })[m]

// Pedidos hechos desde este navegador, para poder consultarlos sin cuenta.
const PEDIDOS = 'pneuma_pedidos'
export type PedidoGuardado = { id: string; codigo: string; correo: string; instrucciones?: string | null }
export function guardarPedido(p: PedidoGuardado) {
  try { const m = JSON.parse(localStorage.getItem(PEDIDOS) ?? '{}'); m[p.codigo] = p; localStorage.setItem(PEDIDOS, JSON.stringify(m)) } catch { /* sin almacenamiento */ }
}
export function pedidoGuardado(codigo: string): PedidoGuardado | null {
  try { return JSON.parse(localStorage.getItem(PEDIDOS) ?? '{}')[codigo] ?? null } catch { return null }
}
