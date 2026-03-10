// ══════════════════════════════════════════════════════════
// routes/usuarios.js — CRUD Beneficiarios SFV
// ══════════════════════════════════════════════════════════
const router = require('express').Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// Convertir timestamp UTC a zona horaria del proyecto
async function convertTimezone(timestamp, proyectoId) {
  if (!timestamp) return null;
  const tz = await getProjectTimezone(proyectoId);
  const res = await pool.query(
    `SELECT ($1::timestamptz AT TIME ZONE $2)::text AS local_time`,
    [timestamp, tz]
  );
  return res.rows[0]?.local_time || timestamp;
}

async function getProjectTimezone(proyectoId) {
  if (!proyectoId) return 'America/Bogota';
  const res = await pool.query('SELECT zona_horaria FROM proyectos WHERE id = $1', [proyectoId]);
  return res.rows[0]?.zona_horaria || 'America/Bogota';
}

// ── POST /usuarios — Crear beneficiario ─────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { nombre, cedula, telefono, direccion, vereda, proyecto,
            cuadrilla, item_numero, latitud, longitud, fecha_instalacion } = req.body;

    const result = await pool.query(`
      INSERT INTO usuarios (nombre, cedula, telefono, direccion, vereda, proyecto,
        cuadrilla, item_numero, latitud, longitud, fecha_instalacion)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [nombre, cedula, telefono, direccion, vereda, proyecto || 'arenal_2026',
        cuadrilla, item_numero, latitud, longitud, fecha_instalacion]);

    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('[Usuarios POST]', e.message);
    res.status(500).json({ error: 'Error al crear usuario', detail: e.message });
  }
});

// ── GET /usuarios — Listar todos ────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { proyecto, cuadrilla, estado, page, limit } = req.query;
    const p = proyecto || 'arenal_2026';
    const lim = Math.min(parseInt(limit) || 500, 1000);
    const offset = ((parseInt(page) || 1) - 1) * lim;

    let where = 'WHERE u.proyecto = $1';
    const params = [p];
    let paramIdx = 2;

    if (cuadrilla) {
      where += ` AND u.cuadrilla = $${paramIdx++}`;
      params.push(parseInt(cuadrilla));
    }

    // Contar total
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM usuarios u ${where}`, params
    );

    const result = await pool.query(`
      SELECT u.*,
        (u.created_at AT TIME ZONE proy.zona_horaria)::text AS created_local,
        (u.updated_at AT TIME ZONE proy.zona_horaria)::text AS updated_local
      FROM usuarios u
      LEFT JOIN proyectos proy ON proy.id = u.proyecto
      ${where}
      ORDER BY u.item_numero ASC, u.id ASC
      LIMIT $${paramIdx++} OFFSET $${paramIdx}
    `, [...params, lim, offset]);

    res.json({
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page) || 1,
      limit: lim,
      data: result.rows
    });
  } catch (e) {
    console.error('[Usuarios GET]', e.message);
    res.status(500).json({ error: 'Error al listar usuarios', detail: e.message });
  }
});

// ── GET /usuarios/:id — Consultar uno ───────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*,
        (u.created_at AT TIME ZONE proy.zona_horaria)::text AS created_local,
        (u.updated_at AT TIME ZONE proy.zona_horaria)::text AS updated_local
      FROM usuarios u
      LEFT JOIN proyectos proy ON proy.id = u.proyecto
      WHERE u.id = $1
    `, [req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('[Usuarios GET/:id]', e.message);
    res.status(500).json({ error: 'Error al consultar usuario' });
  }
});

// ── PUT /usuarios/:id — Actualizar ──────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { nombre, cedula, telefono, direccion, vereda,
            cuadrilla, item_numero, latitud, longitud, fecha_instalacion } = req.body;

    const result = await pool.query(`
      UPDATE usuarios SET
        nombre = COALESCE($1, nombre),
        cedula = COALESCE($2, cedula),
        telefono = COALESCE($3, telefono),
        direccion = COALESCE($4, direccion),
        vereda = COALESCE($5, vereda),
        cuadrilla = COALESCE($6, cuadrilla),
        item_numero = COALESCE($7, item_numero),
        latitud = COALESCE($8, latitud),
        longitud = COALESCE($9, longitud),
        fecha_instalacion = COALESCE($10, fecha_instalacion)
      WHERE id = $11
      RETURNING *
    `, [nombre, cedula, telefono, direccion, vereda,
        cuadrilla, item_numero, latitud, longitud, fecha_instalacion,
        req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('[Usuarios PUT]', e.message);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// ── DELETE /usuarios/:id — Eliminar ─────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (req.session.rol !== 'master') {
      return res.status(403).json({ error: 'Solo el administrador puede eliminar usuarios' });
    }
    const result = await pool.query('DELETE FROM usuarios WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, deleted: req.params.id });
  } catch (e) {
    console.error('[Usuarios DELETE]', e.message);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// ── POST /usuarios/bulk — Importación masiva (desde Excel) ──
router.post('/bulk', requireAuth, async (req, res) => {
  try {
    const { usuarios, proyecto } = req.body;
    if (!Array.isArray(usuarios) || !usuarios.length) {
      return res.status(400).json({ error: 'Array de usuarios requerido' });
    }

    const pid = proyecto || 'arenal_2026';
    let inserted = 0;

    for (const u of usuarios) {
      await pool.query(`
        INSERT INTO usuarios (nombre, cedula, vereda, proyecto, cuadrilla, item_numero, latitud, longitud)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING
      `, [u.nombre, u.cedula, u.vereda, pid, u.cuadrilla, u.item, u.latitud, u.longitud]);
      inserted++;
    }

    res.status(201).json({ ok: true, inserted });
  } catch (e) {
    console.error('[Usuarios Bulk]', e.message);
    res.status(500).json({ error: 'Error en importación masiva' });
  }
});

module.exports = router;
