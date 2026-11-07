import type { APIRoute } from 'astro'
export const GET: APIRoute = ({ site }) => new Response(`User-agent: *\nAllow: /\nDisallow: /carrito\nDisallow: /pedido\nDisallow: /panel\nDisallow: /api/\nSitemap: ${new URL('/sitemap.xml', site).href}\n`)
