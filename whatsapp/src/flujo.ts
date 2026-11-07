import type { Almacen } from './almacen';
import type { Backend } from './backend';
import { botones, imagen, lista, plantilla, productos, texto } from './meta';
import { q, T } from './textos';
import type { Entrante, EventoPedido, LibroCatalogo, MetodoPago, Saliente, Sesion } from './tipos';

export interface Enviador {
  enviar(telefono: string, m: Saliente): Promise<void>;
  descargar(mediaId: string): Promise<{ bytes: ArrayBuffer; mime: string }>;
}

export interface Config {
  catalogoMeta: string;
  sitio: string;
  plantilla: string;
  idioma: string;
}

const POR_PAGINA = 9; // 9 libros + «Ver más» = 10 filas, el máximo de una lista
const VENTANA = 24 * 3600_000;
const HUMANO = 12 * 3600_000;

const normal = (s = '') =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

export class Bot {
  constructor(
    private almacen: Almacen,
    private backend: Backend,
    private wa: Enviador,
    private cfg: Config,
    private ahora: () => number = Date.now,
  ) {}

  // ---------- Mensajes del cliente ----------

  async recibir(m: Entrante): Promise<void> {
    if (!(await this.almacen.marcarProcesado(m.id))) return; // reintento de Meta
    const s = await this.almacen.sesion(m.de);
    const nuevo = s.ultima_entrada === 0;
    s.ultima_entrada = this.ahora();
    if (m.nombre) s.nombre = m.nombre;

    const t = normal(m.texto);
    const pideMenu = m.tipo === 'texto' && ['menu', 'inicio', 'bot', '0'].includes(t);

    // Atiende una persona: el bot no interviene salvo que el cliente pida el menú.
    if (s.humano_hasta > this.ahora() && !pideMenu) return this.almacen.guardar(s);
    if (pideMenu) s.humano_hasta = 0;

    try {
      await this.despachar(s, m, t, nuevo, pideMenu);
    } finally {
      await this.almacen.guardar(s);
    }
  }

  private async despachar(s: Sesion, m: Entrante, t: string, nuevo: boolean, pideMenu: boolean) {
    const tel = s.telefono;
    if (m.tipo === 'pedido' && m.pedido) return this.pedidoDeCatalogo(s, m.pedido.productos);
    if (m.respuesta_id) return this.opcion(s, m.respuesta_id);

    if ((m.tipo === 'imagen' || m.tipo === 'documento') && s.estado === 'esperando_comprobante') return this.comprobante(s, m.media!);

    if (m.tipo === 'texto' && !pideMenu) {
      if (t === 'cancelar') {
        s.datos = { carrito: [] };
        return this.menu(s, false);
      }
      if (t.includes('hablar') || t.includes('persona') || t.includes('asesor')) return this.opcion(s, 'menu:persona');
      if (s.estado === 'entrega_datos') return this.datosEntrega(s, m.texto ?? '');
      if (s.estado === 'esperando_comprobante') return this.wa.enviar(tel, texto(T.esperandoComprobante));
      if (t.includes('catalogo') || t.includes('libro') || t.includes('comprar') || t.includes('pedir')) return this.catalogo(s, 0);
      if (t.includes('pedido')) return this.misPedidos(s);
      if (t.includes('publicar')) return this.opcion(s, 'menu:publicar');
    }
    return this.menu(s, nuevo || s.estado === 'inicio' || pideMenu);
  }

