// Todos los textos que ve el cliente, en un solo lugar para que Pneuma pueda ajustarlos.

export const q = (n: number) => `Q${n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const T = {
  saludo: (nombre: string | null) =>
    `¡Bendiciones${nombre ? `, ${nombre}` : ''}! Bienvenido a *Publicaciones Pneuma*, el sello editorial de la Iglesia de Dios Evangelio Completo de Guatemala.`,
  menu: '¿En qué le podemos servir?',
  menuBoton: 'Ver opciones',
  opciones: {
    catalogo: ['Comprar libros', 'Vea el catálogo y haga su pedido'],
    pedidos: ['Mis pedidos', 'Estado de sus pedidos recientes'],
    publicar: ['Publicar un libro', 'Cómo presentar una obra a Pneuma'],
    persona: ['Hablar con alguien', 'Le atiende una persona del equipo'],
  },
  catalogoCuerpo: 'Estos son nuestros libros impresos. Elija uno para ver su precio y agregarlo a su pedido.',
  catalogoMeta: 'Toque *Ver artículos*, elija sus libros y envíe el carrito. Nosotros le confirmamos el pedido.',
  catalogoVacio: 'Por ahora no tenemos libros disponibles para pedido. Escriba *menú* para volver.',
  verMas: 'Ver más libros',
  libroAgotado: 'Este libro está agotado por el momento. Puede elegir otro del catálogo.',
  agregado: (titulo: string) => `Agregamos *${titulo}* a su pedido.`,
  carritoVacio: 'Su pedido está vacío. Elija un libro del catálogo para empezar.',
  carritoTitulo: '*Su pedido*',
  carritoPie: 'El costo de envío se calcula al confirmar.',
  entregaPregunta: '¿Cómo desea recibir sus libros?',
  entregaDatos:
    'Escríbanos en *un solo mensaje*, separado por comas:\n\n*nombre de quien recibe, dirección, municipio, departamento*\n\nEjemplo: _María López, 7a. avenida 32-31 zona 11, Guatemala, Guatemala_',
  entregaDatosError: 'No logramos leer la dirección. Por favor envíe los cuatro datos separados por comas: nombre, dirección, municipio y departamento.',
  recoger: 'Puede recoger su pedido en nuestras oficinas: 7a. avenida 32-31, zona 11, Las Charcas, Ciudad de Guatemala.',
  pagoPregunta: '¿Cómo desea pagar?',
  pedidoCreado: (codigo: string, total: number, envio: number) =>
    `Listo, registramos su pedido *${codigo}*.\nTotal: *${q(total)}*${envio > 0 ? ` (incluye envío de ${q(envio)})` : ''}.`,
  pagoEnlace: (url: string) => `Puede pagar de forma segura en este enlace:\n${url}\n\nLe avisaremos por aquí en cuanto se confirme el pago.`,
  pagoTransferencia: (instrucciones: string) =>
    `Haga su transferencia o depósito a:\n${instrucciones}\n\nLuego envíenos aquí una *foto o PDF del comprobante*.`,
  comprobanteRecibido: (codigo: string) =>
    `Recibimos su comprobante del pedido *${codigo}*. Nuestro equipo lo revisa y le confirmamos el pago por este medio.`,
  comprobanteError: 'No pudimos guardar su comprobante. Por favor intente enviarlo de nuevo en unos minutos.',
  esperandoComprobante: 'Estamos esperando la foto o PDF de su comprobante. Si prefiere otra opción, escriba *menú*.',
  errorPedido: 'Tuvimos un problema al registrar su pedido. Intente de nuevo en unos minutos o escriba *hablar con alguien*.',
  sinPedidos: 'Aún no tiene pedidos hechos por WhatsApp.',
  misPedidos: '*Sus pedidos recientes*',
  publicar: (url: string) =>
    `Para presentar una obra, el ministerio crea su cuenta en la *Ventanilla digital de publicación*, llena la solicitud y adjunta el manuscrito. Con el código de expediente puede seguir cada etapa.\n\n${url}`,
  persona:
    'Con gusto. Una persona del equipo de Pneuma le responderá por este chat en horario de oficina. Cuando quiera volver al menú automático, escriba *menú*.',
  noEntendido: 'No entendimos su mensaje. Elija una opción del menú, o escriba *hablar con alguien*.',
  estados: {
    pendiente_pago: 'pendiente de pago',
    en_revision: 'comprobante en revisión',
    pagado: 'pagado, en preparación',
    enviado: 'enviado',
    entregado: 'entregado',
    cancelado: 'cancelado',
  } as Record<string, string>,
  avisos: {
    'pedido.en_revision': (c: string) => `Recibimos el comprobante de su pedido *${c}*. Lo estamos revisando.`,
    'pedido.pagado': (c: string) => `¡Gracias! Confirmamos el pago de su pedido *${c}*. Ya lo estamos preparando.`,
    'pedido.enviado': (c: string) => `Su pedido *${c}* va en camino. Pronto lo tendrá en sus manos.`,
    'pedido.entregado': (c: string) => `Su pedido *${c}* fue entregado. ¡Que Dios le bendiga en su lectura!`,
    'pedido.cancelado': (c: string) => `Su pedido *${c}* fue cancelado. Si tiene dudas, escríbanos por aquí.`,
  } as Record<string, (c: string) => string>,
};
