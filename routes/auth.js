
const router = require('express').Router();
const pool = require('../db');
const { sha256, createSession, destroySession, validateSession } = require('../middleware/auth');

const ADMIN_HASH = '9dd33c5afe109e132d1b368cdebe3aa1dafa7760a14ea08b63c0e9c794a86923';

// ── POST /auth/login ────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const user = usuario.trim().toLowerCase();

    // 1. Login administrador
    const hash = await sha256(user + ':' + password);
    if (hash === ADMIN_HASH) {
      const { token, expiresAt } = await createSession({
        rol: 'master',
        nombre: 'Administrador',
        canEdit: true
      });

      return res.json({
        ok: true,
        token,
        expiresAt,
        session: {
          role: 'master',
          cuadrilla: null,
          name: 'Administrador',
          canEdit: true
        }
      });
    }

    // 2. Login de cuadrillas desde configuración de proyectos
    const proyectos = await pool.query(
      'SELECT id, credenciales, usernames, cuadrillas FROM proyectos ORDER BY created_at'
    );

    for (const proj of proyectos.rows) {
      const creds = proj.credenciales || {};
      const unames = proj.usernames || {};
      const cuadrillas = proj.cuadrillas || [];

      for (let q = 1; q <= cuadrillas.length; q++) {
        const key = 'c' + q;
        const expectedUser = (unames[key] || '').toLowerCase();
        const expectedPwd = creds[key] || '';

        if (!expectedUser || !expectedPwd) continue;

        if (user === expectedUser && password === expectedPwd) {
          const cuadrilla = cuadrillas.find(c => c.id === q);

          const { token, expiresAt } = await createSession({
            rol: 'cuadrilla',
            cuadrilla: q,
            nombre: cuadrilla?.name || ('Cuadrilla ' + q),
            canEdit: true,
            proyectoId: proj.id
          });

          return res.json({
            ok: true,
            token,
            expiresAt,
            session: {
              role: 'cuadrilla',
              cuadrilla: q,
              name: cuadrilla?.name || ('Cuadrilla ' + q),
              canEdit: true,
              projectId: proj.id
            }
          });
        }
      }
    }

    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  } catch (e) {
    console.error('[Auth Login]', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /auth/logout ───────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    if (token) await destroySession(token);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
});

// ── GET /auth/validate ──────────────────────────────────
router.get('/validate', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    if (!token) return res.json({ valid: false });

    const session = await validateSession(token);
    if (!session) return res.json({ valid: false });

    res.json({
      valid: true,
      session: {
        role: session.rol,
        cuadrilla: session.cuadrilla,
        name: session.nombre,
        canEdit: session.canEdit,
        projectId: session.proyectoId
      }
    });
  } catch (e) {
    console.error('[Auth Validate]', e.message);
    res.json({ valid: false });
  }
});

module.exports = router;