  private async opcion(s: Sesion, id: string): Promise<void> {
    const [grupo, valor, extra] = id.split(':');
    const tel = s.telefono;
    switch (grupo) {
      case 'menu':
        if (valor === 'catalogo') return this.catalogo(s, 0);
        if (valor === 'pedidos') return this.misPedidos(s);
        if (valor === 'publicar') {
          s.estado = 'menu';
          return this.wa.enviar(tel, texto(T.publicar(`${this.cfg.sitio}/ventanilla`)));
        }
        if (valor === 'persona') {
          s.humano_hasta = this.ahora() + HUMANO;
          s.estado = 'menu';
          return this.wa.enviar(tel, texto(T.persona));
        }
        return this.menu(s, false);
      case 'cat':
        return this.catalogo(s, Number(extra ?? valor) || 0);
      case 'libro':
        return this.libro(s, valor);
      case 'agregar':
        return this.agregar(s, valor);
      case 'carrito':
        if (valor === 'finalizar') return this.preguntarEntrega(s);
        if (valor === 'vaciar') {
          s.datos.carrito = [];
          return this.menu(s, false);
        }
        return this.mostrarCarrito(s);
      case 'entrega':
        if (!s.datos.carrito.length) return this.mostrarCarrito(s);
        if (valor === 'recoger') {
          s.datos.entrega = { tipo: 'recoger' };
          await this.wa.enviar(tel, texto(T.recoger));
          return this.preguntarPago(s);
        }
        s.estado = 'entrega_datos';
        return this.wa.enviar(tel, texto(T.entregaDatos));
      case 'pago':
        return this.crearPedido(s, valor as MetodoPago);
      default:
        return this.menu(s, false);
    }
  }

  private async menu(s: Sesion, saludar: boolean) {
    s.estado = 'menu';
    const o = T.opciones;
    const cuerpo = saludar ? `${T.saludo(s.nombre)}\n\n${T.menu}` : T.menu;
    const filas = [
      { id: 'menu:catalogo', titulo: o.catalogo[0], descripcion: o.catalogo[1] },
      { id: 'menu:pedidos', titulo: o.pedidos[0], descripcion: o.pedidos[1] },
      { id: 'menu:publicar', titulo: o.publicar[0], descripcion: o.publicar[1] },
      { id: 'menu:persona', titulo: o.persona[0], descripcion: o.persona[1] },
    ];
    if (s.datos.carrito.length) filas.splice(1, 0, { id: 'carrito:ver', titulo: 'Ver mi pedido', descripcion: `${s.datos.carrito.length} libro(s) agregados` });
    await this.wa.enviar(s.telefono, lista(cuerpo, T.menuBoton, filas));
  }

  private async disponibles(): Promise<LibroCatalogo[]> {
    return (await this.backend.catalogo()).filter((l) => l.impreso?.disponible);
  }

  private async catalogo(s: Sesion, pagina: number) {
    s.estado = 'catalogo';
    const libros = await this.disponibles();
    if (!libros.length) return this.wa.enviar(s.telefono, texto(T.catalogoVacio));

    if (this.cfg.catalogoMeta) {
      return this.wa.enviar(s.telefono, productos(this.cfg.catalogoMeta, libros.map((l) => l.id), 'Libros de Pneuma', T.catalogoMeta));
    }
    const desde = pagina * POR_PAGINA;
    const trozo = libros.slice(desde, desde + POR_PAGINA);
    const filas = trozo.map((l) => ({ id: `libro:${l.id}`, titulo: l.titulo, descripcion: `${q(l.impreso!.precio_gtq)} · ${l.autor}` }));
    if (desde + POR_PAGINA < libros.length) filas.push({ id: `cat:pag:${pagina + 1}`, titulo: T.verMas, descripcion: `Página ${pagina + 2}` });
    s.datos.pagina = pagina;
    await this.wa.enviar(s.telefono, lista(T.catalogoCuerpo, 'Ver libros', filas, 'Catálogo Pneuma'));
  }

  private async libro(s: Sesion, id: string) {
    const l = (await this.backend.catalogo()).find((x) => x.id === id);
    if (!l?.impreso?.disponible) return this.wa.enviar(s.telefono, texto(T.libroAgotado));
    if (l.portada_url) await this.wa.enviar(s.telefono, imagen(l.portada_url));
    const partes = [`*${l.titulo}*`, l.autor, `Precio: *${q(l.impreso.precio_gtq)}*`];
    if (l.sinopsis) partes.push('', l.sinopsis.slice(0, 600));
    if (l.ficha_url) partes.push('', `Ficha completa: ${l.ficha_url}`);
    await this.wa.enviar(
      s.telefono,
      botones(partes.join('\n'), [
        [`agregar:${l.id}`, 'Agregar al pedido'],
        [`cat:pag:${s.datos.pagina ?? 0}`, 'Ver otros libros'],
        ['carrito:ver', 'Ver mi pedido'],
      ]),
    );
  }

