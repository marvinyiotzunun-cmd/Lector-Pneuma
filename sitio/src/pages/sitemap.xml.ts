import type { APIRoute } from 'astro'
import { libros } from '../lib/datos'

export const GET: APIRoute = async ({ site }) => {
  const fijas = ['/', '/quienes-somos', '/proceso', '/catalogo', '/formatos', '/contacto']
  const urls = [...fijas, ...(await libros()).map((l) => `/libros/${l.slug}`)].map((p) => new URL(p, site).href)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } })
}
