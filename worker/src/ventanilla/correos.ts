// Plantillas de correo de la ventanilla, con la identidad de Publicaciones Pneuma (navy #04044A, rojo #CD0100).
import type { EstadoExpediente } from './servicio'

const NAVY = '#04044A'
const ROJO = '#CD0100'

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

const NOMBRE_ESTADO: Record<EstadoExpediente, string> = {
  en_curso: 'En curso',
  requiere_cambios: 'Requiere cambios del ministerio',
  en_pausa: 'En pausa',
  rechazado: 'No aprobada',
  publicado: 'Publicada',
}

function marco(titulo: string, cuerpo: string, boton?: { texto: string; url: string }) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F6F2EA;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1C1B1F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F2EA;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #D9D2C3;border-radius:8px;overflow:hidden">
<tr><td style="background:${NAVY};padding:18px 24px;color:#FFFFFF">
  <div style="font:italic 500 22px/1 Georgia,serif">Pneuma</div>
  <div style="font:600 10px/1.6 Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#E6534F">Publicaciones · Ventanilla editorial</div>
</td></tr>
<tr><td style="padding:24px">
  <h1 style="margin:0 0 12px;font:500 21px/1.3 Georgia,serif;color:${NAVY}">${esc(titulo)}</h1>
  ${cuerpo}
  ${boton ? `<p style="margin:24px 0 4px"><a href="${esc(boton.url)}" style="display:inline-block;background:${ROJO};color:#FFFFFF;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:4px">${esc(boton.texto)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #D9D2C3;font-size:12px;color:#716D64">
  Publicaciones Pneuma · Iglesia de Dios Evangelio Completo de Guatemala<br>
  Este es un aviso automático de la ventanilla digital de publicación.
</td></tr></table></td></tr></table></body></html>`
}

