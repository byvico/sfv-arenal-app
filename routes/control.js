// ══════════════════════════════════════════════════════════
// routes/control.js — Control Diario de Instalación v2
//
// Cambios vs v1:
//   [1] Eliminados GET /hash y POST /sync (legacy)
//   [5] registro_id usa crypto.randomUUID()
//   [6] GET/POST restringen proyecto por sesión (no-master)
// ══════════════════════════════════════════════════════════
const crypto = require('crypto');
const router = require('express').Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('./events');

// [6] Resolver proyecto: master puede elegir, otros usan su sesión
function resolveProject(req) {
  if (req.session.rol === 'master') {
    return req.query.proyecto || req.body?.proyecto || 'arenal_2026';
  }
  // Cuadrilla/visitor/viewer → solo su proyecto asignado
  return req.session.proyectoId || 'arenal_2026';
}

// ── GET /control — Obtener registros ────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const pid = resolveProject(req);
    const cuadrilla = req.query.cuadrilla;

    let where = 'WHERE c.proyecto = $1';
    const params = [pid];
    let idx = 2;

    if (cuadrilla) {
      where += ` AND c.cuadrilla = $${idx++}`;
      params.push(parseInt(cuadrilla));
    }

    const result = await pool.query(
      `SELECT c.* FROM control_diario c ${where} ORDER BY c.id ASC`,
      params
    );

    res.json({
      data: result.rows,
      count: result.rows.length,
      proyecto: pid,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('[Control GET]', e.message);
    res.status(500).json({ error: 'Error al obtener control diario' });
  }
});

// ── POST /control — Crear o actualizar registro ─────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { registro_id, cuadrilla, item, vereda, estado,
            fecha, observaciones, nombre, cedula,
            gps_lat, gps_lng, gps_acc, gps_ts } = req.body;

    const pid = resolveProject(req);
    // [5] UUID seguro en vez de Date.now+random
    const rid = registro_id || crypto.randomUUID();

    const result = await pool.query(`
      INSERT INTO control_diario
        (registro_id, proyecto, cuadrilla, item, vereda, estado, fecha,
         observaciones, nombre, cedula, gps_lat, gps_lng, gps_acc, gps_ts)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (registro_id) DO UPDATE SET
        cuadrilla = EXCLUDED.cuadrilla, item = EXCLUDED.item,
        vereda = EXCLUDED.vereda, estado = EXCLUDED.estado,
        fecha = EXCLUDED.fecha, observaciones = EXCLUDED.observaciones,
        nombre = EXCLUDED.nombre, cedula = EXCLUDED.cedula,
        gps_lat = EXCLUDED.gps_lat, gps_lng = EXCLUDED.gps_lng,
        gps_acc = EXCLUDED.gps_acc, gps_ts = EXCLUDED.gps_ts,
        updated_at = NOW()
      RETURNING *
    `, [rid, pid, cuadrilla || 1, item, vereda, estado || 'Pendiente',
        fecha, observaciones, nombre, cedula,
        gps_lat, gps_lng, gps_acc, gps_ts]);

    broadcast(pid, 'control_update', { action: 'upsert', registro_id: rid });

    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('[Control POST]', e.message);
    res.status(500).json({ error: 'Error al crear registro', detail: e.message });
  }
});

// ── PUT /control/:registro_id — Actualizar ──────────────
router.put('/:registro_id', requireAuth, async (req, res) => {
  try {
    const { cuadrilla, item, vereda, estado, fecha,
            observaciones, nombre, cedula,
            gps_lat, gps_lng, gps_acc, gps_ts } = req.body;

    const result = await pool.query(`
      UPDATE control_diario SET
        cuadrilla = COALESCE($1, cuadrilla), item = COALESCE($2, item),
        vereda = COALESCE($3, vereda), estado = COALESCE($4, estado),
        fecha = COALESCE($5, fecha), observaciones = COALESCE($6, observaciones),
        nombre = COALESCE($7, nombre), cedula = COALESCE($8, cedula),
        gps_lat = COALESCE($9, gps_lat), gps_lng = COALESCE($10, gps_lng),
        gps_acc = COALESCE($11, gps_acc), gps_ts = COALESCE($12, gps_ts)
      WHERE registro_id = $13 RETURNING *
    `, [cuadrilla, item, vereda, estado, fecha,
        observaciones, nombre, cedula,
        gps_lat, gps_lng, gps_acc, gps_ts,
        req.params.registro_id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Registro no encontrado' });

    const pid = result.rows[0].proyecto;
    broadcast(pid, 'control_update', { action: 'update', registro_id: req.params.registro_id });

    res.json(result.rows[0]);
  } catch (e) {
    console.error('[Control PUT]', e.message);
    res.status(500).json({ error: 'Error al actualizar registro' });
  }
});

// ── DELETE /control/:registro_id ────────────────────────
router.delete('/:registro_id', requireAuth, async (req, res) => {
  try {
    if (req.session.rol !== 'master') {
      return res.status(403).json({ error: 'Solo el administrador puede eliminar registros' });
    }
    const result = await pool.query(
      'DELETE FROM control_diario WHERE registro_id = $1 RETURNING proyecto, registro_id',
      [req.params.registro_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Registro no encontrado' });

    broadcast(result.rows[0].proyecto, 'control_update', { action: 'delete', registro_id: req.params.registro_id });

    res.json({ ok: true, deleted: req.params.registro_id });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar registro' });
  }
});

// ── DELETE /control/all/:proyecto ────────────────────────
router.delete('/all/:proyecto', requireAuth, async (req, res) => {
  try {
    if (req.session.rol !== 'master') {
      return res.status(403).json({ error: 'Solo el administrador puede borrar todo' });
    }
    const result = await pool.query(
      'DELETE FROM control_diario WHERE proyecto = $1 RETURNING id',
      [req.params.proyecto]
    );

    broadcast(req.params.proyecto, 'control_update', { action: 'delete_all' });

    res.json({ ok: true, deleted: result.rowCount });
  } catch (e) {
    res.status(500).json({ error: 'Error al borrar registros' });
  }
});

// [1] GET /hash y POST /sync ELIMINADOS — el sistema usa SSE exclusivamente

module.exports = router;
