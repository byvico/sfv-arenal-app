// ══════════════════════════════════════════════════════════
// db.js — Conexión a PostgreSQL (Render)
// ══════════════════════════════════════════════════════════
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // Render requiere SSL
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Verificar conexión al iniciar
pool.query('SELECT NOW()')
  .then(r => console.log('[DB] ✅ PostgreSQL conectado:', r.rows[0].now))
  .catch(e => console.error('[DB] ❌ Error de conexión:', e.message));

module.exports = pool;
