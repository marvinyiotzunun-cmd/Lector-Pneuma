-- Ventanilla digital de publicación y contenidos del sitio (Publicaciones Pneuma).
-- Depende de la migración base del backend (usuarios, libros, accesos...).

-- ---------- Ministerios y sus cuentas ----------
CREATE TABLE ministerios (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  siglas TEXT,
  contacto_nombre TEXT,
  contacto_correo TEXT,
  contacto_telefono TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Cada cuenta de rol "ministerio" pertenece a uno o más ministerios.
CREATE TABLE ministerio_miembros (
  ministerio_id TEXT NOT NULL REFERENCES ministerios (id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  cargo TEXT,
  agregado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (ministerio_id, usuario_id)
);
CREATE INDEX ministerio_miembros_usuario ON ministerio_miembros (usuario_id);

-- ---------- Las ocho etapas del ciclo de una obra (editables desde el panel) ----------
CREATE TABLE etapas_editoriales (
  numero INTEGER PRIMARY KEY CHECK (numero BETWEEN 1 AND 8),
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  dias_estimados INTEGER
);
INSERT INTO etapas_editoriales (numero, nombre, descripcion, dias_estimados) VALUES
  (1, 'Solicitud recibida', 'El ministerio envió la solicitud con el manuscrito y los documentos.', 3),
  (2, 'Revisión de admisión', 'La Dirección Editorial revisa que la solicitud esté completa y cumpla las normas.', 7),
  (3, 'Dictamen de la Junta Editorial', 'La Junta Editorial evalúa la obra y emite su dictamen.', 30),
  (4, 'Corrección de estilo', 'Corrección ortográfica, gramatical y de estilo del texto.', 21),
  (5, 'Diseño y diagramación', 'Diseño de portada y diagramación de interiores.', 21),
  (6, 'Pruebas y aprobación del autor', 'El autor y el ministerio revisan las pruebas y dan su aprobación.', 10),
  (7, 'ISBN e impresión', 'Registro de ISBN, archivos finales e impresión o versión digital.', 21),
  (8, 'Publicada', 'La obra está publicada y disponible en el catálogo.', NULL);

-- ---------- Expedientes ----------
-- Código automático: PNE-<año>-<correlativo de 4 dígitos>, p. ej. PNE-2026-0007.
CREATE TABLE expediente_secuencia (
  anio INTEGER PRIMARY KEY,
  ultimo INTEGER NOT NULL
);

CREATE TABLE expedientes (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  ministerio_id TEXT NOT NULL REFERENCES ministerios (id),
  solicitante_id TEXT NOT NULL REFERENCES usuarios (id),
  titulo TEXT NOT NULL,
  subtitulo TEXT,
  autores TEXT NOT NULL,                -- nombres tal como irán en la portada
  genero TEXT,                          -- estudio bíblico, devocional, testimonio, doctrina...
  publico TEXT,                         -- a quién va dirigida
  sinopsis TEXT NOT NULL,
  paginas_aprox INTEGER,
  modalidad TEXT NOT NULL DEFAULT 'impreso' CHECK (modalidad IN ('impreso', 'digital', 'ambos')),
  tiraje_estimado INTEGER,
  revision TEXT,                        -- modalidad de revisión que asigna la Dirección Editorial
  etapa INTEGER NOT NULL DEFAULT 1 REFERENCES etapas_editoriales (numero),
  estado TEXT NOT NULL DEFAULT 'en_curso'
    CHECK (estado IN ('en_curso', 'requiere_cambios', 'en_pausa', 'rechazado', 'publicado')),
  responsable_id TEXT REFERENCES usuarios (id),
  libro_id TEXT REFERENCES libros (id), -- la obra publicada en el catálogo, al terminar
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX expedientes_ministerio ON expedientes (ministerio_id);
CREATE INDEX expedientes_etapa ON expedientes (etapa, estado);

-- Cada cambio de etapa o de estado, y cada nota, queda en el historial.
CREATE TABLE expediente_historial (
  id TEXT PRIMARY KEY,
  expediente_id TEXT NOT NULL REFERENCES expedientes (id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('creado', 'etapa', 'estado', 'nota', 'documento')),
  etapa_anterior INTEGER,
  etapa_nueva INTEGER,
  estado_nuevo TEXT,
  nota TEXT,
  visible_ministerio INTEGER NOT NULL DEFAULT 1,   -- 0 = nota interna de la Dirección Editorial
  autor_id TEXT REFERENCES usuarios (id),
  correo_enviado INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX expediente_historial_exp ON expediente_historial (expediente_id, creado_en);

-- Manuscrito y documentos, guardados en R2 bajo expedientes/<id>/<doc id>-<nombre>.
CREATE TABLE expediente_documentos (
  id TEXT PRIMARY KEY,
  expediente_id TEXT NOT NULL REFERENCES expedientes (id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('manuscrito', 'carta_autorizacion', 'creditos', 'dictamen', 'portada', 'pruebas', 'otro')),
  nombre TEXT NOT NULL,
  ruta TEXT NOT NULL,
  tipo_mime TEXT,
  tamano INTEGER NOT NULL DEFAULT 0,
  subido_por TEXT REFERENCES usuarios (id),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX expediente_documentos_exp ON expediente_documentos (expediente_id);

-- ---------- Contenidos editables del sitio ----------
CREATE TABLE contenidos_sitio (
  clave TEXT PRIMARY KEY,               -- quienes-somos, proceso-publicacion, contacto...
  titulo TEXT NOT NULL,
  cuerpo TEXT NOT NULL DEFAULT '',      -- Markdown
  publicado INTEGER NOT NULL DEFAULT 1,
  actualizado_por TEXT REFERENCES usuarios (id),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO contenidos_sitio (clave, titulo, cuerpo) VALUES
  ('quienes-somos', 'Quiénes somos', 'Publicaciones Pneuma es el sello editorial de la Iglesia de Dios Evangelio Completo de Guatemala.'),
  ('proceso-publicacion', 'Proceso de publicación', 'Cada obra recorre ocho etapas, desde la solicitud del ministerio hasta su publicación. Presente su solicitud en la ventanilla digital y siga su expediente en línea.'),
  ('contacto', 'Contacto', '7a. avenida 32-31, zona 11, Las Charcas, Guatemala · publicacionespneuma@gmail.com');

-- Formatos oficiales que se descargan desde el sitio (Dictamen, Carta de Autorización, Créditos...).
CREATE TABLE formatos_oficiales (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  ruta TEXT NOT NULL,
  nombre_archivo TEXT NOT NULL,
  tipo_mime TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  publicado INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Correo(s) de la Dirección Editorial que reciben el aviso de cada solicitud nueva (separados por coma).
INSERT OR IGNORE INTO ajustes (clave, valor) VALUES ('correo_editorial', 'publicacionespneuma@gmail.com');
