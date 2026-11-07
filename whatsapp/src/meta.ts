import type { Entrante, Env, Saliente } from './tipos';

const enc = new TextEncoder();

/** Verifica la cabecera X-Hub-Signature-256 que Meta firma con el App Secret. */
export async function firmaValida(cuerpo: string, cabecera: string | null, secreto: string): Promise<boolean> {
  if (!cabecera?.startsWith('sha256=')) return false;
  const clave = await crypto.subtle.importKey('raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', clave, enc.encode(cuerpo)));
  const esperado = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return iguales(esperado, cabecera.slice(7).toLowerCase());
}

export function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Convierte el cuerpo del webhook de Meta en mensajes entrantes simples. Ignora estados de entrega. */
export function leerWebhook(json: any): Entrante[] {
  const salida: Entrante[] = [];
  for (const entrada of json?.entry ?? []) {
    for (const cambio of entrada?.changes ?? []) {
      const v = cambio?.value;
      if (!v?.messages) continue;
      const nombres = new Map<string, string>();
      for (const c of v.contacts ?? []) nombres.set(c.wa_id, c.profile?.name ?? null);
      for (const m of v.messages) {
        const base = { id: m.id, de: m.from, nombre: nombres.get(m.from) ?? null, fecha: Number(m.timestamp) * 1000 || Date.now() };
        switch (m.type) {
          case 'text':
            salida.push({ ...base, tipo: 'texto', texto: m.text?.body ?? '' });
            break;
          case 'button': // respuesta a botón de plantilla
            salida.push({ ...base, tipo: 'boton', respuesta_id: m.button?.payload, texto: m.button?.text });
            break;
          case 'interactive': {
            const i = m.interactive;
            if (i?.type === 'button_reply') salida.push({ ...base, tipo: 'boton', respuesta_id: i.button_reply.id, texto: i.button_reply.title });
            else if (i?.type === 'list_reply') salida.push({ ...base, tipo: 'lista', respuesta_id: i.list_reply.id, texto: i.list_reply.title });
            else salida.push({ ...base, tipo: 'otro' });
            break;
          }
          case 'order':
            salida.push({
              ...base,
              tipo: 'pedido',
              texto: m.order?.text,
              pedido: {
                catalogo: m.order?.catalog_id,
                productos: (m.order?.product_items ?? []).map((p: any) => ({
                  retailer_id: String(p.product_retailer_id),
                  cantidad: Number(p.quantity) || 1,
                  precio: Number(p.item_price) || 0,
                })),
              },
            });
            break;
          case 'image':
            salida.push({ ...base, tipo: 'imagen', media: { id: m.image.id, mime: m.image.mime_type }, texto: m.image.caption });
            break;
          case 'document':
            salida.push({ ...base, tipo: 'documento', media: { id: m.document.id, mime: m.document.mime_type }, texto: m.document.caption });
            break;
          default:
            salida.push({ ...base, tipo: 'otro' });
        }
      }
    }
  }
  return salida;
}

/** Cliente de envío. En sandbox guarda los mensajes en D1 en lugar de enviarlos. */
export class Meta {
  constructor(private env: Env) {}

  private get url() {
    return `https://graph.facebook.com/${this.env.META_API_VERSION}/${this.env.META_PHONE_NUMBER_ID}`;
  }

  async enviar(telefono: string, msj: Saliente): Promise<void> {
    if (this.env.MODO === 'sandbox') {
      await this.env.DB.prepare('INSERT INTO salida_sandbox (telefono, cuerpo, creado) VALUES (?, ?, ?)')
        .bind(telefono, JSON.stringify(msj), Date.now())
        .run();
      return;
    }
    const r = await fetch(`${this.url}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: telefono, ...msj }),
    });
    if (!r.ok) throw new Error(`Meta respondió ${r.status}: ${await r.text()}`);
  }

  /** Marca el mensaje como leído (palomitas azules). */
  async leido(id: string): Promise<void> {
    if (this.env.MODO === 'sandbox') return;
    await fetch(`${this.url}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: id }),
    });
  }

  /** Descarga un archivo enviado por el cliente (comprobante). */
  async descargar(mediaId: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
    if (this.env.MODO === 'sandbox') {
      return { bytes: enc.encode('comprobante de prueba').buffer as ArrayBuffer, mime: 'image/jpeg' };
    }
    const auth = { Authorization: `Bearer ${this.env.META_TOKEN}` };
    const info = await fetch(`https://graph.facebook.com/${this.env.META_API_VERSION}/${mediaId}`, { headers: auth });
    if (!info.ok) throw new Error(`No se pudo leer el archivo ${mediaId}: ${info.status}`);
    const { url, mime_type } = (await info.json()) as { url: string; mime_type: string };
    const archivo = await fetch(url, { headers: auth });
    if (!archivo.ok) throw new Error(`No se pudo descargar el archivo ${mediaId}: ${archivo.status}`);
    return { bytes: await archivo.arrayBuffer(), mime: mime_type };
  }
}

// ---- Constructores de mensajes ----

export const texto = (body: string): Saliente => ({ type: 'text', text: { body, preview_url: true } });

/** Hasta 3 botones; títulos de 20 caracteres como máximo. */
export const botones = (body: string, opciones: [string, string][], pie?: string): Saliente => ({
  type: 'interactive',
  interactive: {
    type: 'button',
    body: { text: body },
    ...(pie ? { footer: { text: pie } } : {}),
    action: { buttons: opciones.slice(0, 3).map(([id, title]) => ({ type: 'reply', reply: { id, title: corta(title, 20) } })) },
  },
});

/** Lista de hasta 10 filas; título de fila 24 caracteres, descripción 72. */
export const lista = (
  body: string,
  boton: string,
  filas: { id: string; titulo: string; descripcion?: string }[],
  encabezado?: string,
): Saliente => ({
  type: 'interactive',
  interactive: {
    type: 'list',
    ...(encabezado ? { header: { type: 'text', text: corta(encabezado, 60) } } : {}),
    body: { text: body },
    action: {
      button: corta(boton, 20),
      sections: [
        {
          title: 'Opciones',
          rows: filas.slice(0, 10).map((f) => ({
            id: f.id,
            title: corta(f.titulo, 24),
            ...(f.descripcion ? { description: corta(f.descripcion, 72) } : {}),
          })),
        },
      ],
    },
  },
});

/** Mensaje de varios productos del catálogo de Meta (hasta 30 productos). */
export const productos = (catalogo: string, ids: string[], encabezado: string, body: string): Saliente => ({
  type: 'interactive',
  interactive: {
    type: 'product_list',
    header: { type: 'text', text: corta(encabezado, 60) },
    body: { text: body },
    action: {
      catalog_id: catalogo,
      sections: [{ title: 'Libros', product_items: ids.slice(0, 30).map((product_retailer_id) => ({ product_retailer_id })) }],
    },
  },
});

export const imagen = (link: string, caption?: string): Saliente => ({ type: 'image', image: { link, ...(caption ? { caption } : {}) } });

/** Plantilla aprobada por Meta, para avisos fuera de la ventana de 24 horas. */
export const plantilla = (nombre: string, idioma: string, parametros: string[]): Saliente => ({
  type: 'template',
  template: {
    name: nombre,
    language: { code: idioma },
    components: [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: t })) }],
  },
});

export function corta(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
