// ══════════════════════════════════════════════════════════
// routes/events.js — Server-Sent Events (SSE) v2
//
// Cambios vs v1:
//   [2] Clientes indexados por proyecto: Map<proyecto, Set>
//   [3] Validación de token en conexión SSE
//   [4] Eventos nombrados (event: control_update)
//   [9] Limpieza en req.close, sin memory leaks
// ══════════════════════════════════════════════════════════
const router = require('express').Router();
const { validateSession } = require('../middleware/auth');

// Clientes SSE por proyecto: Map<proyecto, Set<{id, res}>>
const channels = new Map();
let nextId = 0;

// ── GET /events — Abrir conexión SSE (autenticada) ──────
router.get('/', async (req, res) => {
  const proyecto = req.query.proyecto || 'arenal_2026';
  const token = req.query.token || '';

  // [3] Validar token antes de aceptar la conexión
  if (!token) {
    return res.status(401).json({ error: 'Token requerido para SSE' });
  }

  let session;
  try {
    session = await validateSession(token);
  } catch(e) {
    return res.status(500).json({ error: 'Error validando sesión' });
  }

  if (!session) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  // [6] Cuadrilla/visitor solo puede escuchar su propio proyecto
  const allowedProject = (session.rol === 'master')
    ? proyecto
    : (session.proyectoId || proyecto);

  // ── Headers SSE ────────────────────────────────────────
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });

  // [4] Evento nombrado de conexión
  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  // [2] Registrar cliente en el canal del proyecto
  const id = ++nextId;
  const client = { id, res };

  if (!channels.has(allowedProject)) {
    channels.set(allowedProject, new Set());
  }
  channels.get(allowedProject).add(client);

  const totalClients = Array.from(channels.values()).reduce((s, set) => s + set.size, 0);
  console.log(`[SSE] #${id} conectado → ${allowedProject} (${session.rol}) — Total: ${totalClients}`);

  // [9] Heartbeat cada 25s
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch(e) {
      clearInterval(heartbeat);
    }
  }, 25000);

  // [9] Limpieza en desconexión — sin memory leaks
  const cleanup = () => {
    clearInterval(heartbeat);
    const ch = channels.get(allowedProject);
    if (ch) {
      ch.delete(client);
      if (ch.size === 0) channels.delete(allowedProject);
    }
    const remaining = Array.from(channels.values()).reduce((s, set) => s + set.size, 0);
    console.log(`[SSE] #${id} desconectado — Total: ${remaining}`);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
});

// ── Broadcast a todos los clientes de un proyecto ───────
// [2] Solo recorre el Set del proyecto afectado, no todos
// [4] Usa eventos nombrados SSE
function broadcast(proyecto, eventType, data) {
  const ch = channels.get(proyecto);
  if (!ch || ch.size === 0) return;

  const payload = JSON.stringify({
    type: eventType,
    proyecto,
    timestamp: new Date().toISOString(),
    ...(data || {})
  });

  let sent = 0;
  const dead = [];

  ch.forEach(client => {
    try {
      // [4] event: nombre + data: payload
      client.res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
      sent++;
    } catch(e) {
      dead.push(client);
    }
  });

  // Limpiar clientes muertos
  dead.forEach(c => ch.delete(c));
  if (ch.size === 0) channels.delete(proyecto);

  if (sent > 0) {
    console.log(`[SSE] ← ${eventType} → ${sent} clientes (${proyecto})`);
  }
}

// ── Estadísticas ────────────────────────────────────────
function getClientCount() {
  return Array.from(channels.values()).reduce((s, set) => s + set.size, 0);
}

function getChannelStats() {
  const stats = {};
  channels.forEach((set, proyecto) => { stats[proyecto] = set.size; });
  return stats;
}


module.exports = {
  router,
  broadcast,
  getClientCount,
  getChannelStats
};

