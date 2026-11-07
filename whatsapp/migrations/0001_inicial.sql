-- Estado de la conversación de cada cliente (una fila por número).
CREATE TABLE IF NOT EXISTS sesiones (
  telefono       TEXT PRIMARY KEY,
  nombre         TEXT,
  estado         TEXT NOT NULL DEFAULT 'inicio',
  datos          TEXT NOT NULL DEFAULT '{}',   -- JSON: carrito, entrega, pedido en curso
  ultima_entrada INTEGER NOT NULL DEFAULT 0,   -- epoch ms del último mensaje del cliente (ventana de 24 h)
  humano_hasta   INTEGER NOT NULL DEFAULT 0,   -- si > ahora, el bot calla y atiende una persona
  actualizado    INTEGER NOT NULL DEFAULT 0
);

-- Meta reintenta los webhooks: guardamos el id de cada mensaje ya procesado.
CREATE TABLE IF NOT EXISTS mensajes_procesados (
  id       TEXT PRIMARY KEY,
  recibido INTEGER NOT NULL
);

-- Pedidos hechos por WhatsApp (copia local para "Mis pedidos" y avisos).
CREATE TABLE IF NOT EXISTS pedidos (
  pedido_id  TEXT PRIMARY KEY,
  codigo     TEXT NOT NULL,
  telefono   TEXT NOT NULL,
  total_gtq  REAL NOT NULL,
  estado     TEXT NOT NULL,
  metodo     TEXT NOT NULL,
  resumen    TEXT NOT NULL,
  creado     INTEGER NOT NULL,
  actualizado INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pedidos_telefono ON pedidos(telefono, creado DESC);

-- Solo en modo sandbox: mensajes que el bot habría enviado a Meta.
CREATE TABLE IF NOT EXISTS salida_sandbox (
  n        INTEGER PRIMARY KEY AUTOINCREMENT,
  telefono TEXT NOT NULL,
  cuerpo   TEXT NOT NULL,
  creado   INTEGER NOT NULL
);
