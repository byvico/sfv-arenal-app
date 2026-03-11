// ══════════════════════════════════════════════════════════
// server.js — SFV Backend API v3
// SSE por proyecto · Sin endpoints legacy · Token en SSE
// ══════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { cleanExpiredSessions } = require('./middleware/auth');
const { getClientCount, getChannelStats } = require('./routes/events');

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Session-Token', 'Authorization'],
  exposedHeaders: ['X-Server-Time']
}));

// ── Body parser ─────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Anti-caché (excepto SSE) ────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/events') return next();
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Server-Time': new Date().toISOString()
  });
  next();
});

// ── Logging (excluye SSE y OPTIONS) ─────────────────────
app.use((req, res, next) => {
  if (req.method !== 'OPTIONS' && req.path !== '/events') {
    console.log(`[${new Date().toISOString().slice(11,19)}] ${req.method} ${req.path}`);
  }
  next();
});

// ── RUTAS ───────────────────────────────────────────────
app.use('/auth',      require('./routes/auth'));
app.use('/usuarios',  require('./routes/usuarios'));
app.use('/fotos',     require('./routes/fotos'));
app.use('/control',   require('./routes/control'));
app.use('/proyectos', require('./routes/proyectos'));
const eventsRoutes = require('./routes/events');
app.use('/events', eventsRoutes.router);
app.use('/api', require('./routes/upload'));

// ── Health check con estadísticas SSE ───────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'SFV Backend API v3',
    status: 'running',
    sync: 'SSE (no polling)',
    sse_clients: getClientCount(),
    sse_channels: getChannelStats(),
    timestamp: new Date().toISOString()
  });
});

// ── Hora ────────────────────────────────────────────────
app.get('/hora', async (req, res) => {
  try {
    const tz = req.query.tz || 'America/Bogota';
    const r = await pool.query(`SELECT NOW()::text AS utc, (NOW() AT TIME ZONE $1)::text AS local`, [tz]);
    res.json(r.rows[0]);
  } catch(e) { res.json({ utc: new Date().toISOString() }); }
});

// ── 404 + Error handler ─────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => { console.error('[Error]', err.message); res.status(500).json({ error: 'Error interno' }); });

// ── START ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  SFV Backend v3 (SSE autenticado) — Puerto ${PORT}\n`);
  setInterval(cleanExpiredSessions, 60 * 60 * 1000);
  cleanExpiredSessions();
});
