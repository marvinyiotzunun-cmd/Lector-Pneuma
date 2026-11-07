// Lectura y escritura segura en localStorage (puede fallar en modo privado).
export function leerLocal<T>(clave: string, porDefecto: T): T {
  try {
    const crudo = localStorage.getItem(clave)
    return crudo ? (JSON.parse(crudo) as T) : porDefecto
  } catch {
    return porDefecto
  }
}

export function guardarLocal(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    /* sin almacenamiento disponible */
  }
}
