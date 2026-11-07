# Lector Pneuma

Lector digital de Publicaciones Pneuma (tipo Kindle): biblioteca personal y lectura de libros EPUB y PDF en web, Android y iPhone.

**Modelo de venta:** los libros se compran en la tienda web (PayPal, tarjeta, Fri, depósito). La app solo muestra y lee los libros que ya están en la biblioteca del usuario; no hay compras dentro de la app.

## Qué incluye esta versión

- Biblioteca con portada, avance de lectura y formato de cada libro.
- Lector EPUB (epub.js): páginas, índice, fondo claro, sepia o noche, tamaño y tipo de letra, marcadores, subrayados y notas.
- Lector PDF (pdf.js): páginas ajustadas a la pantalla, zoom, índice del documento, fondos y marcadores.
- Avance, marcadores y notas sincronizados en Supabase cuando hay sesión; en este dispositivo si no la hay.
- Esquema de Supabase con seguridad por fila (`supabase/migrations/`): perfiles, catálogo, pedidos, biblioteca y datos de lectura. Los archivos de los libros están en un bucket privado y solo se entregan con enlace firmado a quien tiene el libro.

## Uso local

```bash
npm install
npm run dev
```

Sin variables de entorno la app arranca en **modo de demostración** con dos libros de muestra (Reina-Valera 1909, dominio público) generados por `scripts/generar_demo.py`.

Para conectar Supabase, copia `.env.example` a `.env` y completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, y aplica la migración de `supabase/migrations/`.

### Cargar un libro (mientras no exista el panel editorial)

1. Inserta el libro en la tabla `libros` (con `publicado = true`).
2. Sube el archivo al bucket `libros` en la ruta `<id del libro>/<archivo>.epub` y guarda esa ruta en `archivo_ruta`.
3. Un pedido marcado como `pagado` agrega el libro a la biblioteca del comprador automáticamente.

## Próximos pasos

- Panel editorial: subir libros y portadas, precios, aprobar depósitos.
- Tienda web con pagos (PayPal, pasarela de tarjetas, Fri, depósito con comprobante).
- Empaquetado para Play Store y App Store con Capacitor.
- Validar la tipografía propuesta (Fraunces + Inter) y el lockup oficial del nombre del sello.

---
Creado por Tecnoiagt · [www.tecnoiagt.com](https://www.tecnoiagt.com)

## Ventanilla editorial y paneles (`panel.html`)

Segundo punto de entrada del mismo proyecto de Vite. En producción vive en `/panel` y usa la API del Worker (`worker/`).

- **Ministerios** (rol `ministerio`): presentan obras con el manuscrito y los documentos del Manual General Administrativo, reciben un código `PNE-AAAA-NNN` y siguen cada etapa. Reciben un correo en cada cambio.
- **Dirección Editorial** (roles `editor` y `admin`): tablero por etapa con atrasos, lista con filtros, expediente con etapa, estado, dictamen, modalidad de revisión (A a F), notas internas o visibles y documentos. Las etapas (8 por defecto) se editan en el panel.
- **Administración**: libros del catálogo y carga al lector protegido (la conversión corre en el navegador con `src/preparar/`), contenidos y formatos del sitio, ministerios y sus cuentas, usuarios y roles, accesos de cortesía y quién lee qué.

API: `worker/src/ventanilla/` y `worker/src/admin/`, montadas con `montarVentanilla(app)`; esquema en `worker/migrations/0100_ventanilla.sql`; pruebas en `worker/test/ventanilla.test.ts`.

```bash
cd worker && npm install && npm run migrar:local && npm run dev   # API en :8787
npm run dev                                                       # abre http://localhost:5173/panel.html
```

Para entrar en local, pide el enlace con tu correo: con `CORREO_PROVEEDOR = "consola"` el enlace aparece en la consola del Worker. Los correos de `ADMIN_CORREOS` entran como administradores.