  private async agregar(s: Sesion, id: string) {
    const l = (await this.backend.catalogo()).find((x) => x.id === id);
    if (!l?.impreso?.disponible) return this.wa.enviar(s.telefono, texto(T.libroAgotado));
    const ya = s.datos.carrito.find((i) => i.libro_id === id);
    if (ya) ya.cantidad += 1;
    else s.datos.carrito.push({ libro_id: id, titulo: l.titulo, precio_gtq: l.impreso.precio_gtq, cantidad: 1 });
    return this.mostrarCarrito(s, T.agregado(l.titulo));
  }

  private async pedidoDeCatalogo(s: Sesion, items: { retailer_id: string; cantidad: number }[]) {
    const libros = await this.backend.catalogo();
    s.datos.carrito = [];
    for (const it of items) {
      const l = libros.find((x) => x.id === it.retailer_id || x.slug === it.retailer_id);
      if (l?.impreso?.disponible) s.datos.carrito.push({ libro_id: l.id, titulo: l.titulo, precio_gtq: l.impreso.precio_gtq, cantidad: it.cantidad });
    }
    if (!s.datos.carrito.length) return this.wa.enviar(s.telefono, texto(T.libroAgotado));
    return this.mostrarCarrito(s);
  }

  private resumen(s: Sesion): string {
    const lineas = s.datos.carrito.map((i) => `• ${i.cantidad} × ${i.titulo} — ${q(i.precio_gtq * i.cantidad)}`);
    const sub = s.datos.carrito.reduce((a, i) => a + i.precio_gtq * i.cantidad, 0);
    return `${lineas.join('\n')}\n\nSubtotal: *${q(sub)}*`;
  }

  private async mostrarCarrito(s: Sesion, antes?: string) {
    if (!s.datos.carrito.length) {
      await this.wa.enviar(s.telefono, texto(T.carritoVacio));
      return this.catalogo(s, 0);
    }
    s.estado = 'carrito';
    const cuerpo = `${antes ? antes + '\n\n' : ''}${T.carritoTitulo}\n${this.resumen(s)}`;
    await this.wa.enviar(
      s.telefono,
      botones(
        cuerpo,
        [
          ['carrito:finalizar', 'Finalizar pedido'],
          [`cat:pag:${s.datos.pagina ?? 0}`, 'Agregar otro libro'],
          ['carrito:vaciar', 'Vaciar pedido'],
        ],
        T.carritoPie,
      ),
    );
  }

  private async preguntarEntrega(s: Sesion) {
    if (!s.datos.carrito.length) return this.mostrarCarrito(s);
    s.estado = 'entrega_tipo';
    await this.wa.enviar(s.telefono, botones(T.entregaPregunta, [['entrega:envio', 'Envío a domicilio'], ['entrega:recoger', 'Recoger en Pneuma']]));
  }

  private async datosEntrega(s: Sesion, crudo: string) {
    const partes = crudo.split(/[,\n]+/).map((p) => p.trim()).filter(Boolean);
    if (partes.length < 4) return this.wa.enviar(s.telefono, texto(T.entregaDatosError));
    const departamento = partes.pop()!;
    const municipio = partes.pop()!;
    const nombre = partes.shift()!;
    s.datos.entrega = { tipo: 'envio', nombre, direccion: partes.join(', '), municipio, departamento };
    return this.preguntarPago(s);
  }

  private async preguntarPago(s: Sesion) {
    s.estado = 'pago';
    await this.wa.enviar(
      s.telefono,
      botones(T.pagoPregunta, [['pago:tarjeta', 'Tarjeta'], ['pago:transferencia', 'Transferencia'], ['pago:paypal', 'PayPal']]),
    );
  }

