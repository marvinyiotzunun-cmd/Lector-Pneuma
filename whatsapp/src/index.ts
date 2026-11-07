import { AlmacenD1 } from './almacen';
import { crearBackend } from './backend';
import { Bot } from './flujo';
import { firmaValida, iguales, leerWebhook, Meta } from './meta';
import type { Entrante, Env, EventoPedido, TipoEvento } from './tipos';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

function crearBot(env: Env) {
  const meta = new Meta(env);
  const bot = new Bot(new AlmacenD1(env.DB), crearBackend(env), meta, {
    catalogoMeta: env.META_CATALOG_ID,
    sitio: env.SITIO_URL.replace(/\/$/, ''),
    plantilla: env.PLANTILLA_AVISO,
    idioma: env.PLANTILLA_IDIOMA,
  });
  return { bot, meta };
}

function autorizadoInterno(req: Request, env: Env) {
  const h = req.headers.get('Authorization') ?? '';
  return !!env.INTERNAL_TOKEN && iguales(h, `Bearer ${env.INTERNAL_TOKEN}`);
}

const TIPOS: TipoEvento[] = ['pedido.en_revision', 'pedido.pagado', 'pedido.enviado', 'pedido.entregado', 'pedido.cancelado'];

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const ruta = url.pathname;

    // 1. Verificación del webhook al configurarlo en Meta.
    if (ruta === '/webhook' && req.method === 'GET') {
      const ok =
        url.searchParams.get('hub.mode') === 'subscribe' &&
        !!env.META_VERIFY_TOKEN &&
        url.searchParams.get('hub.verify_token') === env.META_VERIFY_TOKEN;
      return ok ? new Response(url.searchParams.get('hub.challenge') ?? '') : new Response('Prohibido', { status: 403 });
    }

    // 2. Mensajes entrantes de Meta.
    if (ruta === '/webhook' && req.method === 'POST') {
      const cuerpo = await req.text();
      if (env.MODO !== 'sandbox' || env.META_APP_SECRET) {
        if (!env.META_APP_SECRET || !(await firmaValida(cuerpo, req.headers.get('X-Hub-Signature-256'), env.META_APP_SECRET))) {
          return new Response('Firma inválida', { status: 401 });
        }
      }
      let mensajes: Entrante[];
      try {
        mensajes = leerWebhook(JSON.parse(cuerpo));
      } catch {
        return new Response('JSON inválido', { status: 400 });
      }
      const { bot, meta } = crearBot(env);
      // Meta espera un 200 rápido; el trabajo sigue en segundo plano.
      ctx.waitUntil(
        (async () => {
          for (const m of mensajes) {
            try {
              await meta.leido(m.id);
              await bot.recibir(m);
            } catch (err) {
              console.error('Error procesando mensaje', m.id, err);
            }
          }
        })(),
      );
      return new Response('ok');
    }

    // 3. Avisos de cambio de estado desde el backend.
    if (ruta === '/interno/eventos' && req.method === 'POST') {
      if (!autorizadoInterno(req, env)) return new Response('No autorizado', { status: 401 });
      const e = (await req.json().catch(() => null)) as EventoPedido | null;
      if (!e || !TIPOS.includes(e.tipo) || !e.telefono || !e.pedido_id || !e.codigo) return json({ error: 'evento inválido' }, 400);
      if (e.canal && e.canal !== 'whatsapp') return json({ resultado: 'omitido' });
      const { bot } = crearBot(env);
      try {
        return json({ resultado: await bot.evento(e) });
      } catch (err) {
        console.error('evento', err);
        return json({ error: String(err) }, 502);
      }
    }

    // 4. Enlace corto para el botón del sitio y el código QR de los impresos.
    if (ruta === '/hola' && req.method === 'GET') {
      const t = url.searchParams.get('t') ?? 'Hola, quiero información de Publicaciones Pneuma';
      return Response.redirect(`https://wa.me/${env.NUMERO_ATENCION}?text=${encodeURIComponent(t)}`, 302);
    }

    if (ruta === '/salud') return json({ ok: true, modo: env.MODO });

    // 5. Solo en sandbox: simular un cliente sin pasar por Meta.
    if (env.MODO === 'sandbox' && ruta === '/sandbox/simular' && req.method === 'POST') {
      const b = (await req.json()) as {
        de: string;
        nombre?: string;
        texto?: string;
        respuesta_id?: string;
        imagen?: boolean;
        pedido?: { retailer_id: string; cantidad: number }[];
      };
      const desde = (await env.DB.prepare('SELECT COALESCE(MAX(n), 0) AS n FROM salida_sandbox').first<{ n: number }>())!.n;
      const m: Entrante = {
        id: crypto.randomUUID(),
        de: b.de,
        nombre: b.nombre ?? null,
        fecha: Date.now(),
        tipo: b.pedido ? 'pedido' : b.imagen ? 'imagen' : b.respuesta_id ? 'boton' : 'texto',
        texto: b.texto,
        respuesta_id: b.respuesta_id,
        media: b.imagen ? { id: 'media-prueba', mime: 'image/jpeg' } : undefined,
        pedido: b.pedido ? { catalogo: 'prueba', productos: b.pedido.map((p) => ({ ...p, precio: 0 })) } : undefined,
      };
      await crearBot(env).bot.recibir(m);
      const r = await env.DB.prepare('SELECT cuerpo FROM salida_sandbox WHERE n > ? AND telefono = ? ORDER BY n')
        .bind(desde, b.de)
        .all<{ cuerpo: string }>();
      return json(r.results.map((x) => JSON.parse(x.cuerpo)));
    }

    return new Response('No encontrado', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
