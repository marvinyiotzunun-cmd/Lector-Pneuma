# Sitio web y tienda de Publicaciones Pneuma

Sitio institucional con catálogo y tienda de libros impresos (envío a domicilio o recogida en oficina). Astro estático, publicado en Cloudflare Pages. La API vive en el mismo dominio bajo `/api` (Worker del backend, contrato en `docs/api.md`).

## Páginas

| Ruta | Qué es |
|---|---|
| `/` | Inicio: portada, cifras, novedades, servicios, las 8 etapas, contacto |
| `/quienes-somos` | Texto editable (`contenidos.quienes-somos`) |
| `/proceso` | Las 8 etapas (`GET /api/proceso/etapas`), enlaces a la ventanilla (`/panel#/ventanilla`) |
| `/catalogo` | Todos los libros con búsqueda y filtro por tema |
| `/libros/<slug>` | Ficha: autor, ministerio, sinopsis, ISBN, precio, carrito, digital, Amazon y Google Play, compartir por WhatsApp y redes, datos estructurados `Book` |
| `/formatos` | Formatos oficiales descargables (`GET /api/formatos`) |
| `/contacto` | WhatsApp, correo, dirección, formulario que abre WhatsApp, QR |
| `/carrito` | Carrito y pago: `POST /api/pedidos` (Recurrente, PayPal, transferencia, billetera). Sin API, envía el pedido por WhatsApp |
| `/pedido/<codigo>` | Estado del pedido, datos para pagar, subida de comprobante y captura de PayPal al volver |
| `/whatsapp` | QR imprimible |
| `/entrar` | Enlace mágico del correo: pasa al lector con el `?token=` |
| `/sitemap.xml`, `/robots.txt`, `/.well-known/assetlinks.json` | SEO y App Links de Android |

El asistente inteligente (botón flotante) llama a `POST /api/asistente`; si la API no responde usa preguntas frecuentes locales y, si se agota, ofrece WhatsApp.

## Datos

Al construir, si `PNEUMA_API_URL` está definido, el sitio lee `/api/catalogo`, `/api/contenidos/<clave>`, `/api/proceso/etapas` y `/api/formatos`. Si no, usa los datos de ejemplo de `src/datos/` (se muestra un aviso arriba). Cuando el panel publica cambios llama al deploy hook de Pages (`PAGES_DEPLOY_HOOK`) y el sitio se reconstruye.

## Uso

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # genera dist/
```

Cloudflare Pages: directorio raíz `sitio`, comando `npm run build`, salida `dist`. Variables en `.env.example`.

## Pendiente de Pneuma

Número de WhatsApp Business, horario, redes, datos de los 41 libros (portada, autor, ministerio, sinopsis, ISBN, precio), costo de envío, cuentas bancarias, textos de Quiénes somos y los formatos oficiales definitivos. La huella del certificado de Android va en `public/.well-known/assetlinks.json`.

---
Sitio desarrollado por Tecnoiagt · [www.tecnoiagt.com](https://www.tecnoiagt.com)
