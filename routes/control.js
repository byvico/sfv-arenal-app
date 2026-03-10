// ══════════════════════════════════════════════════════════
// routes/control.js — Control Diario de Instalación
// FUENTE DE VERDAD: PostgreSQL (elimina localStorage + Firestore)
// ══════════════════════════════════════════════════════════
const router = require('express').Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── GET /control — Obtener todos los registros del proyecto ──
// Este endpoint reemplaza la lectura de localStorage
router.get('/', requireAuth, async (req, res) => {
  try {
    const pid = req.query.proyecto || req.session.proyectoId || 'arenal_2026';
    const cuadrilla = req.query.cuadrilla;
    const since = req.query.since; // ISO timestamp — para sync incremental

    let where = 'WHERE c.proyecto = $1';
    const params = [pid];
    let idx = 2;

    if (cuadrilla) {
      where += ` AND c.cuadrilla = $${idx++}`;
      params.push(parseInt(cuadrilla));
    }
    if (since) {
      where += ` AND c.updated_at > $${idx++}`;
      params.push(since);
    }

    const result = await pool.query(`
      SELECT c.*,
        (c.updated_at AT TIME ZONE COALESCE(proy.zona_horaria, 'America/Bogota'))::text AS updated_local,
        (c.gps_ts AT TIME ZONE COALESCE(proy.zona_horaria, 'America/Bogota'))::text AS gps_ts_local
      FROM control_diario c
      LEFT JOIN proyectos proy ON proy.id = c.proyecto
      ${where}
      ORDER BY c.id ASC
    `, params);

    // También devolver el hash del estado actual para detección de cambios
    const hashRes = await pool.query(
      `SELECT md5(string_agg(
        c.registro_id || c.estado || COALESCE(c.observaciones,'') ||
        COALESCE(c.item,'') || c.cuadrilla::text ||
        COALESCE(c.gps_lat::text,'') || COALESCE(c.updated_at::text,''),
        '|' ORDER BY c.id
      )) AS hash
      FROM control_diario c WHERE c.proyecto = $1`,
      [pid]
    );

    res.json({
      data: result.rows,
      hash: hashRes.rows[0]?.hash || '0',
      count: result.rows.length,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('[Control GET]', e.message);
    res.status(500).json({ error: 'Error al obtener control diario' });
  }
});

// ── GET /control/hash — Solo el hash (para polling ligero) ──
router.get('/hash', requireAuth, async (req, res) => {
  try {
    const pid = req.query.proyecto || req.session.proyectoId || 'arenal_2026';
    const result = await pool.query(
      `SELECT md5(string_agg(
        c.registro_id || c.estado || COALESCE(c.observaciones,'') ||
        COALESCE(c.item,'') || c.cuadrilla::text ||
        COALESCE(c.gps_lat::text,'') || COALESCE(c.updated_at::text,''),
        '|' ORDER BY c.id
      )) AS hash,
      COUNT(*) AS count
      FROM control_diario c WHERE c.proyecto = $1`,
      [pid]
    );
    res.json({
      hash: result.rows[0]?.hash || '0',
      count: parseInt(result.rows[0]?.count || 0),
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener hash' });
  }
});

// ── POST /control — Crear un registro ───────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { registro_id, proyecto, cuadrilla, item, vereda, estado,
            fecha, observaciones, nombre, cedula,
            gps_lat, gps_lng, gps_acc, gps_ts } = req.body;

    const pid = proyecto || req.session.proyectoId || 'arenal_2026';
    const rid = registro_id || ('reg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));

    const result = await pool.query(`
      INSERT INTO control_diario
        (registro_id, proyecto, cuadrilla, item, vereda, estado, fecha,
         observaciones, nombre, cedula, gps_lat, gps_lng, gps_acc, gps_ts)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (registro_id) DO UPDATE SET
        cuadrilla = EXCLUDED.cuadrilla,
        item = EXCLUDED.item,
        vereda = EXCLUDED.vereda,
        estado = EXCLUDED.estado,
        fecha = EXCLUDED.fecha,
        observaciones = EXCLUDED.observaciones,
        nombre = EXCLUDED.nombre,
        cedula = EXCLUDED.cedula,
        gps_lat = EXCLUDED.gps_lat,
        gps_lng = EXCLUDED.gps_lng,
        gps_acc = EXCLUDED.gps_acc,
        gps_ts = EXCLUDED.gps_ts,
        updated_at = NOW()
      RETURNING *
    `, [rid, pid, cuadrilla || 1, item, vereda, estado || 'Pendiente',
        fecha, observaciones, nombre, cedula,
        gps_lat, gps_lng, gps_acc, gps_ts]);

    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('[Control POST]', e.message);
    res.status(500).json({ error: 'Error al crear registro', detail: e.message });
  }
});

// ── PUT /control/:registro_id — Actualizar un registro ──
router.put('/:registro_id', requireAuth, async (req, res) => {
  try {
    const { cuadrilla, item, vereda, estado, fecha,
            observaciones, nombre, cedula,
            gps_lat, gps_lng, gps_acc, gps_ts } = req.body;

    const result = await pool.query(`
      UPDATE control_diario SET
        cuadrilla = COALESCE($1, cuadrilla),
        item = COALESCE($2, item),
        vereda = COALESCE($3, vereda),
        estado = COALESCE($4, estado),
        fecha = COALESCE($5, fecha),
        observaciones = COALESCE($6, observaciones),
        nombre = COALESCE($7, nombre),
        cedula = COALESCE($8, cedula),
        gps_lat = COALESCE($9, gps_lat),
        gps_lng = COALESCE($10, gps_lng),
        gps_acc = COALESCE($11, gps_acc),
        gps_ts = COALESCE($12, gps_ts)
      WHERE registro_id = $13
      RETURNING *
    `, [cuadrilla, item, vereda, estado, fecha,
        observaciones, nombre, cedula,
        gps_lat, gps_lng, gps_acc, gps_ts,
        req.params.registro_id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('[Control PUT]', e.message);
    res.status(500).json({ error: 'Error al actualizar registro' });
  }
});

// ── DELETE /control/:registro_id — Eliminar ─────────────
router.delete('/:registro_id', requireAuth, async (req, res) => {
  try {
    if (req.session.rol !== 'master') {
      return res.status(403).json({ error: 'Solo el administrador puede eliminar registros' });
    }
    const result = await pool.query(
      'DELETE FROM control_diario WHERE registro_id = $1 RETURNING registro_id',
      [req.params.registro_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ ok: true, deleted: req.params.registro_id });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar registro' });
  }
});

// ── POST /control/sync — Sincronización masiva ──────────
// El dashboard envía TODO su ctrlData y el servidor mergea
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const { registros, proyecto } = req.body;
    if (!Array.isArray(registros)) {
      return res.status(400).json({ error: 'Array de registros requerido' });
    }

    const pid = proyecto || req.session.proyectoId || 'arenal_2026';
    let synced = 0;

    for (const r of registros) {
      const rid = r.registro_id || r.id || ('reg_' + Date.now() + '_' + (synced++));
      await pool.query(`
        INSERT INTO control_diario
          (registro_id, proyecto, cuadrilla, item, vereda, estado, fecha,
           observaciones, nombre, cedula, gps_lat, gps_lng, gps_acc, gps_ts)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (registro_id) DO UPDATE SET
          cuadrilla = EXCLUDED.cuadrilla,
          item = EXCLUDED.item,
          vereda = EXCLUDED.vereda,
          estado = EXCLUDED.estado,
          fecha = EXCLUDED.fecha,
          observaciones = EXCLUDED.observaciones,
          nombre = EXCLUDED.nombre,
          cedula = EXCLUDED.cedula,
          gps_lat = EXCLUDED.gps_lat,
          gps_lng = EXCLUDED.gps_lng,
          gps_acc = EXCLUDED.gps_acc,
          gps_ts = EXCLUDED.gps_ts,
          updated_at = NOW()
      `, [rid, pid, r.cuadrilla || 1, r.item, r.vereda, r.estado || 'Pendiente',
          r.fecha, r.obs || r.observaciones, r.nombre, r.cedula,
          r.gps_lat, r.gps_lng, r.gps_acc, r.gps_ts]);
      synced++;
    }

    // Devolver estado completo del proyecto
    const allRes = await pool.query(
      'SELECT * FROM control_diario WHERE proyecto = $1 ORDER BY id ASC', [pid]
    );

    const hashRes = await pool.query(
      `SELECT md5(string_agg(
        c.registro_id || c.estado || COALESCE(c.observaciones,'') ||
        COALESCE(c.item,'') || c.cuadrilla::text ||
        COALESCE(c.gps_lat::text,'') || COALESCE(c.updated_at::text,''),
        '|' ORDER BY c.id
      )) AS hash
      FROM control_diario c WHERE c.proyecto = $1`,
      [pid]
    );

    res.json({
      ok: true,
      synced,
      data: allRes.rows,
      hash: hashRes.rows[0]?.hash || '0',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('[Control Sync]', e.message);
    res.status(500).json({ error: 'Error en sincronización', detail: e.message });
  }
});

// ── DELETE /control/all/:proyecto — Borrar todos ────────
router.delete('/all/:proyecto', requireAuth, async (req, res) => {
  try {
    if (req.session.rol !== 'master') {
      return res.status(403).json({ error: 'Solo el administrador puede borrar todo' });
    }
    const result = await pool.query(
      'DELETE FROM control_diario WHERE proyecto = $1 RETURNING id', [req.params.proyecto]
    );
    res.json({ ok: true, deleted: result.rowCount });
  } catch (e) {
    res.status(500).json({ error: 'Error al borrar registros' });
  }
});

module.exports = router;
