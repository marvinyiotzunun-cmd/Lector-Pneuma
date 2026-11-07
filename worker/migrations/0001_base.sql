-- Esquema base del backend de Publicaciones Pneuma (Cloudflare D1 / SQLite).
-- Migraciones 0001-0099: backend (este hilo). 0100+: ventanilla y paneles.
-- Fechas en texto ISO 8601 UTC. Dinero en centavos de quetzal (enteros).

PRAGMA foreign_keys = ON;

-- ---------- Ajustes generales (clave/valor) ----------
CREATE TABLE ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT INTO ajustes (clave, valor) VALUES
  ('limite_dispositivos', '3'),
  ('dias_licencia_sin_conexion', '14'),
  ('obras_sin_conexion_por_dispositivo', '5'),
  ('paginas_por_minuto', '40'),
  ('envio_centavos', '3500'),
  ('asistente_tope_centavos_usd', '1000'),
  ('datos_transferencia', 'Banrural · Cuenta monetaria en quetzales · (pendiente de que Pneuma indique la cuenta)');

-- ---------- Usuarios y acceso ----------
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  correo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre TEXT,
  telefono TEXT,
  rol TEXT NOT NULL DEFAULT 'lector' CHECK (rol IN ('lector', 'ministerio', 'editor', 'admin')),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ultimo_ingreso TEXT
);

-- Enlace mágico: solo se guarda el hash del token.
CREATE TABLE enlaces_acceso (
  token_hash TEXT PRIMARY KEY,
  correo TEXT NOT NULL COLLATE NOCASE,
  destino TEXT,                       -- ruta a la que vuelve el usuario después de entrar
  expira_en TEXT NOT NULL,
  usado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX enlaces_correo ON enlaces_acceso (correo, creado_en);

CREATE TABLE dispositivos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  nombre TEXT NOT NULL DEFAULT 'Dispositivo',
  plataforma TEXT NOT NULL DEFAULT 'web' CHECK (plataforma IN ('web', 'android', 'ios')),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ultimo_uso TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revocado_en TEXT
);
CREATE INDEX dispositivos_usuario ON dispositivos (usuario_id);

CREATE TABLE sesiones (
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  dispositivo_id TEXT REFERENCES dispositivos (id) ON DELETE CASCADE,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expira_en TEXT NOT NULL,
  ultimo_uso TEXT
);
CREATE INDEX sesiones_usuario ON sesiones (usuario_id);

-- ---------- Catálogo ----------
-- Un libro puede venderse impreso (envío a domicilio), digital (lector protegido) o ambos.
CREATE TABLE libros (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  autor TEXT NOT NULL,
  ministerio TEXT,
  sinopsis TEXT,
  isbn TEXT,
  paginas INTEGER,
  portada_clave TEXT,                 -- clave en R2: portadas/<id>.webp (se sirve pública)
  color TEXT,
  categoria TEXT,
  -- Impreso
  impreso INTEGER NOT NULL DEFAULT 0,
  precio_impreso_centavos INTEGER CHECK (precio_impreso_centavos >= 0),
  existencias INTEGER,                -- NULL = sin control de existencias
  -- Digital
  formato_digital TEXT CHECK (formato_digital IN ('epub', 'pdf')),
  digital_activo INTEGER NOT NULL DEFAULT 0,
  precio_compra_centavos INTEGER CHECK (precio_compra_centavos >= 0),
  precio_alquiler_centavos INTEGER CHECK (precio_alquiler_centavos >= 0),
  dias_alquiler INTEGER NOT NULL DEFAULT 30,
  en_suscripcion INTEGER NOT NULL DEFAULT 1,
  paginas_muestra INTEGER NOT NULL DEFAULT 0,   -- primeras N páginas/secciones gratis
  total_paginas_digital INTEGER,      -- lo llena el proceso de carga (manifiesto en R2)
  -- Tiendas externas
  url_amazon TEXT,
  url_google_play TEXT,
  publicado INTEGER NOT NULL DEFAULT 0,
  orden INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX libros_publicado ON libros (publicado, orden);

-- ---------- Suscripciones ----------
CREATE TABLE planes (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('individual', 'iglesia')),
  precio_centavos INTEGER NOT NULL CHECK (precio_centavos >= 0),
  dias INTEGER NOT NULL DEFAULT 30,
  max_miembros INTEGER NOT NULL DEFAULT 1,
  descripcion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE iglesias (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  titular_id TEXT NOT NULL REFERENCES usuarios (id),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Miembros por correo: el acceso se activa cuando esa persona entra con ese correo.
CREATE TABLE iglesia_miembros (
  iglesia_id TEXT NOT NULL REFERENCES iglesias (id) ON DELETE CASCADE,
  correo TEXT NOT NULL COLLATE NOCASE,
  agregado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (iglesia_id, correo)
);
CREATE INDEX iglesia_miembros_correo ON iglesia_miembros (correo);

CREATE TABLE suscripciones (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES planes (id),
  usuario_id TEXT REFERENCES usuarios (id),   -- individual
  iglesia_id TEXT REFERENCES iglesias (id),   -- por iglesia
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'vencida', 'cancelada')),
  inicia_en TEXT NOT NULL,
  vence_en TEXT NOT NULL,
  pedido_id TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (usuario_id IS NOT NULL OR iglesia_id IS NOT NULL)
);
CREATE INDEX suscripciones_usuario ON suscripciones (usuario_id);
CREATE INDEX suscripciones_iglesia ON suscripciones (iglesia_id);

