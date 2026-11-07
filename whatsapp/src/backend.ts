import type { Env, LibroCatalogo, NuevoPedido, PedidoCreado } from './tipos';

export interface Backend {
  catalogo(): Promise<LibroCatalogo[]>;
  crearPedido(p: NuevoPedido): Promise<PedidoCreado>;
  enviarComprobante(pedidoId: string, bytes: ArrayBuffer, mime: string): Promise<void>;
}

/** Backend real (hilo «Migrar backend y pagos a Cloudflare», docs/api.md). */
export class BackendHttp implements Backend {
  private cache: { hasta: number; libros: LibroCatalogo[] } | null = null;
  constructor(private env: Env) {}

  private async pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
    const r = await fetch(`${this.env.BACKEND_URL.replace(/\/$/, '')}${ruta}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.env.INTERNAL_TOKEN}`, ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`Backend ${ruta} respondió ${r.status}: ${await r.text()}`);
    return r;
  }

  async catalogo(): Promise<LibroCatalogo[]> {
    if (this.cache && this.cache.hasta > Date.now()) return this.cache.libros;
    const libros = (await (await this.pedir('/api/catalogo')).json()) as LibroCatalogo[];
    this.cache = { hasta: Date.now() + 5 * 60_000, libros };
    return libros;
  }

  async crearPedido(p: NuevoPedido): Promise<PedidoCreado> {
    const r = await this.pedir('/api/interno/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    return (await r.json()) as PedidoCreado;
  }

  async enviarComprobante(pedidoId: string, bytes: ArrayBuffer, mime: string): Promise<void> {
    await this.pedir(`/api/interno/pedidos/${encodeURIComponent(pedidoId)}/comprobante`, {
      method: 'POST',
      headers: { 'Content-Type': mime },
      body: bytes,
    });
  }
}

/** Catálogo y pedidos de prueba, para el modo sandbox. */
export const CATALOGO_PRUEBA: LibroCatalogo[] = [
  ['salmos-escogidos', 'Salmos escogidos', 'Reina-Valera 1909', 45],
  ['el-verbo-hecho-carne', 'El Verbo hecho carne', 'Evangelio de Juan, RV 1909', 60],
  ['manual-del-obrero', 'Manual del obrero cristiano', 'Ministerio de Educación Cristiana', 75],
  ['himnario-evangelio-completo', 'Himnario Evangelio Completo', 'Departamento de Música', 90],
  ['escuela-dominical-adultos', 'Escuela dominical: adultos', 'Ministerio de Educación Cristiana', 35],
  ['jovenes-con-proposito', 'Jóvenes con propósito', 'Ministerio de Jóvenes', 50],
  ['la-familia-cristiana', 'La familia cristiana', 'Ministerio Femenil', 55],
  ['historia-de-la-iglesia', 'Historia de la Iglesia de Dios en Guatemala', 'Junta Editorial', 120],
  ['devocional-365', 'Devocional 365', 'Varios autores', 80],
  ['ninos-y-la-palabra', 'Los niños y la Palabra', 'Ministerio de Niños', 40],
  ['liderazgo-pastoral', 'Liderazgo pastoral', 'Junta Editorial', 95],
  ['agotado-de-prueba', 'Libro agotado (prueba)', 'Junta Editorial', 30],
].map(([id, titulo, autor, precio], i) => ({
  id: id as string,
  slug: id as string,
  titulo: titulo as string,
  autor: autor as string,
  sinopsis: `Libro de prueba número ${i + 1} del catálogo de Publicaciones Pneuma.`,
  portada_url: null,
  ficha_url: `https://pneuma.gt/libros/${id}`,
  impreso: { precio_gtq: precio as number, disponible: id !== 'agotado-de-prueba' },
  digital: null,
}));

export class BackendSandbox implements Backend {
  constructor(private env: Env) {}

  async catalogo() {
    return CATALOGO_PRUEBA;
  }

  async crearPedido(p: NuevoPedido): Promise<PedidoCreado> {
    const n = ((await this.env.DB.prepare('SELECT COUNT(*) AS n FROM pedidos').first<{ n: number }>())?.n ?? 0) + 1;
    const precio = new Map(CATALOGO_PRUEBA.map((l) => [l.id, l.impreso!.precio_gtq]));
    const envio = p.entrega ? 35 : 0;
    const total = p.items.reduce((s, i) => s + (precio.get(i.libro_id) ?? 0) * i.cantidad, 0) + envio;
    return {
      pedido_id: crypto.randomUUID(),
      codigo: `PN-${String(n).padStart(6, '0')}`,
      total_gtq: total,
      envio_gtq: envio,
      estado: 'pendiente_pago',
      enlace_pago: p.metodo_pago === 'tarjeta' || p.metodo_pago === 'paypal' ? 'https://pagos.ejemplo/prueba' : null,
      instrucciones_pago:
        p.metodo_pago === 'transferencia'
          ? 'Banco de prueba · Cuenta monetaria 000-000000-0 · A nombre de Publicaciones Pneuma'
          : null,
    };
  }

  async enviarComprobante() {}
}

export function crearBackend(env: Env): Backend {
  return env.MODO === 'sandbox' || !env.BACKEND_URL ? new BackendSandbox(env) : new BackendHttp(env);
}