/** Barra con las etapas; la actual resaltada. */
function linea(etapa: number, total: number) {
  const celdas = Array.from({ length: total }, (_, i) => {
    const n = i + 1
    const color = n < etapa ? NAVY : n === etapa ? ROJO : '#D9D2C3'
    return `<td style="height:6px;background:${color};border-radius:3px"></td><td style="width:4px"></td>`
  }).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 6px"><tr>${celdas}</tr></table>
  <div style="font-size:12px;color:#716D64">Etapa ${etapa} de ${total}</div>`
}

interface DatosExp { codigo: string; titulo: string; ministerio: string; autores: string }

export function correoAvisoEtapa(d: {
  expediente: DatosExp; total: number; etapa: number; etapaNombre: string; estado: EstadoExpediente; nota: string | null; url: string
}) {
  const e = d.expediente
  const esNueva = d.etapa === 1 && d.estado === 'en_curso'
  const titulo = esNueva
    ? 'Recibimos su solicitud'
    : d.estado === 'en_curso' ? `Su obra pasó a: ${d.etapaNombre}` : `Su expediente está: ${NOMBRE_ESTADO[d.estado]}`
  const asunto = `${e.codigo} · ${esNueva ? 'Solicitud recibida' : d.estado === 'en_curso' ? d.etapaNombre : NOMBRE_ESTADO[d.estado]} · «${e.titulo}»`
  const cuerpo = `
  <p style="margin:0 0 4px;font-size:15px"><strong>«${esc(e.titulo)}»</strong></p>
  <p style="margin:0;color:#716D64;font-size:14px">${esc(e.autores)} · ${esc(e.ministerio)}</p>
  <p style="margin:12px 0 0;font-size:14px">Expediente <strong style="font-family:Consolas,monospace">${esc(e.codigo)}</strong></p>
  ${linea(d.etapa, d.total)}
  <p style="margin:12px 0 0;font-size:14px">Etapa actual: <strong>${esc(d.etapaNombre)}</strong>${d.estado !== 'en_curso' ? ` · Estado: <strong>${esc(NOMBRE_ESTADO[d.estado])}</strong>` : ''}</p>
  ${d.nota ? `<div style="margin:16px 0 0;padding:12px 14px;background:#F6F2EA;border-left:3px solid ${ROJO};font-size:14px;white-space:pre-wrap">${esc(d.nota)}</div>` : ''}`
  const texto = [
    titulo, `«${e.titulo}» · ${e.autores} · ${e.ministerio}`, `Expediente ${e.codigo}`,
    `Etapa ${d.etapa} de ${d.total}: ${d.etapaNombre}`, d.estado !== 'en_curso' ? `Estado: ${NOMBRE_ESTADO[d.estado]}` : '',
    d.nota ?? '', `Ver el expediente: ${d.url}`,
  ].filter(Boolean).join('\n\n')
  return { asunto, html: marco(titulo, cuerpo, { texto: 'Ver mi expediente', url: d.url }), texto }
}

export function correoNuevaSolicitud(d: { expediente: DatosExp & { sinopsis: string; modalidad: string }; url: string }) {
  const e = d.expediente
  const asunto = `Nueva solicitud ${e.codigo} · «${e.titulo}» · ${e.ministerio}`
  const cuerpo = `
  <p style="margin:0 0 4px;font-size:15px"><strong>«${esc(e.titulo)}»</strong></p>
  <p style="margin:0;color:#716D64;font-size:14px">${esc(e.autores)} · ${esc(e.ministerio)} · ${esc(e.modalidad)}</p>
  <p style="margin:14px 0 0;font-size:14px;white-space:pre-wrap">${esc(e.sinopsis.slice(0, 600))}</p>`
  const texto = `${asunto}\n\n${e.autores} · ${e.ministerio}\n\n${e.sinopsis.slice(0, 600)}\n\nAbrir en el panel: ${d.url}`
  return { asunto, html: marco('Llegó una solicitud nueva', cuerpo, { texto: 'Abrir en el panel', url: d.url }), texto }
}

export function correoInvitacionMinisterio(d: { ministerio: string; nombre: string | null; url: string }) {
  const asunto = `Su cuenta en la ventanilla de Publicaciones Pneuma · ${d.ministerio}`
  const cuerpo = `<p style="margin:0;font-size:14px">${d.nombre ? `Hola, ${esc(d.nombre)}. ` : ''}La Dirección Editorial le abrió una cuenta para el ministerio <strong>${esc(d.ministerio)}</strong>. Desde la ventanilla puede presentar obras para publicación, adjuntar el manuscrito y los documentos, y seguir cada expediente en todas las etapas del proceso editorial.</p>
  <p style="margin:12px 0 0;font-size:14px">Para entrar, escriba este mismo correo y le enviaremos un enlace de acceso; no necesita contraseña.</p>`
  const texto = `${asunto}\n\nPuede entrar en ${d.url} con este correo; le enviaremos un enlace de acceso.`
  return { asunto, html: marco('Bienvenido a la ventanilla editorial', cuerpo, { texto: 'Entrar a la ventanilla', url: d.url }), texto }
}

export function correoDocumentoNuevo(d: { expediente: DatosExp; archivos: string[]; nota: string | null; url: string }) {
  const e = d.expediente
  const asunto = `${e.codigo} · El ministerio agregó documentos · «${e.titulo}»`
  const lista = d.archivos.map((a) => `<li>${esc(a)}</li>`).join('')
  const cuerpo = `<p style="margin:0;font-size:14px">${esc(e.ministerio)} agregó a «${esc(e.titulo)}»:</p><ul style="font-size:14px">${lista}</ul>
  ${d.nota ? `<div style="padding:12px 14px;background:#F6F2EA;border-left:3px solid ${ROJO};font-size:14px;white-space:pre-wrap">${esc(d.nota)}</div>` : ''}`
  const texto = `${asunto}\n\n${d.archivos.join('\n')}\n\n${d.nota ?? ''}\n\nAbrir en el panel: ${d.url}`
  return { asunto, html: marco('Documentos nuevos en un expediente', cuerpo, { texto: 'Abrir en el panel', url: d.url }), texto }
}