-- ---------- Accesos a libros digitales (la "biblioteca") ----------
-- compra: permanente; alquiler: vence; canje/cortesia: según el código o el editor.
-- Las suscripciones dan acceso sin fila aquí (se calcula al vuelo).
CREATE TABLE accesos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  libro_id TEXT NOT NULL REFERENCES libros (id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('compra', 'alquiler', 'canje', 'cortesia')),
  vence_en TEXT,                      -- NULL = permanente
  pedido_id TEXT,
  codigo TEXT,
  revocado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX accesos_usuario ON accesos (usuario_id, libro_id);

CREATE TABLE codigos_canje (
  codigo TEXT PRIMARY KEY COLLATE NOCASE,
  libro_id TEXT REFERENCES libros (id),     -- da acceso a un libro...
  plan_id TEXT REFERENCES planes (id),      -- ...o a una suscripción individual
  dias INTEGER,                              -- NULL = permanente (libro) / dias del plan
  usos_max INTEGER NOT NULL DEFAULT 1,
  usos INTEGER NOT NULL DEFAULT 0,
  vence_en TEXT,
  lote TEXT,
  nota TEXT,
  creado_por TEXT REFERENCES usuarios (id),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (libro_id IS NOT NULL OR plan_id IS NOT NULL)
);

CREATE TABLE canjes (
  codigo TEXT NOT NULL REFERENCES codigos_canje (codigo),
  usuario_id TEXT NOT NULL REFERENCES usuarios (id),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (codigo, usuario_id)
);

-- ---------- Pedidos y pagos ----------
CREATE TABLE contadores (
  nombre TEXT PRIMARY KEY,
  valor INTEGER NOT NULL
);
INSERT INTO contadores (nombre, valor) VALUES ('pedidos', 0);

CREATE TABLE pedidos (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,              -- PN-000123
  usuario_id TEXT REFERENCES usuarios (id),
  correo TEXT COLLATE NOCASE,
  nombre TEXT,
  telefono TEXT,
  canal TEXT NOT NULL DEFAULT 'web' CHECK (canal IN ('web', 'whatsapp', 'admin')),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'en_revision', 'pagado', 'enviado', 'entregado', 'cancelado', 'reembolsado')),
  metodo TEXT NOT NULL CHECK (metodo IN ('recurrente', 'paypal', 'transferencia', 'billetera', 'gratis')),
  subtotal_centavos INTEGER NOT NULL,
  envio_centavos INTEGER NOT NULL DEFAULT 0,
  total_centavos INTEGER NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'GTQ',
  entrega TEXT,                              -- JSON {direccion, municipio, departamento, referencia}
  proveedor_id TEXT,                         -- id del checkout de Recurrente u orden de PayPal
  enlace_pago TEXT,
  referencia TEXT,                           -- no. de boleta o transacción que reporta el cliente
  comprobante_clave TEXT,                    -- R2: comprobantes/<pedido_id>/<archivo>
  notas TEXT,
  confirmado_por TEXT REFERENCES usuarios (id),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  pagado_en TEXT
);
CREATE INDEX pedidos_usuario ON pedidos (usuario_id);
CREATE INDEX pedidos_estado ON pedidos (estado, creado_en);
CREATE INDEX pedidos_proveedor ON pedidos (proveedor_id);

