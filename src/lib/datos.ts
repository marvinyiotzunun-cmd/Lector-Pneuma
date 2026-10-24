import { supabase } from './supabase'
import { leerLocal, guardarLocal } from './local'
import type { Libro, Marcador, Progreso, Subrayado } from './tipos'

const DEMO: Libro[] = [
  {
    id: 'demo-salmos', titulo: 'Salmos escogidos', autor: 'Reina-Valera 1909', formato: 'epub',
    descripcion: 'Libro de muestra en EPUB (dominio público).', archivo_ruta: 'salmos-escogidos.epub',
    portada_ruta: null, color: '#2C5878',
  },
  {
    id: 'demo-juan', titulo: 'El Verbo hecho carne', autor: 'Juan 1 · Reina-Valera 1909', formato: 'pdf',
    descripcion: 'Libro de muestra en PDF (dominio público).', archivo_ruta: 'el-verbo-hecho-carne.pdf',
    portada_ruta: null, color: '#7A4E2D',
  },
]

async function usuarioId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

function nuevoId() {
  return crypto.randomUUID()
}

/* ---------- Catálogo y archivos ---------- */

export async function listarBiblioteca(): Promise<Libro[]> {
  if (!supabase) return DEMO
  const { data, error } = await supabase
    .from('biblioteca')
    .select('agregado_en, libro:libros(id, titulo, autor, descripcion, formato, archivo_ruta, portada_ruta, color)')
    .order('agregado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map((f) => f.libro as unknown as Libro)
}

export async function obtenerLibro(id: string): Promise<Libro | null> {
  if (!supabase) return DEMO.find((l) => l.id === id) ?? null
  const { data, error } = await supabase
    .from('libros')
    .select('id, titulo, autor, descripcion, formato, archivo_ruta, portada_ruta, color')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as Libro | null
}

export function urlPortada(libro: Libro): string | null {
  if (!libro.portada_ruta || !supabase) return null
  return supabase.storage.from('portadas').getPublicUrl(libro.portada_ruta).data.publicUrl
}

// Descarga el archivo del libro. En Supabase el bucket es privado: solo quien tiene el libro en su biblioteca obtiene un enlace firmado de corta duración.
export async function descargarLibro(libro: Libro): Promise<ArrayBuffer> {
  let url = `${import.meta.env.BASE_URL}demo/${libro.archivo_ruta}`
  if (supabase) {
    const { data, error } = await supabase.storage.from('libros').createSignedUrl(libro.archivo_ruta, 120)
    if (error || !data) throw error ?? new Error('No se pudo obtener el libro')
    url = data.signedUrl
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error(`No se pudo descargar el libro (${r.status})`)
  return r.arrayBuffer()
}

/* ---------- Progreso ---------- */

export async function leerProgreso(libroId: string): Promise<Progreso | null> {
  const uid = await usuarioId()
  if (!supabase || !uid) return leerLocal<Progreso | null>(`progreso:${libroId}`, null)
  const { data } = await supabase
    .from('progreso_lectura')
    .select('ubicacion, porcentaje')
    .eq('libro_id', libroId)
    .maybeSingle()
  return data as Progreso | null
}

export async function guardarProgreso(libroId: string, p: Progreso) {
  guardarLocal(`progreso:${libroId}`, p)
  const uid = await usuarioId()
  if (!supabase || !uid) return
  await supabase.from('progreso_lectura').upsert({
    usuario_id: uid, libro_id: libroId, ubicacion: p.ubicacion, porcentaje: p.porcentaje,
    actualizado_en: new Date().toISOString(),
  })
}

export function progresoLocal(libroId: string): number {
  return leerLocal<Progreso | null>(`progreso:${libroId}`, null)?.porcentaje ?? 0
}

/* ---------- Marcadores ---------- */

export async function listarMarcadores(libroId: string): Promise<Marcador[]> {
  const uid = await usuarioId()
  if (!supabase || !uid) return leerLocal<Marcador[]>(`marcadores:${libroId}`, [])
  const { data } = await supabase
    .from('marcadores')
    .select('id, ubicacion, etiqueta, creado_en')
    .eq('libro_id', libroId)
    .order('creado_en')
  return (data ?? []) as Marcador[]
}

export async function agregarMarcador(libroId: string, ubicacion: string, etiqueta: string): Promise<Marcador> {
  const m: Marcador = { id: nuevoId(), ubicacion, etiqueta, creado_en: new Date().toISOString() }
  const uid = await usuarioId()
  if (!supabase || !uid) {
    guardarLocal(`marcadores:${libroId}`, [...leerLocal<Marcador[]>(`marcadores:${libroId}`, []), m])
    return m
  }
  const { error } = await supabase.from('marcadores').insert({ ...m, usuario_id: uid, libro_id: libroId })
  if (error) throw error
  return m
}

export async function quitarMarcador(libroId: string, id: string) {
  const uid = await usuarioId()
  if (!supabase || !uid) {
    guardarLocal(`marcadores:${libroId}`, leerLocal<Marcador[]>(`marcadores:${libroId}`, []).filter((m) => m.id !== id))
    return
  }
  await supabase.from('marcadores').delete().eq('id', id)
}

/* ---------- Subrayados y notas ---------- */

export async function listarSubrayados(libroId: string): Promise<Subrayado[]> {
  const uid = await usuarioId()
  if (!supabase || !uid) return leerLocal<Subrayado[]>(`subrayados:${libroId}`, [])
  const { data } = await supabase
    .from('subrayados')
    .select('id, ubicacion, texto, nota, creado_en')
    .eq('libro_id', libroId)
    .order('creado_en')
  return (data ?? []) as Subrayado[]
}

export async function agregarSubrayado(libroId: string, ubicacion: string, texto: string): Promise<Subrayado> {
  const s: Subrayado = { id: nuevoId(), ubicacion, texto, nota: '', creado_en: new Date().toISOString() }
  const uid = await usuarioId()
  if (!supabase || !uid) {
    guardarLocal(`subrayados:${libroId}`, [...leerLocal<Subrayado[]>(`subrayados:${libroId}`, []), s])
    return s
  }
  const { error } = await supabase.from('subrayados').insert({ ...s, usuario_id: uid, libro_id: libroId })
  if (error) throw error
  return s
}

export async function guardarNota(libroId: string, id: string, nota: string) {
  const uid = await usuarioId()
  if (!supabase || !uid) {
    guardarLocal(`subrayados:${libroId}`,
      leerLocal<Subrayado[]>(`subrayados:${libroId}`, []).map((s) => (s.id === id ? { ...s, nota } : s)))
    return
  }
  await supabase.from('subrayados').update({ nota, actualizado_en: new Date().toISOString() }).eq('id', id)
}

export async function quitarSubrayado(libroId: string, id: string) {
  const uid = await usuarioId()
  if (!supabase || !uid) {
    guardarLocal(`subrayados:${libroId}`, leerLocal<Subrayado[]>(`subrayados:${libroId}`, []).filter((s) => s.id !== id))
    return
  }
  await supabase.from('subrayados').delete().eq('id', id)
}
