// Datos generales del sitio. Lo marcado como PENDIENTE lo debe confirmar Pneuma.
export const SITIO = {
  nombre: 'Publicaciones Pneuma',
  lema: 'Sello editorial de la Iglesia de Dios Evangelio Completo de Guatemala',
  correo: 'publicacionespneuma@gmail.com',
  direccion: '7a. avenida 32-31, zona 11, Las Charcas, Ciudad de Guatemala',
  // PENDIENTE: número de WhatsApp Business de Pneuma, solo dígitos con código de país (502...).
  whatsapp: import.meta.env.PUBLIC_WHATSAPP || '50200000000',
  // PENDIENTE: horario de atención y redes sociales oficiales.
  horario: 'Lunes a viernes, 8:00 a 16:00',
  redes: {
    facebook: import.meta.env.PUBLIC_FACEBOOK || '',
    instagram: import.meta.env.PUBLIC_INSTAGRAM || '',
    youtube: import.meta.env.PUBLIC_YOUTUBE || '',
  },
  // Cuentas de editor (cortesía de la cotización). Se llenan cuando estén abiertas.
  tiendas: {
    amazon: import.meta.env.PUBLIC_AMAZON_AUTOR || '',
    google_play: import.meta.env.PUBLIC_GOOGLE_PLAY || '',
  },
  // Envío a domicilio: lo fija el backend (ajustes.envio_centavos). Este es el valor de ejemplo.
  envio_gtq: 35,
  // Rutas de otros módulos del mismo dominio.
  ventanilla: '/panel#/ventanilla',
  lector: '/lector',
}

export function enlaceWhatsApp(texto?: string) {
  const base = `https://wa.me/${SITIO.whatsapp}`
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base
}