  private async crearPedido(s: Sesion, metodo: MetodoPago) {
    const e = s.datos.entrega;
    if (!s.datos.carrito.length || !e) return this.mostrarCarrito(s);
    let p;
    try {
      p = await this.backend.crearPedido({
        canal: 'whatsapp',
        cliente: { telefono: s.telefono, nombre: e.nombre ?? s.nombre ?? '' },
        items: s.datos.carrito.map((i) => ({ libro_id: i.libro_id, cantidad: i.cantidad, modalidad: 'impreso' })),
        entrega: e.tipo === 'envio' ? { nombre: e.nombre, direccion: e.direccion!, municipio: e.municipio!, departamento: e.departamento! } : null,
        metodo_pago: metodo,
      });
    } catch (err) {
      console.error('crearPedido', err);
      return this.wa.enviar(s.telefono, texto(T.errorPedido));
    }
    await this.almacen.guardarPedido({
      pedido_id: p.pedido_id,
      codigo: p.codigo,
      telefono: s.telefono,
      total_gtq: p.total_gtq,
      estado: p.estado,
      metodo,
      resumen: s.datos.carrito.map((i) => `${i.cantidad} × ${i.titulo}`).join('; '),
      creado: this.ahora(),
    });
    s.datos = { carrito: [], pedido: { pedido_id: p.pedido_id, codigo: p.codigo, total_gtq: p.total_gtq } };
    let mensaje = T.pedidoCreado(p.codigo, p.total_gtq, p.envio_gtq);
    if (metodo === 'transferencia' || metodo === 'billetera') {
      s.estado = 'esperando_comprobante';
      mensaje += '\n\n' + T.pagoTransferencia(p.instrucciones_pago ?? '');
    } else {
      s.estado = 'menu';
      mensaje += '\n\n' + (p.enlace_pago ? T.pagoEnlace(p.enlace_pago) : (p.instrucciones_pago ?? ''));
    }
    await this.wa.enviar(s.telefono, texto(mensaje));
  }

  private async comprobante(s: Sesion, media: { id: string; mime: string }) {
    const ped = s.datos.pedido;
    if (!ped) return this.menu(s, false);
    try {
      const { bytes, mime } = await this.wa.descargar(media.id);
      await this.backend.enviarComprobante(ped.pedido_id, bytes, mime || media.mime);
    } catch (err) {
      console.error('comprobante', err);
      return this.wa.enviar(s.telefono, texto(T.comprobanteError));
    }
    await this.almacen.actualizarPedido(ped.pedido_id, 'en_revision');
    s.estado = 'menu';
    await this.wa.enviar(s.telefono, texto(T.comprobanteRecibido(ped.codigo)));
  }

  private async misPedidos(s: Sesion) {
    s.estado = 'menu';
    const ps = await this.almacen.pedidos(s.telefono, 5);
    if (!ps.length) return this.wa.enviar(s.telefono, texto(T.sinPedidos));
    const lineas = ps.map((p) => `• *${p.codigo}* — ${q(p.total_gtq)} — ${T.estados[p.estado] ?? p.estado}\n  ${p.resumen}`);
    await this.wa.enviar(s.telefono, texto(`${T.misPedidos}\n\n${lineas.join('\n')}`));
  }

  /** Alguien del equipo escribió desde la app: el bot se aparta para no interrumpir la conversación. */
  async atiendePersona(telefono: string): Promise<void> {
    const s = await this.almacen.sesion(telefono);
    s.humano_hasta = this.ahora() + HUMANO;
    await this.almacen.guardar(s);
  }

  // ---------- Avisos que manda el backend ----------

  async evento(e: EventoPedido): Promise<'enviado' | 'omitido'> {
    const estado = e.tipo.replace('pedido.', '');
    const anterior = (await this.almacen.pedidos(e.telefono, 50)).find((p) => p.pedido_id === e.pedido_id)?.estado;
    await this.almacen.actualizarPedido(e.pedido_id, estado);
    // Ya le dijimos que recibimos su comprobante; no repetimos.
    if (e.tipo === 'pedido.en_revision' && anterior === 'en_revision') return 'omitido';

    const s = await this.almacen.sesion(e.telefono);
    if (s.datos.pedido?.pedido_id === e.pedido_id && e.tipo !== 'pedido.en_revision') {
      if (s.estado === 'esperando_comprobante') s.estado = 'menu';
      await this.almacen.guardar(s);
    }
    const dentroDeVentana = this.ahora() - s.ultima_entrada < VENTANA;
    if (dentroDeVentana) {
      await this.wa.enviar(e.telefono, texto(T.avisos[e.tipo](e.codigo)));
    } else {
      // Fuera de las 24 horas Meta solo permite plantillas aprobadas (categoría «utilidad»).
      await this.wa.enviar(e.telefono, plantilla(this.cfg.plantilla, this.cfg.idioma, [e.codigo, T.estados[estado] ?? estado]));
    }
    return 'enviado';
  }
}
