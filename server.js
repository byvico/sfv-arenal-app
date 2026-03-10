// ══════════════════════════════════════════════════════════
// server.js — SFV Backend API
// Node.js + Express + PostgreSQL (Render)
//
// Elimina: localStorage, Firestore, problemas de cache,
//          errores de sincronización, errores de hora
//
// PostgreSQL es la FUENTE DE VERDAD
// ══════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { cleanExpiredSessions } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════════════════════

// CORS — permitir peticiones desde cualquier origen (dashboard en Wix, archivo local, APK)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Session-Token', 'Authorization'],
  exposedHeaders: ['X-Server-Time', 'X-Data-Hash']
}));

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ANTI-CACHÉ — forzar que el navegador nunca use datos viejos
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
    'X-Server-Time': new Date().toISOString()
  });
  next();
});

// Request logging (desarrollo)
app.use((req, res, next) => {
  if (req.method !== 'OPTIONS') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ══════════════════════════════════════════════════════════
// RUTAS
// ══════════════════════════════════════════════════════════
app.use('/auth',      require('./routes/auth'));
app.use('/usuarios',  require('./routes/usuarios'));
app.use('/fotos',     require('./routes/fotos'));
app.use('/control',   require('./routes/control'));
app.use('/proyectos', require('./routes/proyectos'));

// ── Health check ────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'SFV Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth:      'POST /auth/login, POST /auth/logout, GET /auth/validate, POST /auth/viewer',
      usuarios:  'GET/POST /usuarios, GET/PUT/DELETE /usuarios/:id, POST /usuarios/bulk',
      fotos:     'GET/POST /fotos, GET/DELETE /fotos/:id, GET /fotos/count/:item',
      control:   'GET/POST /control, PUT/DELETE /control/:id, GET /control/hash, POST /control/sync',
      proyectos: 'GET/POST /proyectos, GET/PUT/DELETE /proyectos/:id, GET /proyectos/timezones'
    }
  });
});

// ── Hora del servidor (para debug de timezone) ──────────
app.get('/hora', async (req, res) => {
  try {
    const tz = req.query.tz || 'America/Bogota';
    const result = await pool.query(`
      SELECT
        NOW()::text AS utc,
        (NOW() AT TIME ZONE $1)::text AS local,
        $1 AS zona_horaria
    `, [tz]);
    res.json(result.rows[0]);
  } catch (e) {
    res.json({
      utc: new Date().toISOString(),
      error: e.message
    });
  }
});

// ── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada: ' + req.method + ' ' + req.path });
});

// ── Error handler global ────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ══════════════════════════════════════════════════════════
// INICIAR SERVIDOR
// ══════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  SFV Backend API`);
  console.log(`  Puerto: ${PORT}`);
  console.log(`  Hora: ${new Date().toISOString()}`);
  console.log(`══════════════════════════════════════════\n`);

  // Limpiar sesiones expiradas cada hora
  setInterval(cleanExpiredSessions, 60 * 60 * 1000);
  cleanExpiredSessions();
});
