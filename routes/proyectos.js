// ══════════════════════════════════════════════════════════
// routes/proyectos.js — Gestión de Proyectos
// Incluye zona horaria configurable por proyecto
// ══════════════════════════════════════════════════════════
const router = require('express').Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── Zonas horarias válidas para Latinoamérica ───────────
const TIMEZONES = {
  'Colombia':     'America/Bogota',
  'México':       'America/Mexico_City',
  'Perú':         'America/Lima',
  'Ecuador':      'America/Guayaquil',
  'Chile':        'America/Santiago',
  'Argentina':    'America/Argentina/Buenos_Aires',
  'Bolivia':      'America/La_Paz',
  'Venezuela':    'America/Caracas',
  'Panamá':       'America/Panama',
  'Costa Rica':   'America/Costa_Rica',
  'Honduras':     'America/Tegucigalpa',
  'Guatemala':    'America/Guatemala',
  'El Salvador':  'America/El_Salvador',
  'Nicaragua':    'America/Managua',
  'Paraguay':     'America/Asuncion',
  'Uruguay':      'America/Montevideo',
  'Brasil-Este':  'America/Sao_Paulo',
  'Rep.Dominicana':'America/Santo_Domingo',
  'Puerto Rico':  'America/Puerto_Rico',
  'Cuba':         'America/Havana'
};

// ── GET /proyectos/timezones — Listar zonas horarias ────
router.get('/timezones', (req, res) => {
  res.json(TIMEZONES);
});

// ── GET /proyectos — Listar todos los proyectos ────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM proyectos ORDER BY created_at ASC');
    res.json({ data: result.rows });
  } catch (e) {
    console.error('[Proyectos GET]', e.message);
    res.status(500).json({ error: 'Error al listar proyectos' });
  }
});

// ── GET /proyectos/:id — Un proyecto específico ─────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM proyectos WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const proj = result.rows[0];

    // Hora actual en la zona horaria del proyecto
    const timeRes = await pool.query(
      `SELECT (NOW() AT TIME ZONE $1)::text AS hora_local`, [proj.zona_horaria]
    );
    proj.hora_local_actual = timeRes.rows[0]?.hora_local;

    res.json(proj);
  } catch (e) {
    console.error('[Proyectos GET/:id]', e.message);
    res.status(500).json({ error: 'Error al consultar proyecto' });
  }
});

// ── POST /proyectos — Crear proyecto ────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    if (req.session.rol !== 'master') {
      return res.status(403).json({ error: 'Solo el administrador puede crear proyectos' });
    }

    const { id, nombre, subtitulo, municipio, departamento, pais,
            zona_horaria, fecha_inicio, fecha_instalacion, fecha_entrega,
            total_sistemas, meta_diaria, cuadrillas, credenciales, usernames } = req.body;

    const projId = id || ('proj_' + Date.now());
    const tz = zona_horaria || TIMEZONES[pais] || 'America/Bogota';

    const result = await pool.query(`
      INSERT INTO proyectos (id, nombre, subtitulo, municipio, departamento, pais,
        zona_horaria, fecha_inicio, fecha_instalacion, fecha_entrega,
        total_sistemas, meta_diaria, cuadrillas, credenciales, usernames)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [projId, nombre, subtitulo, municipio, departamento || 'Colombia',
        pais || 'Colombia', tz, fecha_inicio, fecha_instalacion, fecha_entrega,
        total_sistemas || 0, meta_diaria || 0,
        JSON.stringify(cuadrillas || []),
        JSON.stringify(credenciales || {}),
        JSON.stringify(usernames || {})]);

    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('[Proyectos POST]', e.message);
    res.status(500).json({ error: 'Error al crear proyecto', detail: e.message });
  }
});

// ── PUT /proyectos/:id — Actualizar proyecto ────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (req.session.rol !== 'master') {
      return res.status(403).json({ error: 'Solo el administrador puede editar proyectos' });
    }

    const { nombre, subtitulo, municipio, departamento, pais,
            zona_horaria, fecha_inicio, fecha_instalacion, fecha_entrega,
            total_sistemas, meta_diaria, cuadrillas, credenciales, usernames, config } = req.body;

    const result = await pool.query(`
      UPDATE proyectos SET
        nombre = COALESCE($1, nombre),
        subtitulo = COALESCE($2, subtitulo),
        municipio = COALESCE($3, municipio),
        departamento = COALESCE($4, departamento),
        pais = COALESCE($5, pais),
        zona_horaria = COALESCE($6, zona_horaria),
        fecha_inicio = COALESCE($7, fecha_inicio),
        fecha_instalacion = COALESCE($8, fecha_instalacion),
        fecha_entrega = COALESCE($9, fecha_entrega),
        total_sistemas = COALESCE($10, total_sistemas),
        meta_diaria = COALESCE($11, meta_diaria),
        cuadrillas = COALESCE($12, cuadrillas),
        credenciales = COALESCE($13, credenciales),
        usernames = COALESCE($14, usernames),
        config = COALESCE($15, config)
      WHERE id = $16
      RETURNING *
    `, [nombre, subtitulo, municipio, departamento, pais,
        zona_horaria, fecha_inicio, fecha_instalacion, fecha_entrega,
        total_sistemas, meta_diaria,
        cuadrillas ? JSON.stringify(cuadrillas) : null,
        credenciales ? JSON.stringify(credenciales) : null,
        usernames ? JSON.stringify(usernames) : null,
        config ? JSON.stringify(config) : null,
        req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('[Proyectos PUT]', e.message);
    res.status(500).json({ error: 'Error al actualizar proyecto' });
  }
});

// ── DELETE /proyectos/:id — Eliminar proyecto ───────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (req.session.rol !== 'master') {
      return res.status(403).json({ error: 'Solo el administrador' });
    }
    const p = await pool.query('SELECT is_builtin FROM proyectos WHERE id = $1', [req.params.id]);
    if (p.rows[0]?.is_builtin) {
      return res.status(400).json({ error: 'No se puede eliminar el proyecto predeterminado' });
    }
    await pool.query('DELETE FROM proyectos WHERE id = $1', [req.params.id]);
    res.json({ ok: true, deleted: req.params.id });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar proyecto' });
  }
});

// ── GET /proyectos/:id/hora — Hora actual del proyecto ──
router.get('/:id/hora', async (req, res) => {
  try {
    const pRes = await pool.query('SELECT zona_horaria FROM proyectos WHERE id = $1', [req.params.id]);
    const tz = pRes.rows[0]?.zona_horaria || 'America/Bogota';

    const timeRes = await pool.query(`
      SELECT
        (NOW() AT TIME ZONE $1)::text AS hora_local,
        NOW()::text AS hora_utc,
        $1 AS zona_horaria
    `, [tz]);

    res.json(timeRes.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener hora' });
  }
});

module.exports = router;
