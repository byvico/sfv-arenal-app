// ══════════════════════════════════════════════════════════
// middleware/auth.js — Sesiones persistentes con tokens
// ══════════════════════════════════════════════════════════
const crypto = require('crypto');
const pool = require('../db');

const INACTIVITY_MIN = parseInt(process.env.SESSION_INACTIVITY_MINUTES) || 120;
const MAX_DAYS = parseInt(process.env.SESSION_MAX_DAYS) || 30;

// Generar token aleatorio
function generateToken() {
  return crypto.randomBytes(48).toString('base64url');
}

// SHA-256 para verificar credenciales admin
async function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Crear sesión y devolver token
async function createSession({ rol, cuadrilla, nombre, canEdit, proyectoId, extra }) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + MAX_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(`
    INSERT INTO sesiones (token, rol, cuadrilla, nombre, can_edit, proyecto_id, datos_extra, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [token, rol, cuadrilla || null, nombre, canEdit, proyectoId || null, JSON.stringify(extra || {}), expiresAt]);

  return { token, expiresAt };
}

// Validar token y actualizar actividad
async function validateSession(token) {
  if (!token) return null;

  const res = await pool.query(`
    SELECT * FROM sesiones
    WHERE token = $1 AND expires_at > NOW()
  `, [token]);

  if (!res.rows.length) return null;

  const session = res.rows[0];

  // Verificar inactividad
  const lastActivity = new Date(session.last_activity);
  const inactivityLimit = new Date(Date.now() - INACTIVITY_MIN * 60 * 1000);

  if (lastActivity < inactivityLimit) {
    // Sesión expirada por inactividad
    await pool.query('DELETE FROM sesiones WHERE token = $1', [token]);
    return null;
  }

  // Actualizar última actividad
  await pool.query(`
    UPDATE sesiones SET last_activity = NOW() WHERE token = $1
  `, [token]);

  return {
    rol: session.rol,
    cuadrilla: session.cuadrilla,
    nombre: session.nombre,
    canEdit: session.can_edit,
    proyectoId: session.proyecto_id,
    extra: session.datos_extra
  };
}

// Middleware Express: requiere autenticación
function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'] || req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'Token de sesión requerido' });
  }

  validateSession(token)
    .then(session => {
      if (!session) {
        return res.status(401).json({ error: 'Sesión expirada o inválida. Inicia sesión nuevamente.' });
      }
      req.session = session;
      next();
    })
    .catch(err => {
      console.error('[Auth]', err.message);
      res.status(500).json({ error: 'Error de autenticación' });
    });
}

// Middleware opcional: permite acceso sin auth pero adjunta sesión si existe
function optionalAuth(req, res, next) {
  const token = req.headers['x-session-token'] || req.query.token;
  if (!token) { req.session = null; return next(); }

  validateSession(token)
    .then(session => { req.session = session; next(); })
    .catch(() => { req.session = null; next(); });
}

// Eliminar sesión
async function destroySession(token) {
  await pool.query('DELETE FROM sesiones WHERE token = $1', [token]);
}

// Limpiar sesiones expiradas (llamar periódicamente)
async function cleanExpiredSessions() {
  const res = await pool.query('DELETE FROM sesiones WHERE expires_at < NOW() RETURNING id');
  if (res.rowCount > 0) {
    console.log(`[Auth] 🧹 ${res.rowCount} sesiones expiradas eliminadas`);
  }
}

module.exports = {
  generateToken,
  sha256,
  createSession,
  validateSession,
  destroySession,
  requireAuth,
  optionalAuth,
  cleanExpiredSessions
};