CREATE TABLE pedido_items (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  modalidad TEXT NOT NULL CHECK (modalidad IN ('impreso', 'compra', 'alquiler', 'plan')),
  libro_id TEXT REFERENCES libros (id),
  plan_id TEXT REFERENCES planes (id),
  descripcion TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario_centavos INTEGER NOT NULL
);
CREATE INDEX pedido_items_pedido ON pedido_items (pedido_id);

-- Registro de cada aviso recibido de las pasarelas (idempotencia y auditoría).
CREATE TABLE pagos_eventos (
  id TEXT PRIMARY KEY,                       -- id del evento del proveedor
  proveedor TEXT NOT NULL,
  tipo TEXT NOT NULL,
  pedido_id TEXT,
  cuerpo TEXT NOT NULL,
  recibido_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------- Datos de lectura ----------
CREATE TABLE progreso_lectura (
  usuario_id TEXT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  libro_id TEXT NOT NULL REFERENCES libros (id) ON DELETE CASCADE,
  ubicacion TEXT NOT NULL,
  porcentaje REAL NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (usuario_id, libro_id)
);

CREATE TABLE marcadores (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  libro_id TEXT NOT NULL REFERENCES libros (id) ON DELETE CASCADE,
  ubicacion TEXT NOT NULL,
  etiqueta TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX marcadores_usuario ON marcadores (usuario_id, libro_id);

CREATE TABLE subrayados (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  libro_id TEXT NOT NULL REFERENCES libros (id) ON DELETE CASCADE,
  ubicacion TEXT NOT NULL,
  texto TEXT NOT NULL,
  nota TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'amarillo',
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX subrayados_usuario ON subrayados (usuario_id, libro_id);

-- Rastreo: cada página servida (para límite de copiado masivo y para identificar filtraciones).
CREATE TABLE eventos_lectura (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT NOT NULL,
  dispositivo_id TEXT,
  libro_id TEXT NOT NULL,
  pagina INTEGER NOT NULL,
  huella TEXT NOT NULL,                      -- código corto incrustado en la marca de agua
  ip TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX eventos_lectura_usuario ON eventos_lectura (usuario_id, creado_en);
CREATE INDEX eventos_lectura_huella ON eventos_lectura (huella);

-- Lectura sin conexión: permiso por dispositivo y libro, renovable.
CREATE TABLE licencias_sin_conexion (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  dispositivo_id TEXT NOT NULL REFERENCES dispositivos (id) ON DELETE CASCADE,
  libro_id TEXT NOT NULL REFERENCES libros (id) ON DELETE CASCADE,
  emitida_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  vence_en TEXT NOT NULL,
  revocada_en TEXT,
  UNIQUE (dispositivo_id, libro_id)
);

-- ---------- Correo ----------
CREATE TABLE correos_enviados (
  id TEXT PRIMARY KEY,
  para TEXT NOT NULL,
  asunto TEXT NOT NULL,
  plantilla TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('enviado', 'fallido', 'simulado')),
  error TEXT,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------- Asistente inteligente ----------
CREATE TABLE asistente_faq (
  id TEXT PRIMARY KEY,
  pregunta TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  tema TEXT NOT NULL DEFAULT 'general',      -- general, publicacion, lector, pagos, envios
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Gasto mensual del asistente (tope en ajustes.asistente_tope_centavos_usd).
CREATE TABLE asistente_uso (
  mes TEXT PRIMARY KEY,                      -- 2026-11
  consultas INTEGER NOT NULL DEFAULT 0,
  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_salida INTEGER NOT NULL DEFAULT 0,
  costo_microdolares INTEGER NOT NULL DEFAULT 0
);
