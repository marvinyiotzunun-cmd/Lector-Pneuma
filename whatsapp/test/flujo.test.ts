import { describe, expect, it } from 'vitest';
import { AlmacenMemoria } from '../src/almacen';
import { CATALOGO_PRUEBA, type Backend } from '../src/backend';
import { Bot } from '../src/flujo';
import { firmaValida, leerEcos, leerWebhook } from '../src/meta';
import type { Entrante, NuevoPedido, Saliente } from '../src/tipos';

const TEL = '50255550000';

function armar(opts: { catalogoMeta?: string } = {}) {
  const almacen = new AlmacenMemoria();
  const salida: Saliente[] = [];
  const pedidos: NuevoPedido[] = [];
  const comprobantes: string[] = [];
  let reloj = 1_700_000_000_000;
  const backend: Backend = {
    catalogo: async () => CATALOGO_PRUEBA,
    crearPedido: async (p) => {
      pedidos.push(p);
      return {
        pedido_id: `id-${pedidos.length}`,
        codigo: `PN-00000${pedidos.length}`,
        total_gtq: 140,
        envio_gtq: 35,
        estado: 'pendiente_pago',
        enlace_pago: p.metodo_pago === 'tarjeta' ? 'https://pago/x' : null,
        instrucciones_pago: p.metodo_pago === 'transferencia' ? 'Banco X cuenta 1' : null,
      };
    },
    enviarComprobante: async (id) => void comprobantes.push(id),
  };
  const wa = {
    enviar: async (_t: string, m: Saliente) => void salida.push(m),
    descargar: async () => ({ bytes: new ArrayBuffer(4), mime: 'image/jpeg' }),
  };
  const bot = new Bot(almacen, backend, wa, { catalogoMeta: opts.catalogoMeta ?? '', sitio: 'https://pneuma.gt', plantilla: 'pedido_actualizado', idioma: 'es' }, () => reloj);
  let n = 0;
  const enviar = async (m: Partial<Entrante>) => {
    salida.length = 0;
    await bot.recibir({ id: `m${++n}`, de: TEL, nombre: 'Ana', fecha: reloj, tipo: m.respuesta_id ? 'boton' : 'texto', ...m } as Entrante);
    return [...salida];
  };
  return { bot, almacen, salida, pedidos, comprobantes, enviar, avanzar: (ms: number) => (reloj += ms) };
}

const cuerpo = (m: any) => m?.text?.body ?? m?.interactive?.body?.text ?? '';
const ids = (m: any) =>
  m.interactive.type === 'list'
    ? m.interactive.action.sections[0].rows.map((r: any) => r.id)
    : m.interactive.action.buttons.map((b: any) => b.reply.id);

