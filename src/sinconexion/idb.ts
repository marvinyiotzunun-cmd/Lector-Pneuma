// IndexedDB mínimo para la lectura sin conexión. Las páginas se guardan tal como llegan: cifradas.
const NOMBRE = 'pneuma-sin-conexion'

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const r = indexedDB.open(NOMBRE, 1)
    r.onupgradeneeded = () => {
      const db = r.result
      db.createObjectStore('claves')
      db.createObjectStore('licencias', { keyPath: 'obra_id' })
      db.createObjectStore('paginas')
      db.createObjectStore('ajustes')
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => mal(r.error)
  })
}

let db: Promise<IDBDatabase> | null = null

export async function tx<T>(almacen: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  db ??= abrir()
  const d = await db
  return new Promise((ok, mal) => {
    const t = d.transaction(almacen, modo)
    const pedido = fn(t.objectStore(almacen))
    t.oncomplete = () => ok(pedido ? pedido.result : (undefined as T))
    t.onerror = () => mal(t.error)
    t.onabort = () => mal(t.error)
  })
}

export const leer = <T>(almacen: string, clave: IDBValidKey) => tx<T | undefined>(almacen, 'readonly', (s) => s.get(clave))
export const escribir = (almacen: string, valor: unknown, clave?: IDBValidKey) => tx(almacen, 'readwrite', (s) => { s.put(valor, clave) })
export const borrar = (almacen: string, clave: IDBValidKey | IDBKeyRange) => tx(almacen, 'readwrite', (s) => { s.delete(clave) })
export const todos = <T>(almacen: string) => tx<T[]>(almacen, 'readonly', (s) => s.getAll())
