
// ══════════════════════════════════════════════════════════
// routes/fotos.js — Fotografías con sincronización en tiempo real
//
// Flujo implementado:
// foto tomada
// ↓
// se sube
// ↓
// se guarda en DB
// ↓
// broadcast SSE
// ↓
// todos los dashboards reciben evento
// ↓
// todos actualizan fotos
//
// Las fotos se almacenan mediante URL permanente (Cloudinary/S3/hosting externo)
// para evitar pérdida en reinicios del servidor.
// ══════════════════════════════════════════════════════════

const router = require('express').Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('./events');

// ── POST /fotos — Registrar foto ────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {

    const {
      usuario_id,
      control_id,
      item,
      slot_idx,
      slot_nombre,
      url,
      nombre_archivo,
      tipo,
      tamano,
      latitud,
      longitud,
      cuadrilla,
      proyecto,
      timestamp,
      subido_por
    } = req.body;

    const pid = proyecto || req.session.proyectoId || 'arenal_2026';
    const ts = timestamp || new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO fotos (
        usuario_id,
        control_id,
        item,
        slot_idx,
        slot_nombre,
        url,
        nombre_archivo,
        tipo,
        tamano,
        latitud,
        longitud,
        cuadrilla,
        proyecto,
        timestamp,
        subido_por
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `,[
      usuario_id,
      control_id,
      item,
      slot_idx,
      slot_nombre,
      url,
      nombre_archivo,
      tipo,
      tamano,
      latitud,
      longitud,
      cuadrilla,
      pid,
      ts,
      subido_por || req.session.nombre
    ]);

    const foto = result.rows[0];

    // ── Convertir timestamp a hora local del proyecto ──
    const tzRes = await pool.query(
      `SELECT ($1::timestamptz AT TIME ZONE COALESCE(
        (SELECT zona_horaria FROM proyectos WHERE id = $2),
        'America/Bogota'
      ))::text AS hora_local`,
      [foto.timestamp, pid]
    );

    foto.hora_local = tzRes.rows[0]?.hora_local;

    // ── BROADCAST SSE: sincronizar todos los dashboards ──
    broadcast(pid, 'control_update', {
      action: 'photo_added',
      item: item,
      slot: slot_idx,
      url: url,
      cuadrilla: cuadrilla
    });

    res.status(201).json(foto);

  } catch (e) {
    console.error('[Fotos POST]', e.message);
    res.status(500).json({ error: 'Error al registrar foto', detail: e.message });
  }
});


// ── GET /fotos — Listar fotos ───────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {

    const { proyecto, item, usuario_id, cuadrilla } = req.query;
    const pid = proyecto || req.session.proyectoId || 'arenal_2026';

    let where = 'WHERE f.proyecto = $1';
    const params = [pid];
    let idx = 2;

    if (item) {
      where += ` AND f.item = $${idx++}`;
      params.push(item);
    }

    if (usuario_id) {
      where += ` AND f.usuario_id = $${idx++}`;
      params.push(parseInt(usuario_id));
    }

    if (cuadrilla) {
      where += ` AND f.cuadrilla = $${idx++}`;
      params.push(parseInt(cuadrilla));
    }

    const result = await pool.query(`
      SELECT f.*,
        (f.timestamp AT TIME ZONE COALESCE(proy.zona_horaria,'America/Bogota'))::text AS hora_local,
        (f.created_at AT TIME ZONE COALESCE(proy.zona_horaria,'America/Bogota'))::text AS created_local
      FROM fotos f
      LEFT JOIN proyectos proy ON proy.id = f.proyecto
      ${where}
      ORDER BY f.slot_idx ASC, f.created_at DESC
    `, params);

    res.json({ data: result.rows });

  } catch (e) {
    console.error('[Fotos GET]', e.message);
    res.status(500).json({ error: 'Error al listar fotos' });
  }
});


// ── GET /fotos/count/:item — Contar fotos por item ──────
router.get('/count/:item', requireAuth, async (req, res) => {
  try {

    const pid = req.query.proyecto || req.session.proyectoId || 'arenal_2026';

    const result = await pool.query(
      'SELECT COUNT(*) FROM fotos WHERE item = $1 AND proyecto = $2',
      [req.params.item, pid]
    );

    res.json({
      count: parseInt(result.rows[0].count),
      max: 20
    });

  } catch (e) {
    res.status(500).json({ error: 'Error al contar fotos' });
  }
});


// ── DELETE /fotos/:id — Eliminar foto ───────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {

    const result = await pool.query(
      'DELETE FROM fotos WHERE id = $1 RETURNING id, proyecto',
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Foto no encontrada' });
    }

    const pid = result.rows[0].proyecto;

    broadcast(pid, 'control_update', {
      action: 'photo_deleted',
      foto_id: req.params.id
    });

    res.json({ ok: true, deleted: req.params.id });

  } catch (e) {
    console.error('[Fotos DELETE]', e.message);
    res.status(500).json({ error: 'Error al eliminar foto' });
  }
});


module.exports = router;
