import type { Sesion } from './tipos';

export interface PedidoLocal {
  pedido_id: string;
  codigo: string;
  telefono: string;
  total_gtq: number;
  estado: string;
  metodo: string;
  resumen: string;
  creado: number;
}

export interface Almacen {
  sesion(telefono: string): Promise<Sesion>;
  guardar(s: Sesion): Promise<void>;
  /** Devuelve false si el mensaje ya se había procesado. */
  marcarProcesado(id: string): Promise<boolean>;
  guardarPedido(p: PedidoLocal): Promise<void>;
  actualizarPedido(pedidoId: string, estado: string): Promise<PedidoLocal | null>;
  pedidos(telefono: string, n: number): Promise<PedidoLocal[]>;
}

const nueva = (telefono: string): Sesion => ({
  telefono,
  nombre: null,
  estado: 'inicio',
  datos: { carrito: [] },
  ultima_entrada: 0,
  humano_hasta: 0,
});

export class AlmacenD1 implements Almacen {
  constructor(private db: D1Database) {}

  async sesion(telefono: string): Promise<Sesion> {
    const f = await this.db.prepare('SELECT * FROM sesiones WHERE telefono = ?').bind(telefono).first<any>();
    if (!f) return nueva(telefono);
    return { ...f, datos: JSON.parse(f.datos) };
  }

  async guardar(s: Sesion): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sesiones (telefono, nombre, estado, datos, ultima_entrada, humano_hasta, actualizado)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(telefono) DO UPDATE SET nombre = excluded.nombre, estado = excluded.estado, datos = excluded.datos,
           ultima_entrada = excluded.ultima_entrada, humano_hasta = excluded.humano_hasta, actualizado = excluded.actualizado`,
      )
      .bind(s.telefono, s.nombre, s.estado, JSON.stringify(s.datos), s.ultima_entrada, s.humano_hasta, Date.now())
      .run();
  }

  async marcarProcesado(id: string): Promise<boolean> {
    const r = await this.db.prepare('INSERT OR IGNORE INTO mensajes_procesados (id, recibido) VALUES (?, ?)').bind(id, Date.now()).run();
    return (r.meta.changes ?? 0) > 0;
  }

  async guardarPedido(p: PedidoLocal): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO pedidos (pedido_id, codigo, telefono, total_gtq, estado, metodo, resumen, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(p.pedido_id, p.codigo, p.telefono, p.total_gtq, p.estado, p.metodo, p.resumen, p.creado, p.creado)
      .run();
  }

  async actualizarPedido(pedidoId: string, estado: string): Promise<PedidoLocal | null> {
    await this.db.prepare('UPDATE pedidos SET estado = ?, actualizado = ? WHERE pedido_id = ?').bind(estado, Date.now(), pedidoId).run();
    return this.db.prepare('SELECT * FROM pedidos WHERE pedido_id = ?').bind(pedidoId).first<PedidoLocal>();
  }

  async pedidos(telefono: string, n: number): Promise<PedidoLocal[]> {
    const r = await this.db.prepare('SELECT * FROM pedidos WHERE telefono = ? ORDER BY creado DESC LIMIT ?').bind(telefono, n).all<PedidoLocal>();
    return r.results;
  }
}

/** Para pruebas. */
export class AlmacenMemoria implements Almacen {
  sesiones = new Map<string, Sesion>();
  procesados = new Set<string>();
  lista: PedidoLocal[] = [];

  async sesion(t: string) {
    return structuredClone(this.sesiones.get(t) ?? nueva(t));
  }
  async guardar(s: Sesion) {
    this.sesiones.set(s.telefono, structuredClone(s));
  }
  async marcarProcesado(id: string) {
    if (this.procesados.has(id)) return false;
    this.procesados.add(id);
    return true;
  }
  async guardarPedido(p: PedidoLocal) {
    this.lista.push(p);
  }
  async actualizarPedido(id: string, estado: string) {
    const p = this.lista.find((x) => x.pedido_id === id);
    if (p) p.estado = estado;
    return p ?? null;
  }
  async pedidos(t: string, n: number) {
    return this.lista.filter((p) => p.telefono === t).sort((a, b) => b.creado - a.creado).slice(0, n);
  }
}
