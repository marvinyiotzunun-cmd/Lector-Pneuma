# Backend de Publicaciones Pneuma (Cloudflare Worker)

API para la tienda web, el panel editorial, el lector (web y Android) y los pedidos por WhatsApp. El contrato está en [`../docs/api.md`](../docs/api.md).

- **Cloudflare Workers** con Hono y TypeScript.
- **D1** (`DB`): usuarios, sesiones, catálogo, accesos, pedidos, datos de lectura. Esquema en `migrations/`.
- **R2** (`ARCHIVOS`): páginas de los libros (`obras/<id>/p/0001.webp|html`), portadas y comprobantes. Nada de R2 es público: todo pasa por el Worker.
- **Correo**: Cloudflare Email Service (binding `EMAIL`), Resend, o `consola` en desarrollo.
- **Pagos**: Recurrente (tarjeta) y PayPal con enlace de pago y aviso firmado; transferencia y billetera con comprobante y confirmación manual en el panel.
- **Asistente**: API de Claude con tope de gasto mensual.

## Desarrollo

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars    # y pon una LLAVE_MAESTRA cualquiera
npm run migrar:local
npm run dev                         # http://localhost:8787/api/salud
npm test                            # pruebas en el runtime de Workers (Miniflare)
```

En desarrollo los correos no salen: se imprimen en la consola y quedan en la tabla `correos_enviados`.

## Puesta en marcha con las cuentas de Pneuma

Todo queda a nombre de Publicaciones Pneuma. Los secretos los pone quien administra la cuenta; no se guardan en el repositorio.

1. **Cloudflare.** Cuenta de Pneuma con el dominio `pneuma.gt`. Plan Workers Paid (US$5 al mes, el «Q38.15» de la cotización) para no toparse con los límites del plan gratuito.
2. **Base y archivos.**
   ```bash
   npx wrangler login
   npx wrangler d1 create pneuma          # copia el database_id a wrangler.toml
   npx wrangler r2 bucket create pneuma-archivos
   npm run migrar:remoto
   ```
3. **Variables** en `wrangler.toml`: `SITIO_URL = "https://pneuma.gt"`, `ADMIN_CORREOS` (los correos de la Dirección Editorial), `CORREO_PROVEEDOR = "cloudflare"`, `PAYPAL_MODO = "live"` cuando salga de pruebas. Descomenta la ruta `pneuma.gt/api/*` y el bloque `send_email`.
4. **Secretos:**
   ```bash
   openssl rand -base64 48 | npx wrangler secret put LLAVE_MAESTRA   # no cambiarla después: deriva las claves de los libros
   openssl rand -hex 32   | npx wrangler secret put INTERNAL_TOKEN  # el mismo en el Worker de WhatsApp
   npx wrangler secret put RECURRENTE_PUBLIC_KEY
   npx wrangler secret put RECURRENTE_SECRET_KEY
   npx wrangler secret put RECURRENTE_WEBHOOK_SECRET
   npx wrangler secret put PAYPAL_CLIENT_ID
   npx wrangler secret put PAYPAL_SECRET
   npx wrangler secret put PAYPAL_WEBHOOK_ID
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
5. **Correo.** `npx wrangler email sending enable pneuma.gt` y agregar los registros DNS que indique (SPF, DKIM). El remitente es `CORREO_REMITENTE`.
6. **Recurrente.** En el panel de Recurrente, copiar las llaves pública y secreta y crear el webhook a `https://pneuma.gt/api/pagos/recurrente/webhook` (evento de pago exitoso). Copiar su secreto `whsec_...`.
7. **PayPal.** En developer.paypal.com crear la app (modo Live), copiar Client ID y Secret, y crear un webhook a `https://pneuma.gt/api/pagos/paypal/webhook` con los eventos `CHECKOUT.ORDER.APPROVED` y `PAYMENT.CAPTURE.COMPLETED`. Copiar el Webhook ID. PayPal cobra en dólares al `tipo_cambio_usd` de los ajustes.
8. **Asistente.** Crear una llave en console.anthropic.com con un límite de gasto en la consola, además del tope interno (`ajustes.asistente_tope_centavos_usd`, en centavos de dólar; 1000 = US$10 al mes). El modelo se cambia con `ASISTENTE_MODELO` (`claude-haiku-5-5` es mucho más barato si el tope se queda corto).
9. `npm run deploy`.
10. **Ajustes de Pneuma** (desde el panel, `PATCH /api/admin/ajustes`): `cuentas_bancarias`, `billeteras`, `whatsapp`, `envio_centavos`, `limite_dispositivos`, `tipo_cambio_usd`. Los valores iniciales son marcadores.

## Estructura

```
src/index.ts            rutas, errores, tarea diaria (vence suscripciones, limpia sesiones)
src/env.ts              tipos Env, Usuario, Rol
src/lib/                sesión, correo, cripto, acceso a libros, dispositivos, marca de agua
src/rutas/              auth, catálogo y biblioteca, lector, pedidos y pagos, asistente, admin
src/servicios/pedidos   crear pedido, cambiar estado y entregar lo comprado
src/pagos/              Recurrente y PayPal
migrations/             0001-0099 backend; 0100+ ventanilla y paneles
```

## Protección del contenido

Disuasoria y con rastreo, como dice la cotización: ningún sistema impide fotografiar una pantalla.

- El libro nunca se entrega completo: el Worker sirve una página a la vez, con sesión y dispositivo registrado, `no-store` y un límite de páginas por minuto.
- Cada página lleva el correo del lector y una huella única; las de texto también llevan la huella en caracteres invisibles, que sobrevive al copiar y pegar. `GET /api/admin/huella/:huella` dice quién, qué libro, qué página y cuándo.
- Límite de dispositivos por cuenta (3 por defecto).
- Sin conexión (solo app): cada página se descarga cifrada con AES-GCM; la clave del libro va envuelta con una clave del dispositivo y la licencia vence a los 14 días o antes.

---
Creado por Tecnoiagt · [www.tecnoiagt.com](https://www.tecnoiagt.com)