describe('flujo de pedido', () => {
  it('saluda y muestra el menú', async () => {
    const { enviar } = armar();
    const [m] = await enviar({ texto: 'Hola' });
    expect(cuerpo(m)).toContain('Bendiciones, Ana');
    expect(ids(m)).toEqual(['menu:catalogo', 'menu:pedidos', 'menu:publicar', 'menu:persona']);
  });

  it('pagina el catálogo sin libros agotados', async () => {
    const { enviar } = armar();
    const [p1] = await enviar({ respuesta_id: 'menu:catalogo' });
    expect(ids(p1)).toHaveLength(10);
    expect(ids(p1).at(-1)).toBe('cat:pag:1');
    const [p2] = await enviar({ respuesta_id: 'cat:pag:1' });
    expect(ids(p2)).toEqual([`libro:${CATALOGO_PRUEBA[9].id}`, `libro:${CATALOGO_PRUEBA[10].id}`]);
  });

  it('pedido completo con envío y transferencia, comprobante y aviso de pago', async () => {
    const { enviar, pedidos, comprobantes, bot, almacen } = armar();
    await enviar({ texto: 'hola' });
    await enviar({ respuesta_id: 'agregar:salmos-escogidos' });
    const [carrito] = await enviar({ respuesta_id: 'agregar:salmos-escogidos' });
    expect(cuerpo(carrito)).toContain('2 × Salmos escogidos');
    await enviar({ respuesta_id: 'agregar:devocional-365' });
    const [entrega] = await enviar({ respuesta_id: 'carrito:finalizar' });
    expect(ids(entrega)).toEqual(['entrega:envio', 'entrega:recoger']);
    await enviar({ respuesta_id: 'entrega:envio' });
    const [error] = await enviar({ texto: 'solo un dato' });
    expect(cuerpo(error)).toContain('No logramos leer');
    const [pago] = await enviar({ texto: 'María López, 7a. avenida 32-31, zona 11, Mixco, Guatemala' });
    expect(ids(pago)).toEqual(['pago:tarjeta', 'pago:transferencia', 'pago:paypal']);
    const [creado] = await enviar({ respuesta_id: 'pago:transferencia' });
    expect(cuerpo(creado)).toContain('PN-000001');
    expect(cuerpo(creado)).toContain('Banco X cuenta 1');
    expect(pedidos[0]).toEqual({
      canal: 'whatsapp',
      cliente: { telefono: TEL, nombre: 'María López' },
      items: [
        { libro_id: 'salmos-escogidos', cantidad: 2, modalidad: 'impreso' },
        { libro_id: 'devocional-365', cantidad: 1, modalidad: 'impreso' },
      ],
      entrega: { nombre: 'María López', direccion: '7a. avenida 32-31, zona 11', municipio: 'Mixco', departamento: 'Guatemala' },
      metodo_pago: 'transferencia',
    });
    const [esperando] = await enviar({ texto: 'ya pagué' });
    expect(cuerpo(esperando)).toContain('esperando la foto');
    const [recibido] = await enviar({ tipo: 'imagen', media: { id: 'x', mime: 'image/jpeg' } });
    expect(cuerpo(recibido)).toContain('Recibimos su comprobante');
    expect(comprobantes).toEqual(['id-1']);

    expect(await bot.evento({ tipo: 'pedido.en_revision', pedido_id: 'id-1', codigo: 'PN-000001', canal: 'whatsapp', telefono: TEL })).toBe('omitido');
    expect(await bot.evento({ tipo: 'pedido.pagado', pedido_id: 'id-1', codigo: 'PN-000001', canal: 'whatsapp', telefono: TEL })).toBe('enviado');
    const [mis] = await enviar({ respuesta_id: 'menu:pedidos' });
    expect(cuerpo(mis)).toContain('PN-000001');
    expect(cuerpo(mis)).toContain('pagado');
    expect((await almacen.sesion(TEL)).datos.carrito).toEqual([]);
  });

  it('tarjeta con recoger en oficina manda el enlace', async () => {
    const { enviar, pedidos } = armar();
    await enviar({ respuesta_id: 'agregar:manual-del-obrero' });
    await enviar({ respuesta_id: 'carrito:finalizar' });
    const msjs = await enviar({ respuesta_id: 'entrega:recoger' });
    expect(cuerpo(msjs[0])).toContain('7a. avenida 32-31');
    const [creado] = await enviar({ respuesta_id: 'pago:tarjeta' });
    expect(cuerpo(creado)).toContain('https://pago/x');
    expect(pedidos[0].entrega).toBeNull();
  });

  it('carrito enviado desde el catálogo de Meta', async () => {
    const { enviar } = armar({ catalogoMeta: '123' });
    const [cat] = await enviar({ respuesta_id: 'menu:catalogo' });
    expect((cat as any).interactive.type).toBe('product_list');
    const [carrito] = await enviar({
      tipo: 'pedido',
      pedido: { catalogo: '123', productos: [{ retailer_id: 'salmos-escogidos', cantidad: 3, precio: 45 }, { retailer_id: 'agotado-de-prueba', cantidad: 1, precio: 30 }] },
    });
    expect(cuerpo(carrito)).toContain('3 × Salmos escogidos');
    expect(cuerpo(carrito)).not.toContain('agotado');
  });

  it('modo persona: el bot calla hasta que piden el menú', async () => {
    const { enviar } = armar();
    await enviar({ texto: 'quiero hablar con una persona' });
    expect(await enviar({ texto: '¿tienen biblias?' })).toHaveLength(0);
    expect(await enviar({ texto: 'Menú' })).toHaveLength(1);
  });

  it('si el equipo escribe desde la app, el bot se aparta', async () => {
    const { enviar, bot } = armar();
    await enviar({ texto: 'hola' });
    await bot.atiendePersona(TEL);
    expect(await enviar({ texto: 'gracias' })).toHaveLength(0);
    expect(
      leerEcos({ entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [{ from: '502', to: TEL, id: 'e1' }] } }] }] }),
    ).toEqual([TEL]);
  });

  it('ignora reintentos de Meta con el mismo id', async () => {
    const { bot, salida } = armar();
    const m: Entrante = { id: 'igual', de: TEL, nombre: null, fecha: 0, tipo: 'texto', texto: 'hola' };
    await bot.recibir(m);
    await bot.recibir(m);
    expect(salida).toHaveLength(1);
  });

  it('fuera de la ventana de 24 h usa la plantilla', async () => {
    const { enviar, bot, salida, avanzar } = armar();
    await enviar({ texto: 'hola' });
    avanzar(25 * 3600_000);
    salida.length = 0;
    await bot.evento({ tipo: 'pedido.enviado', pedido_id: 'z', codigo: 'PN-000009', canal: 'whatsapp', telefono: TEL });
    expect(salida[0]).toMatchObject({ type: 'template', template: { name: 'pedido_actualizado' } });
  });
});

describe('webhook de Meta', () => {
  it('lee texto, botones, pedidos e imágenes e ignora estados', () => {
    const r = leerWebhook({
      entry: [
        {
          changes: [
            { value: { statuses: [{ id: 'x' }] } },
            {
              value: {
                contacts: [{ wa_id: TEL, profile: { name: 'Ana' } }],
                messages: [
                  { id: '1', from: TEL, timestamp: '1', type: 'text', text: { body: 'hola' } },
                  { id: '2', from: TEL, timestamp: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'menu:catalogo', title: 'x' } } },
                  { id: '3', from: TEL, timestamp: '1', type: 'order', order: { catalog_id: 'c', product_items: [{ product_retailer_id: 'a', quantity: '2', item_price: '45' }] } },
                  { id: '4', from: TEL, timestamp: '1', type: 'image', image: { id: 'img', mime_type: 'image/jpeg' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(r.map((m) => m.tipo)).toEqual(['texto', 'lista', 'pedido', 'imagen']);
    expect(r[0].nombre).toBe('Ana');
    expect(r[2].pedido!.productos[0]).toEqual({ retailer_id: 'a', cantidad: 2, precio: 45 });
  });

  it('valida la firma HMAC', async () => {
    const secreto = 'abc';
    const cuerpo = '{"a":1}';
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(cuerpo)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await firmaValida(cuerpo, `sha256=${hex}`, secreto)).toBe(true);
    expect(await firmaValida(cuerpo + ' ', `sha256=${hex}`, secreto)).toBe(false);
    expect(await firmaValida(cuerpo, null, secreto)).toBe(false);
  });
});
