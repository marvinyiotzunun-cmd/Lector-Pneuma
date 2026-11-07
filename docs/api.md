# API del backend de Publicaciones Pneuma

Contrato compartido entre el backend (Cloudflare Worker en `worker/`), la tienda web, el panel editorial, el lector (web y Android) y el Worker de WhatsApp. Si algo cambia, se cambia primero aquí.

- **Plataforma:** Cloudflare Workers (Hono + TypeScript), D1 (base de datos `DB`), R2 (archivos `ARCHIVOS`), Pages para el sitio.
- **Base:** todo vive bajo `/api`. En producción el sitio y la API comparten dominio (`https://pneuma.gt/api/...`) mediante una ruta del Worker, así la cookie de sesión es de primera parte.
- **Formato:** JSON en UTF-8. Fechas ISO 8601 en UTC. Dinero: en la API, números en quetzales con dos decimales (`precio_gtq: 125.5`); en la base, enteros en centavos (`*_centavos`).
- **Errores:** `{"error": {"codigo": "texto_corto", "mensaje": "Texto para mostrar"}}` con el código HTTP que corresponde (400, 401, 403, 404, 409, 429, 500).
- **Esquema:** `worker/migrations/0001_base.sql` (backend, 0001-0099). La ventanilla y los paneles usan `0100+`.

## Autenticación

Sin contraseñas: enlace mágico al correo.

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| POST | `/api/auth/enlace` | público | `{correo, nombre?, destino?}` → envía el enlace (vale 15 min). Responde `{ok:true}` siempre, exista o no la cuenta. Máximo 5 por correo por hora (429). |
| POST | `/api/auth/verificar` | público | `{token, dispositivo?: {id, nombre, plataforma}}` → `{usuario, sesion: {token, expira_en}, destino}`. Pone la cookie `pneuma_sesion` (HttpOnly, Secure, SameSite=Lax, 30 días). La app usa el `token` como `Authorization: Bearer`. Si el dispositivo pasa el límite: 409 `limite_dispositivos` con `{dispositivos:[...]}` y la sesión se crea sin dispositivo. |
| POST | `/api/auth/salir` | sesión | Cierra la sesión actual. |
| GET | `/api/yo` | sesión | `{id, correo, nombre, telefono, rol, dispositivo_id}`. El lector usa `correo` para la marca de agua. |
| PATCH | `/api/yo` | sesión | `{nombre?, telefono?}`. |

El enlace del correo apunta a `{SITIO_URL}/entrar?token=...` (o a `{SITIO_URL}/panel?token=...` si `destino` empieza por `/panel`); esa página llama a `/api/auth/verificar` y luego navega a `destino`. En el 409 de límite de dispositivos la respuesta trae igual `usuario` y `sesion.token`, más `dispositivos` y `limite`.

**Roles:** `lector`, `ministerio`, `editor`, `admin` (columna `usuarios.rol`). Los correos en `ADMIN_CORREOS` (variable del Worker) entran como `admin` la primera vez.

**Para otros módulos del Worker** (`worker/src/lib/sesion.ts`): `usuarioDeSesion(c)`, middleware `requiereSesion` y `requiereRol('editor','admin')`. El usuario queda en `c.get('usuario')` como `{id, correo, nombre, rol}` y el dispositivo en `c.get('dispositivoId')`. Correo: `enviarCorreo(env, {para, asunto, html, texto?})` en `worker/src/lib/correo.ts`.

## Dispositivos

Límite por usuario en `ajustes.limite_dispositivos` (3 por defecto).

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/dispositivos` | Lista `[{id, nombre, plataforma, creado_en, ultimo_uso, actual}]`. |
| POST | `/api/dispositivos` | `{id, nombre, plataforma: "web"|"android"|"ios"}` → registra y liga a la sesión actual. Si ya existe, solo lo liga. Si pasa el límite: 409 `limite_dispositivos` con la lista. |
| DELETE | `/api/dispositivos/:id` | Revoca el dispositivo, sus sesiones y sus licencias sin conexión. |

El `id` lo genera el cliente una vez (UUID guardado en el dispositivo). Las rutas de lectura exigen un dispositivo registrado en la sesión.

## Catálogo (público)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/catalogo` | Libros publicados. Filtros: `?q=`, `?categoria=`, `?formato=impreso|digital`. |
| GET | `/api/catalogo/:slug_o_id` | Ficha de un libro. |
| GET | `/api/planes` | Planes de suscripción activos. |
| GET | `/api/portadas/:libro_id` | Imagen de portada (pública, en caché). |
| GET | `/api/ajustes/publicos` | `{envio_gtq, whatsapp, direccion_recogida, cuentas_bancarias: [{banco, tipo, numero, nombre}], billeteras: [{nombre, numero, instrucciones}], tipo_cambio_usd}` para mostrar envío y datos de pago antes de pedir. |

