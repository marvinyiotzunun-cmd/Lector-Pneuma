# Pedidos por WhatsApp · Publicaciones Pneuma

Worker de Cloudflare que atiende el número de WhatsApp de Pneuma con la **WhatsApp Cloud API** de Meta (punto 10 del Paquete Integral): menú, catálogo de libros impresos, carrito, datos de envío, pago (tarjeta, PayPal o transferencia con comprobante) y avisos automáticos cuando cambia el estado del pedido.

## Cómo funciona

```
Cliente ──WhatsApp──▶ Meta ──webhook──▶ Worker pneuma-whatsapp ──▶ Backend Pneuma (catálogo, pedidos, pagos, R2)
                          ◀──Graph API──        ▲                         │
                                                └──── /interno/eventos ◀──┘  (pagado, enviado, entregado…)
```

| Ruta | Quién la llama | Para qué |
|---|---|---|
| `GET /webhook` | Meta | Verificación del webhook (`META_VERIFY_TOKEN`). |
| `POST /webhook` | Meta | Mensajes entrantes. Se valida la firma `X-Hub-Signature-256` con `META_APP_SECRET` y se responde 200 de inmediato. |
| `POST /interno/eventos` | Backend | Cambio de estado de un pedido de canal `whatsapp`. Requiere `Authorization: Bearer INTERNAL_TOKEN`. |
| `GET /hola?t=texto` | Sitio, QR impresos | Redirige a `wa.me/<número>` con un mensaje inicial. |
| `GET /salud` | Monitoreo | Estado y modo. |
| `POST /sandbox/simular` | Pruebas | Solo en `MODO=sandbox`: simula un cliente y devuelve lo que el bot respondería. |

El contrato con el backend está en `docs/api.md` de la rama del backend (`GET /api/catalogo`, `POST /api/interno/pedidos`, `POST /api/interno/pedidos/:id/comprobante`).

### Conversación

1. Saludo y menú: *Comprar libros*, *Mis pedidos*, *Publicar un libro*, *Hablar con alguien*.
2. Catálogo: lista de 9 libros por página, o el catálogo nativo de Meta si `META_CATALOG_ID` está lleno (el cliente arma el carrito dentro de WhatsApp y lo envía).
3. Ficha del libro con portada, precio y enlace al sitio; *Agregar al pedido*.
4. Carrito → *Envío a domicilio* (nombre, dirección, municipio, departamento) o *Recoger en Pneuma*.
5. Pago: tarjeta o PayPal (enlace del backend) o transferencia (datos bancarios y foto del comprobante, que se sube al backend para que el equipo lo apruebe en el panel).
6. Avisos automáticos: comprobante en revisión, pago confirmado, enviado, entregado, cancelado. Dentro de las 24 h desde el último mensaje del cliente se envía texto libre; después, la plantilla `pedido_actualizado`.
7. *Hablar con alguien*, o un mensaje del equipo enviado desde la app, silencia al bot 12 horas para que el equipo responda desde la app de WhatsApp Business (coexistencia). El cliente vuelve al bot escribiendo *menú*.

Los textos están en `src/textos.ts`.

## Desarrollo

```bash
npm install
npm test                 # pruebas del flujo completo y del webhook
npm run db:local         # crea las tablas en la D1 local
cp .dev.vars.example .dev.vars
npm run dev              # MODO=sandbox: no llama a Meta ni al backend
curl localhost:8787/sandbox/simular -H 'content-type: application/json' -d '{"de":"50211112222","nombre":"Ana","texto":"hola"}'
```

## Puesta en producción

### Antes: Tecnoiagt como proveedor de tecnología de Meta (decidido el 2026-11-07)

La coexistencia solo se activa por *registro insertado* (Embedded Signup), así que la app de Meta es de Tecnoiagt y Pneuma conecta su número desde ella. Sirve igual para otros clientes.

1. Verificar el portafolio comercial de **Tecnoiagt** en business.facebook.com (documentos de la empresa, dominio tecnoia.gt y correo del dominio).
2. En developers.facebook.com, crear la app de tipo *Empresa* con el producto WhatsApp y completar la incorporación como *proveedor de tecnología* (Tech Provider).
3. Pedir en la *revisión de la app* los permisos avanzados `whatsapp_business_messaging` y `whatsapp_business_management`, con un video del flujo de pedidos en sandbox.
4. Configurar el registro insertado con la opción de incorporar usuarios de la app WhatsApp Business (coexistencia) y la URL del sitio de Tecnoiagt.
5. Con Pneuma: abrir el enlace de registro insertado, elegir «conectar mi app WhatsApp Business», escanear el QR desde la app de Pneuma y aceptar compartir el historial. Guardar el `phone_number_id` y el id de la cuenta (WABA) que devuelve.
6. Suscribir la app a la WABA de Pneuma (`POST /<WABA_ID>/subscribed_apps`) y generar el token de usuario del sistema con acceso a esa WABA.

### Después

1. Crear un **usuario del sistema** con permiso `whatsapp_business_messaging` y `whatsapp_business_management` y generar un token permanente.
2. Crear la base: `npx wrangler d1 create pneuma-whatsapp`, poner el id en `wrangler.toml`, `npm run db:remota`.
3. Variables en `wrangler.toml`: `MODO="produccion"`, `META_PHONE_NUMBER_ID`, `BACKEND_URL`, `SITIO_URL`, `NUMERO_ATENCION`, y `META_CATALOG_ID` si se usa el catálogo de Meta.
4. Secretos: `npx wrangler secret put META_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `INTERNAL_TOKEN` (el mismo que usa el backend).
5. `npm run deploy`. En la app de Meta, *WhatsApp → Configuración → Webhook*: URL `https://<worker>/webhook`, token de verificación = `META_VERIFY_TOKEN`, suscribir los campos `messages` y `smb_message_echoes` (este último avisa cuando el equipo escribe desde la app, y el bot se aparta 12 horas de ese chat).
6. En el backend, `WHATSAPP_WORKER_URL=https://<worker>`.
7. Plantilla de utilidad para avisos fuera de 24 h (Administrador de WhatsApp → Plantillas):
   - Nombre `pedido_actualizado`, categoría **Utilidad**, idioma español.
   - Cuerpo: `Hola, le escribimos de Publicaciones Pneuma. Su pedido {{1}} está: {{2}}. Si tiene preguntas, responda a este mensaje.`
   - Ejemplos: `PN-000123`, `enviado`.
8. Catálogo de Meta (opcional): en el Administrador de ventas, crear el catálogo y usar como *ID de contenido* (retailer_id) el `id` de cada libro del backend; conectarlo al número.

## Costos de Meta

Las respuestas dentro de las 24 horas desde que escribe el cliente no se cobran, y las plantillas de utilidad enviadas dentro de esa ventana tampoco. Solo se cobran las plantillas enviadas fuera de la ventana (avisos de envío o entrega días después), según la tarifa de Meta para Guatemala.

---
Creado por Tecnoiagt · [www.tecnoiagt.com](https://www.tecnoiagt.com)
