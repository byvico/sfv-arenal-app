// ══════════════════════════════════════════════════════════
// sql/migrate.js — Crear tablas en PostgreSQL
// ══════════════════════════════════════════════════════════
require('dotenv').config();
const pool = require('../db');

const SQL = `

-- ══════════════════════════════════════════════════════════
-- 1. PROYECTOS — Configuración de cada proyecto
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS proyectos (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  subtitulo     TEXT,
  municipio     TEXT NOT NULL,
  departamento  TEXT DEFAULT 'Colombia',
  pais          TEXT DEFAULT 'Colombia',
  zona_horaria  TEXT DEFAULT 'America/Bogota',
  fecha_inicio  DATE,
  fecha_instalacion DATE,
  fecha_entrega DATE,
  total_sistemas INTEGER DEFAULT 0,
  meta_diaria   INTEGER DEFAULT 0,
  cuadrillas    JSONB DEFAULT '[]',
  credenciales  JSONB DEFAULT '{}',
  usernames     JSONB DEFAULT '{}',
  config        JSONB DEFAULT '{}',
  is_builtin    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════
-- 2. USUARIOS (beneficiarios de sistemas fotovoltaicos)
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS usuarios (
  id                  SERIAL PRIMARY KEY,
  nombre              TEXT,
  cedula              TEXT,
  telefono            TEXT,
  direccion           TEXT,
  vereda              TEXT,
  proyecto            TEXT REFERENCES proyectos(id) ON DELETE CASCADE,
  cuadrilla           INTEGER,
  item_numero         INTEGER,
  latitud             NUMERIC(10,7),
  longitud            NUMERIC(10,7),
  fecha_instalacion   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_proyecto ON usuarios(proyecto);
CREATE INDEX IF NOT EXISTS idx_usuarios_cuadrilla ON usuarios(proyecto, cuadrilla);
CREATE INDEX IF NOT EXISTS idx_usuarios_cedula ON usuarios(cedula);

-- ══════════════════════════════════════════════════════════
-- 3. CONTROL DIARIO — Registros de avance de instalación
--    (reemplaza ctrlData de localStorage)
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS control_diario (
  id            SERIAL PRIMARY KEY,
  registro_id   TEXT UNIQUE NOT NULL,
  proyecto      TEXT REFERENCES proyectos(id) ON DELETE CASCADE,
  cuadrilla     INTEGER NOT NULL,
  item          TEXT,
  vereda        TEXT,
  estado        TEXT DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Instalando','Instalado','Energizado')),
  fecha         DATE,
  observaciones TEXT,
  nombre        TEXT,
  cedula        TEXT,
  gps_lat       NUMERIC(10,7),
  gps_lng       NUMERIC(10,7),
  gps_acc       INTEGER,
  gps_ts        TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_control_proyecto ON control_diario(proyecto);
CREATE INDEX IF NOT EXISTS idx_control_cuadrilla ON control_diario(proyecto, cuadrilla);
CREATE INDEX IF NOT EXISTS idx_control_estado ON control_diario(proyecto, estado);
CREATE INDEX IF NOT EXISTS idx_control_updated ON control_diario(updated_at DESC);

-- ══════════════════════════════════════════════════════════
-- 4. FOTOS — Fotografías de instalación con georreferenciación
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fotos (
  id            SERIAL PRIMARY KEY,
  usuario_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  control_id    INTEGER REFERENCES control_diario(id) ON DELETE SET NULL,
  item          TEXT,
  slot_idx      INTEGER,
  slot_nombre   TEXT,
  url           TEXT,
  nombre_archivo TEXT,
  tipo          TEXT,
  tamano        INTEGER,
  latitud       NUMERIC(10,7),
  longitud      NUMERIC(10,7),
  cuadrilla     INTEGER,
  proyecto      TEXT REFERENCES proyectos(id) ON DELETE CASCADE,
  timestamp     TIMESTAMPTZ DEFAULT NOW(),
  subido_por    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fotos_proyecto ON fotos(proyecto);
CREATE INDEX IF NOT EXISTS idx_fotos_item ON fotos(proyecto, item);
CREATE INDEX IF NOT EXISTS idx_fotos_control ON fotos(control_id);

-- ══════════════════════════════════════════════════════════
-- 5. SESIONES — Persistencia de login entre recargas
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sesiones (
  id            SERIAL PRIMARY KEY,
  token         TEXT UNIQUE NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('master','cuadrilla','visitor','viewer')),
  cuadrilla     INTEGER,
  nombre        TEXT,
  can_edit      BOOLEAN DEFAULT FALSE,
  proyecto_id   TEXT,
  datos_extra   JSONB DEFAULT '{}',
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sesiones_token ON sesiones(token);
CREATE INDEX IF NOT EXISTS idx_sesiones_expires ON sesiones(expires_at);

-- ══════════════════════════════════════════════════════════
-- 6. SYNC LOG — Para detectar cambios entre dispositivos
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sync_log (
  id            SERIAL PRIMARY KEY,
  proyecto      TEXT REFERENCES proyectos(id) ON DELETE CASCADE,
  tabla         TEXT NOT NULL,
  registro_id   TEXT NOT NULL,
  accion        TEXT NOT NULL CHECK (accion IN ('INSERT','UPDATE','DELETE')),
  timestamp     TIMESTAMPTZ DEFAULT NOW(),
  datos         JSONB
);

CREATE INDEX IF NOT EXISTS idx_sync_proyecto ON sync_log(proyecto, timestamp DESC);

-- ══════════════════════════════════════════════════════════
-- 7. FUNCIÓN: Actualizar updated_at automáticamente
-- ══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para auto-update de updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_usuarios') THEN
    CREATE TRIGGER set_updated_at_usuarios BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_control') THEN
    CREATE TRIGGER set_updated_at_control BEFORE UPDATE ON control_diario
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_proyectos') THEN
    CREATE TRIGGER set_updated_at_proyectos BEFORE UPDATE ON proyectos
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════
-- 8. PROYECTO ARENAL (seed data)
-- ══════════════════════════════════════════════════════════
INSERT INTO proyectos (id, nombre, subtitulo, municipio, departamento, pais, zona_horaria,
  fecha_inicio, fecha_instalacion, fecha_entrega, total_sistemas, cuadrillas, usernames,
  credenciales, is_builtin)
VALUES (
  'arenal_2026',
  'SFV Arenal',
  '267 Sistemas Fotovoltaicos',
  'Arenal',
  'Bolívar',
  'Colombia',
  'America/Bogota',
  '2026-03-10',
  '2026-03-17',
  '2026-06-05',
  267,
  '[{"id":1,"name":"Cuadrilla 1","zone":"Sur Occidente","color":"#2E7D32"},
    {"id":2,"name":"Cuadrilla 2","zone":"Centro Occidente","color":"#1565C0"},
    {"id":3,"name":"Cuadrilla 3","zone":"Centro Norte","color":"#E65100"},
    {"id":4,"name":"Cuadrilla 4","zone":"Norte Oriente","color":"#6A1B9A"}]'::jsonb,
  '{"c1":"arenal_c1","c2":"arenal_c2","c3":"arenal_c3","c4":"arenal_c4"}'::jsonb,
  '{"c1":"C1*arenal_2026","c2":"C2*arenal_2026","c3":"C3*arenal_2026","c4":"C4*arenal_2026"}'::jsonb,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════
-- 9. LIMPIAR SESIONES EXPIRADAS (ejecutar periódicamente)
-- ══════════════════════════════════════════════════════════
DELETE FROM sesiones WHERE expires_at < NOW();

`;

async function migrate() {
  console.log('[Migrate] Ejecutando migración de base de datos...');
  try {
    await pool.query(SQL);
    console.log('[Migrate] ✅ Todas las tablas creadas correctamente');

    // Verificar tablas creadas
    const res = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log('[Migrate] Tablas:', res.rows.map(r => r.table_name).join(', '));

    process.exit(0);
  } catch (e) {
    console.error('[Migrate] ❌ Error:', e.message);
    process.exit(1);
  }
}

migrate();