Cada libro:

```json
{
  "id": "lib_…", "slug": "el-verbo-hecho-carne", "titulo": "…", "autor": "…",
  "ministerio": "…", "sinopsis": "…", "isbn": "…", "paginas": 120, "categoria": "…",
  "portada_url": "https://pneuma.gt/api/portadas/lib_…",
  "ficha_url": "https://pneuma.gt/libros/el-verbo-hecho-carne",
  "impreso": {"precio_gtq": 85, "disponible": true} ,
  "digital": {"formato": "pdf", "precio_compra_gtq": 60, "precio_alquiler_gtq": 25,
              "dias_alquiler": 30, "en_suscripcion": true, "paginas_muestra": 10},
  "tiendas": {"amazon": null, "google_play": null}
}
```

`impreso` o `digital` vienen en `null` si el libro no se ofrece así.

## Acceso a libros digitales

Un usuario puede leer un libro si tiene cualquiera de estos:

1. **Compra** (permanente), **alquiler** (vence a los `dias_alquiler`), **canje** o **cortesía**: fila en `accesos`.
2. **Suscripción individual** activa, o **suscripción de iglesia** activa donde su correo es miembro, y el libro tiene `en_suscripcion = 1`.
3. **Muestra gratuita:** cualquiera con sesión lee las primeras `paginas_muestra` páginas.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/biblioteca` | `[{libro, acceso: {tipo: "compra"|"alquiler"|"canje"|"cortesia"|"suscripcion", vence_en}, progreso: {ubicacion, porcentaje}|null}]` |
| POST | `/api/canjear` | `{codigo}` → `{tipo: "libro"|"plan", libro?, suscripcion?}`. |
| GET | `/api/suscripciones` | Suscripciones propias y de iglesia que me cubren. |
| POST | `/api/iglesias/:id/miembros` | Titular de la iglesia: `{correos: [...]}` agrega miembros hasta `max_miembros`. |
| DELETE | `/api/iglesias/:id/miembros/:correo` | Titular: quita un miembro. |
| GET | `/api/iglesias/:id` | Titular: datos, plan y miembros. |

## Lector protegido

Las obras no se descargan completas: se sirven página por página. Al subir una obra, el panel la convierte en el navegador (PDF a WebP, EPUB a HTML saneado) y guarda en R2:

```
obras/<libro_id>/manifiesto.json
obras/<libro_id>/p/0001.webp   (PDF)   ó   obras/<libro_id>/p/0001.html   (EPUB)
portadas/<libro_id>.webp
comprobantes/<pedido_id>/<archivo>
```

`manifiesto.json`: `{"formato": "pdf"|"epub", "tipo_pagina": "webp"|"html", "total_paginas": 120, "ancho": 1240, "alto": 1754, "indice": [{"etiqueta": "Capítulo 1", "pagina": 3, "nivel": 0}]}`

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/obras/:id/manifiesto` | Manifiesto + `{acceso: {...}|null, paginas_permitidas: N}`. Sin acceso completo, `paginas_permitidas = paginas_muestra`. |
| GET | `/api/obras/:id/paginas/:n` | Una página. Exige sesión y dispositivo. WebP se entrega envuelto en SVG con la marca de agua (correo + huella) dibujada encima; HTML se entrega con la marca de agua y una huella invisible incrustadas. `Cache-Control: no-store`. Límite `ajustes.paginas_por_minuto` (429 `demasiadas_paginas`). Cada página queda en `eventos_lectura` con su `huella`. |
| GET | `/api/obras/:id/progreso` | `{ubicacion, porcentaje}` o `null`. |
| PUT | `/api/obras/:id/progreso` | `{ubicacion, porcentaje}`. |
| GET | `/api/obras/:id/marcadores` | Lista. |
| POST | `/api/obras/:id/marcadores` | `{id?, ubicacion, etiqueta?}`. |
| DELETE | `/api/obras/:id/marcadores/:mid` | Borra. |
| GET | `/api/obras/:id/subrayados` | Lista. |
| POST | `/api/obras/:id/subrayados` | `{id?, ubicacion, texto, nota?, color?}`. |
| PATCH | `/api/obras/:id/subrayados/:sid` | `{nota?, color?}`. |
| DELETE | `/api/obras/:id/subrayados/:sid` | Borra. |

