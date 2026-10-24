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
- Identidad visual de Publicaciones Pneuma (los colores actuales son provisionales).

---
Creado por Tecnoiagt · [www.tecnoiagt.com](https://www.tecnoiagt.com)
