export interface Env {
  DB: D1Database;
  MODO: 'sandbox' | 'produccion';
  META_API_VERSION: string;
  META_PHONE_NUMBER_ID: string;
  META_CATALOG_ID: string;
  BACKEND_URL: string;
  SITIO_URL: string;
  NUMERO_ATENCION: string;
  PLANTILLA_AVISO: string;
  PLANTILLA_IDIOMA: string;
  META_TOKEN?: string;
  META_APP_SECRET?: string;
  META_VERIFY_TOKEN?: string;
  INTERNAL_TOKEN?: string;
}

/** Libro tal como lo entrega GET /api/catalogo del backend. */
export interface LibroCatalogo {
  id: string;
  slug: string;
  titulo: string;
  autor: string;
  ministerio?: string | null;
  sinopsis?: string | null;
  portada_url?: string | null;
  ficha_url?: string | null;
  impreso: { precio_gtq: number; disponible: boolean } | null;
  digital: {
    formato: string;
    precio_compra_gtq: number | null;
    precio_alquiler_gtq: number | null;
    dias_alquiler: number | null;
  } | null;
}

export type MetodoPago = 'tarjeta' | 'transferencia' | 'paypal' | 'billetera';

export interface ItemCarrito {
  libro_id: string;
  titulo: string;
  precio_gtq: number;
  cantidad: number;
}

export interface Entrega {
  tipo: 'envio' | 'recoger';
  nombre?: string;
  direccion?: string;
  municipio?: string;
  departamento?: string;
}

export interface NuevoPedido {
  canal: 'whatsapp';
  cliente: { telefono: string; nombre: string };
  items: { libro_id: string; cantidad: number; modalidad: 'impreso' }[];
  entrega: { direccion: string; municipio: string; departamento: string } | null;
  metodo_pago: MetodoPago;
}

export interface PedidoCreado {
  pedido_id: string;
  codigo: string;
  total_gtq: number;
  envio_gtq: number;
  estado: string;
  enlace_pago: string | null;
  instrucciones_pago: string | null;
}

export type TipoEvento =
  | 'pedido.en_revision'
  | 'pedido.pagado'
  | 'pedido.enviado'
  | 'pedido.entregado'
  | 'pedido.cancelado';

export interface EventoPedido {
  tipo: TipoEvento;
  pedido_id: string;
  codigo: string;
  canal: string;
  telefono: string;
  total_gtq?: number;
}

export type Estado =
  | 'inicio'
  | 'menu'
  | 'catalogo'
  | 'carrito'
  | 'entrega_tipo'
  | 'entrega_datos'
  | 'pago'
  | 'esperando_comprobante';

export interface DatosSesion {
  carrito: ItemCarrito[];
  pagina?: number;
  entrega?: Entrega;
  pedido?: { pedido_id: string; codigo: string; total_gtq: number };
}

export interface Sesion {
  telefono: string;
  nombre: string | null;
  estado: Estado;
  datos: DatosSesion;
  ultima_entrada: number;
  humano_hasta: number;
}

/** Mensaje entrante ya simplificado desde el webhook de Meta. */
export interface Entrante {
  id: string;
  de: string;
  nombre: string | null;
  fecha: number;
  tipo: 'texto' | 'boton' | 'lista' | 'pedido' | 'imagen' | 'documento' | 'otro';
  texto?: string;
  respuesta_id?: string;
  media?: { id: string; mime: string };
  pedido?: { catalogo: string; productos: { retailer_id: string; cantidad: number; precio: number }[] };
}

/** Mensaje de salida en formato de la Cloud API (sin messaging_product ni to). */
export type Saliente = Record<string, unknown> & { type: string };