`ubicacion` es libre para el lector (número de página, o página + desplazamiento).

### Lectura sin conexión (app Android)

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/obras/:id/licencia-offline` | `{id_dispositivo, clave_publica}` (RSA-OAEP SHA-256, SPKI en base64, generada y guardada en el almacén seguro del dispositivo). → `{licencia_id, clave_envuelta, vence_en, total_paginas}`. `clave_envuelta` es la clave AES-256-GCM del libro cifrada con esa clave pública (base64). Vence a los `ajustes.dias_licencia_sin_conexion` (14) días; renovar = volver a llamar. Límite `ajustes.obras_sin_conexion_por_dispositivo` (409 `limite_sin_conexion`). Solo con acceso completo (no muestras). |
| GET | `/api/obras/:id/paquete/:n` | Página `n` cifrada: `application/octet-stream` = IV (12 bytes) + texto cifrado AES-GCM. Ya trae la marca de agua. Exige licencia vigente del dispositivo. |
| DELETE | `/api/obras/:id/licencia-offline` | Libera el cupo en este dispositivo. |
| GET | `/api/licencias-offline` | Licencias de este dispositivo. |

## Pedidos y pagos

Métodos: `recurrente` (tarjeta, enlace de pago), `paypal` (enlace de pago), `transferencia` y `billetera` (el cliente sube comprobante; el equipo confirma a mano). En la API de WhatsApp, `tarjeta` = `recurrente`.

Estados: `pendiente` → `en_revision` (subió comprobante) → `pagado` → `enviado` → `entregado`; o `cancelado` / `reembolsado`. Al pasar a `pagado` se entregan los accesos digitales y las suscripciones, y se manda el correo de confirmación.

Item: `{modalidad: "impreso"|"compra"|"alquiler"|"plan", libro_id?, plan_id?, cantidad?}`. El envío (`ajustes.envio_centavos`) se suma si hay impresos.

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| POST | `/api/pedidos` | sesión (o público con `correo` o `telefono`) | `{items, metodo, correo?, nombre?, telefono?, entrega?: {nombre?, direccion, municipio, departamento, referencia?}, iglesia_nombre?, notas?}` → 201 `{pedido: {id, codigo, estado, metodo, subtotal_gtq, envio_gtq, total_gtq, items, entrega, ...}, enlace_pago|null, instrucciones_pago: {texto, cuentas, monto_gtq, referencia}|null}`. Sin `entrega` con impresos = recoger en la oficina, sin envío. Libros digitales y planes exigen correo. Si el total es 0 se marca pagado de una vez. |
| GET | `/api/pedidos` | sesión | Mis pedidos. |
| GET | `/api/pedidos/:id` | dueño | Detalle. `:id` puede ser el id o el código. Sin sesión: `?codigo=PN-000123&correo=…` (vale igual para comprobante y captura de PayPal). |
| POST | `/api/pedidos/:id/comprobante` | dueño | Cuerpo = archivo (`image/*` o `application/pdf`, máx. 8 MB), `?referencia=` opcional. Pasa a `en_revision`. |
| POST | `/api/pedidos/:id/paypal/capturar` | dueño | Después de volver de PayPal (la URL de éxito trae `&pedido=<id>`): captura la orden. PayPal cobra en US$ al `tipo_cambio_usd`. |
| POST | `/api/pagos/recurrente/webhook` | Recurrente | Aviso firmado (Svix). |
| POST | `/api/pagos/paypal/webhook` | PayPal | Aviso verificado con la API de PayPal. |

Cada pedido pagado con tarjeta o PayPal vuelve a `{SITIO_URL}/pedido/<codigo>?estado=exito`.

### Interno (Worker de WhatsApp y otros servicios)

Cabecera `Authorization: Bearer <INTERNAL_TOKEN>`.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/interno/pedidos` | `{canal:"whatsapp", cliente:{telefono, nombre, correo?}, items:[{libro_id, modalidad?, cantidad}], entrega:{direccion, municipio, departamento}|null, metodo_pago:"tarjeta"|"paypal"|"transferencia"|"billetera"}` → `{pedido_id, codigo, total_gtq, envio_gtq, estado, enlace_pago, instrucciones_pago}`. `modalidad` por defecto `impreso`. |
| GET | `/api/interno/pedidos/:id` | Estado del pedido. |
| POST | `/api/interno/pedidos/:id/comprobante` | Cuerpo = bytes del archivo con su `Content-Type`. Pasa a `en_revision`. |

Eventos salientes: cuando un pedido con `canal = "whatsapp"` cambia a `en_revision`, `pagado`, `enviado`, `entregado` o `cancelado`, el backend hace `POST {WHATSAPP_WORKER_URL}/interno/eventos` con el mismo token y `{tipo: "pedido.pagado", pedido_id, codigo, canal, telefono, total_gtq}`.

## Asistente inteligente

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/asistente` | `{mensajes: [{rol: "usuario"|"asistente", texto}]}` (máx. 12) → `{respuesta}`. Responde solo sobre el proceso de publicación, el catálogo, el lector, pagos y envíos, con las preguntas frecuentes de `asistente_faq` y el catálogo publicado. Tope de gasto mensual en `ajustes.asistente_tope_centavos_usd`; al llegar responde 503 `asistente_agotado` y el sitio muestra el contacto de WhatsApp. Límite 20 mensajes por IP por hora. |

## Administración (rol editor o admin)

Del backend (`worker/src/rutas/admin.ts`):

| Método | Ruta | Qué hace |
|---|---|---|
| GET/POST | `/api/admin/libros` | Lista todos (publicados o no) / crea (`titulo` y `autor` obligatorios; genera `slug`). Campos: columnas de `libros` con dinero como `precio_impreso_gtq`, `precio_compra_gtq`, `precio_alquiler_gtq`, booleanos `true/false` y `portada_url` calculado. |
| GET/PATCH/DELETE | `/api/admin/libros/:id` | Ficha / cambia / borra. |
| PUT | `/api/admin/libros/:id/portada` | Cuerpo = imagen. |
| PUT | `/api/admin/libros/:id/manifiesto` | Cuerpo = `manifiesto.json`. Actualiza `total_paginas_digital`. |
| PUT | `/api/admin/libros/:id/paginas/:n` | Cuerpo = página (`image/webp` o `text/html`). |
| GET | `/api/admin/pedidos` | `?estado=&canal=&q=`. |
| GET | `/api/admin/pedidos/:id` | Detalle con items. |
| GET | `/api/admin/pedidos/:id/comprobante` | Descarga el comprobante. |
| POST | `/api/admin/pedidos/:id/estado` | `{estado: "pagado"|"enviado"|"entregado"|"cancelado"|"reembolsado", nota?}`. Confirmar una transferencia = pasar a `pagado`. |
| GET/POST | `/api/admin/planes`, PATCH `/api/admin/planes/:id` | Planes. |
| GET/POST | `/api/admin/codigos` | Lista / crea lote `{libro_id?|plan_id?, cantidad, usos_max?, dias?, vence_en?, lote?, prefijo?}` → códigos. |
| DELETE | `/api/admin/codigos/:codigo` | Anula. |
| GET/POST/PATCH/DELETE | `/api/admin/faq[/:id]` | Preguntas frecuentes del asistente. |
| GET/PATCH | `/api/admin/ajustes` | Ajustes (`{clave: valor}`). Solo admin. |
| GET | `/api/admin/huella/:huella` | Rastrea una filtración: quién, qué libro, qué página, cuándo. |
| GET | `/api/admin/resumen` | Ventas del mes, pedidos por revisar, lectores activos, gasto del asistente. |
| POST | `/api/admin/sitio/reconstruir` | Llama a `PAGES_DEPLOY_HOOK` para regenerar el sitio estático. |

De la ventanilla y paneles (otro módulo del mismo Worker): `/api/ventanilla/*`, `/api/admin/contenidos`, `/api/admin/expedientes`, `/api/admin/ministerios`, `/api/admin/usuarios`, `/api/admin/accesos`, `/api/admin/lecturas`.

## Configuración del Worker

Variables (`wrangler.toml`): `SITIO_URL`, `CORREO_REMITENTE`, `ADMIN_CORREOS`, `WHATSAPP_WORKER_URL`, `CORREO_PROVEEDOR` (`cloudflare`, `resend` o `consola`), `PAYPAL_MODO` (`sandbox` o `live`), `ASISTENTE_MODELO`, `PAGES_DEPLOY_HOOK` (opcional).

Secretos (`wrangler secret put`), los pone Pneuma con sus propias cuentas: `LLAVE_MAESTRA` (32+ bytes aleatorios, firma huellas y deriva claves de libros), `INTERNAL_TOKEN`, `RECURRENTE_PUBLIC_KEY`, `RECURRENTE_SECRET_KEY`, `RECURRENTE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY` (si se usa Resend).

Sin secretos de pago, crear un pedido con tarjeta o PayPal responde 503 `pasarela_no_configurada`; transferencia y billetera funcionan igual.
