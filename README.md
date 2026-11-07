# Lector Pneuma

Lector digital protegido de Publicaciones Pneuma (tipo Kindle) para la web y Android. Cubre las partidas 6, 8 y 9 del Paquete Integral.

**Modelo de venta:** los libros se compran en la tienda web (PayPal, tarjeta, Fri, depósito). La app solo lee los libros que ya están en la biblioteca del lector; no hay compras dentro de la app.

## Arquitectura

- Este repositorio es el **cliente** (React + Vite). El servidor es un Worker de Cloudflare con D1 y R2; su contrato está en `docs/api.md` del repositorio del backend.
- El libro nunca se entrega completo. `src/preparar/` convierte cada EPUB en páginas HTML saneadas y cada PDF en páginas WebP, y genera `manifiesto.json`. Todo eso se guarda en R2 bajo `obras/<id>/`.
- El servidor entrega una página a la vez, ya con la marca de agua del correo del lector, y solo si el lector tiene acceso (compra, alquiler, suscripción, canje, cortesía o muestra).

## Qué incluye

- Entrada con enlace al correo, sin contraseña, y límite de dispositivos por cuenta (pantalla «Mis dispositivos»).
- Biblioteca con tipo de acceso, avance y vencimiento del alquiler.
- Lector página por página: índice, fondo claro, sepia o noche, tamaño y tipo de letra, marcadores, subrayados y notas sincronizados.
- Muestras gratis: al terminar las páginas permitidas aparece «Aquí termina la muestra».
- Protección por capas: marca de agua con el correo, copia limitada a 300 caracteres con atribución, sin menú contextual, sin impresión, PDF dibujado en canvas y solo dos páginas en memoria.
- Lectura sin conexión (app): cada dispositivo crea un par de claves RSA que no se puede exportar; la clave del libro llega envuelta para ese dispositivo y las páginas se guardan cifradas con AES-GCM. El permiso dura 14 días y se renueva solo al tener internet. Detecta si se atrasa el reloj.
- App Android (Capacitor 8): bloqueo de capturas y grabación de pantalla (`FLAG_SECURE`), sin respaldo de datos en la nube, y App Links para que el enlace del correo (`https://pneuma.gt/entrar`) abra la app.

## Uso local

```bash
npm install
npm run dev          # modo demostración, sin backend
npm run build        # web de producción (API en el mismo dominio)
npm run build:app    # web para la app y copia a android/
```

El modo demostración usa dos libros de muestra (Reina-Valera 1909, dominio público) generados por `scripts/generar_demo.py`, y simula en el navegador lo que hará el servidor.

## App Android

El flujo `.github/workflows/android.yml` compila un APK de prueba en cada PR. Para el AAB firmado de Google Play agrega estos secretos al repositorio: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`.

El sitio `pneuma.gt` debe publicar `/.well-known/assetlinks.json` con el paquete `gt.pneuma.lector` y la huella del certificado de firma.

## Pendiente

- Cuenta de desarrollador de Google Play a nombre de Pneuma.
- Validar la tipografía propuesta (Fraunces + Inter) y el lockup oficial del sello.

---
Creado por Tecnoiagt · [www.tecnoiagt.com](https://www.tecnoiagt.com)
