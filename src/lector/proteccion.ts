import { useEffect } from 'react'

export const MAX_CITA = 300

// Capas de protección del lado del lector. Son disuasorias: el rastreo real es la marca de agua y la huella de cada página.
export function useProteccion(raiz: React.RefObject<HTMLElement | null>, titulo: string, avisar: (t: string) => void) {
  useEffect(() => {
    const el = raiz.current
    if (!el) return

    const copiar = (e: ClipboardEvent) => {
      const texto = window.getSelection()?.toString().trim() ?? ''
      e.preventDefault()
      if (!texto) return
      if (texto.length > MAX_CITA) {
        avisar(`Solo se pueden copiar citas de hasta ${MAX_CITA} caracteres`)
        return
      }
      e.clipboardData?.setData('text/plain', `“${texto}”\n(${titulo}, Publicaciones Pneuma)`)
      avisar('Cita copiada')
    }
    const bloquear = (e: Event) => e.preventDefault()
    const teclas = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'a', 'u'].includes(k)) {
        e.preventDefault()
        if (k === 'p' || k === 's') avisar('Este libro no se puede imprimir ni guardar')
      }
      if (k === 'printscreen') avisar('Cada página lleva tu correo como marca de agua')
    }

    el.addEventListener('copy', copiar)
    el.addEventListener('cut', copiar)
    el.addEventListener('contextmenu', bloquear)
    el.addEventListener('dragstart', bloquear)
    window.addEventListener('keydown', teclas, true)
    return () => {
      el.removeEventListener('copy', copiar)
      el.removeEventListener('cut', copiar)
      el.removeEventListener('contextmenu', bloquear)
      el.removeEventListener('dragstart', bloquear)
      window.removeEventListener('keydown', teclas, true)
    }
  }, [raiz, titulo, avisar])
}

// Fondo en mosaico con el correo del lector, encima de la página.
export function fondoMarcaAgua(texto: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="200"><text x="20" y="120" transform="rotate(-24 170 100)" fill="${color}" font-family="sans-serif" font-size="14">${texto.replace(/[<&>"]/g, '')}</text></svg>`
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`
}
