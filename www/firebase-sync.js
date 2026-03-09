/* ============================================================
   FIREBASE SYNC MODULE — SFV Arenal App
   Almacena datos localmente y sincroniza con Firebase
   cuando hay conexión a internet.

   PARA CONFIGURAR:
   1. Ve a https://console.firebase.google.com
   2. Crea un proyecto "sfv-arenal"
   3. Activa Firestore Database (modo producción)
   4. Activa Storage
   5. Ve a Configuración del proyecto → Tu app web → SDK
   6. Copia los valores y pégalos en SFV_FIREBASE_CONFIG abajo
   ============================================================ */

const SFV_FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDHIE683vjeWp0yOO2cFIYrQJGHCNTS_gA",
  authDomain:        "controlfotovoltaico.firebaseapp.com",
  projectId:         "controlfotovoltaico",
  storageBucket:     "controlfotovoltaico.appspot.com",
  messagingSenderId: "50997169216",
  appId:             "1:50997169216:web:e6fc460c15d661ff2b63a5"
};

/* ============================================================
   NO MODIFICAR NADA DEBAJO DE ESTA LÍNEA
   ============================================================ */

const SFV_SYNC = (function () {

  const QUEUE_KEY   = 'sfv_sync_queue_v1';
  const STATUS_KEY  = 'sfv_sync_status_v1';
  const PROJECT_ID  = 'arenal'; // Identificador del proyecto en Firestore

  let _db       = null;
  let _storage  = null;
  let _ready    = false;
  let _syncing  = false;
  let _online   = navigator.onLine;
  let _statusEl = null;

  // ── Inicialización ──────────────────────────────────────────
  function init() {
    _statusEl = document.getElementById('syncStatusIndicator');
    _updateUI('init');

    // Verificar si la config fue llenada
    if (!SFV_FIREBASE_CONFIG.apiKey ||
        SFV_FIREBASE_CONFIG.apiKey.startsWith('PEGA_')) {
      console.warn('[SFV Sync] Firebase no configurado — modo solo local activo');
      _updateUI('no-config');
      return;
    }

    try {
      // Firebase v9 compat (cargado via CDN en index.html)
      if (typeof firebase === 'undefined') {
        console.warn('[SFV Sync] Firebase SDK no cargado');
        _updateUI('error');
        return;
      }
      // Solo inicializar si no hay app ya iniciada
      if (!firebase.apps.length) {
        firebase.initializeApp(SFV_FIREBASE_CONFIG);
      }
      _db      = firebase.firestore();
      _storage = firebase.storage();
      _ready   = true;
      console.log('[SFV Sync] Firebase listo');
    } catch (e) {
      console.error('[SFV Sync] Error init Firebase:', e);
      _updateUI('error');
      return;
    }

    // Escuchar cambios de red
    window.addEventListener('online',  _onOnline);
    window.addEventListener('offline', _onOffline);

    // Escuchar mensajes del Service Worker
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', evt => {
        if (evt.data && evt.data.type === 'TRIGGER_SYNC') _processQueue();
      });
    }

    _updateUI(_online ? 'online' : 'offline');

    // Si hay conexión al inicio → sincronizar pendientes
    if (_online) setTimeout(_processQueue, 2000);
  }

  function _onOnline() {
    _online = true;
    _updateUI('online');
    console.log('[SFV Sync] Conexion detectada — sincronizando...');
    _processQueue();
  }
  function _onOffline() {
    _online = false;
    _updateUI('offline');
    console.log('[SFV Sync] Sin conexion — modo offline');
  }

  // ── Cola de sincronización ──────────────────────────────────
  function _loadQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function _saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
  }
  function _addToQueue(item) {
    const q = _loadQueue();
    // Evitar duplicados por id
    const idx = q.findIndex(x => x.qid === item.qid);
    if (idx >= 0) q[idx] = item; else q.push(item);
    _saveQueue(q);
    _updateBadge(q.length);
    if (_online && _ready) _processQueue();
  }

  // ── API pública: encolar operaciones ───────────────────────

  // Guardar un registro de control diario
  function queueCtrlRecord(record) {
    if (!_ready) return;
    const item = {
      qid:       'ctrl_' + record.item + '_' + record.fecha,
      type:      'ctrl',
      data:      { ...record },
      ts:        Date.now(),
      attempts:  0
    };
    _addToQueue(item);
  }

  // Guardar todos los registros del control (llamar al hacer saveControl)
  function queueCtrlBatch(allRecords) {
    if (!_ready) return;
    allRecords.forEach(r => { if (r.item) queueCtrlRecord(r); });
  }

  // Guardar un archivo/foto (base64)
  function queueFile(itemId, slotIdx, fileData, fileName, fileType) {
    if (!_ready) return;
    const item = {
      qid:      'file_' + itemId + '_' + slotIdx,
      type:     'file',
      itemId:   Number(itemId),
      slotIdx:  slotIdx,
      fileName: fileName,
      fileType: fileType,
      fileData: fileData, // base64 data URL
      ts:       Date.now(),
      attempts: 0
    };
    _addToQueue(item);
  }

  // Guardar estado de una vivienda
  function queueEstado(itemId, estado) {
    if (!_ready) return;
    _addToQueue({
      qid:     'estado_' + itemId,
      type:    'estado',
      itemId:  Number(itemId),
      estado:  estado,
      ts:      Date.now(),
      attempts: 0
    });
  }

  // ── Procesador de cola ──────────────────────────────────────
  async function _processQueue() {
    if (_syncing || !_online || !_ready) return;
    const q = _loadQueue();
    if (!q.length) { _updateUI('synced'); return; }

    _syncing = true;
    _updateUI('syncing');
    console.log('[SFV Sync] Procesando', q.length, 'operaciones pendientes...');

    const remaining = [];
    for (const item of q) {
      try {
        await _processItem(item);
        console.log('[SFV Sync] OK:', item.qid);
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = e.message;
        console.warn('[SFV Sync] Error en', item.qid, ':', e.message);
        // Mantener en cola si no superó 5 intentos
        if (item.attempts < 5) remaining.push(item);
        else console.error('[SFV Sync] Descartando tras 5 intentos:', item.qid);
      }
    }

    _saveQueue(remaining);
    _updateBadge(remaining.length);
    _syncing = false;
    _updateUI(remaining.length === 0 ? 'synced' : 'partial');
    console.log('[SFV Sync] Ciclo completo. Pendientes:', remaining.length);
  }

  async function _processItem(item) {
    switch (item.type) {
      case 'ctrl':   return _uploadCtrl(item);
      case 'file':   return _uploadFile(item);
      case 'estado': return _uploadEstado(item);
      default: throw new Error('Tipo desconocido: ' + item.type);
    }
  }

  // Subir registro de control a Firestore (incluye GPS si está disponible)
  async function _uploadCtrl(item) {
    const docId = 'item' + String(item.data.item).padStart(3,'0') + '_' + (item.data.fecha||'').replace(/-/g,'');
    const payload = {
      ...item.data,
      _syncedAt: firebase.firestore.FieldValue.serverTimestamp(),
      _device:   _getDeviceId()
    };
    // Agregar GeoPoint si hay coordenadas GPS
    if(item.data.gps_lat && item.data.gps_lng){
      payload.geopoint = new firebase.firestore.GeoPoint(item.data.gps_lat, item.data.gps_lng);
    }
    await _db
      .collection('projects').doc(PROJECT_ID)
      .collection('ctrl_records').doc(docId)
      .set(payload, { merge: true });
  }

  // Subir foto a Firebase Storage + metadata a Firestore
  async function _uploadFile(item) {
    // Convertir base64 a Blob
    const base64Data = item.fileData.split(',')[1];
    const byteChars  = atob(base64Data);
    const byteArr    = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: item.fileType || 'image/jpeg' });

    // Path en Storage: sfv-arenal/fotos/{itemId}/{slotIdx}_{filename}
    const storagePath = `sfv-arenal/fotos/${item.itemId}/${item.slotIdx}_${item.fileName}`;
    const ref = _storage.ref(storagePath);

    // Subir
    const snap = await ref.put(blob, { contentType: item.fileType });
    const downloadURL = await snap.ref.getDownloadURL();

    // Guardar metadata en Firestore
    const docId = 'slot' + String(item.slotIdx).padStart(3,'0');
    await _db
      .collection('projects').doc(PROJECT_ID)
      .collection('fotos').doc('item' + String(item.itemId).padStart(3,'0'))
      .collection('slots').doc(docId)
      .set({
        slotIdx:    item.slotIdx,
        fileName:   item.fileName,
        fileType:   item.fileType,
        url:        downloadURL,
        storagePath:storagePath,
        itemId:     item.itemId,
        _syncedAt:  firebase.firestore.FieldValue.serverTimestamp(),
        _device:    _getDeviceId()
      }, { merge: true });
  }

  // Subir cambio de estado
  async function _uploadEstado(item) {
    await _db
      .collection('projects').doc(PROJECT_ID)
      .collection('estados').doc('item' + String(item.itemId).padStart(3,'0'))
      .set({
        estado:    item.estado,
        itemId:    item.itemId,
        _syncedAt: firebase.firestore.FieldValue.serverTimestamp(),
        _device:   _getDeviceId()
      }, { merge: true });
  }

  // ── UI ──────────────────────────────────────────────────────
  function _updateUI(status) {
    const el = _statusEl || document.getElementById('syncStatusIndicator');
    if (!el) return;
    const map = {
      'init':      { dot:'🔵', txt:'Iniciando...', col:'#90CAF9' },
      'no-config': { dot:'⚪', txt:'Sin config Firebase', col:'#BDBDBD' },
      'online':    { dot:'🟢', txt:'En línea', col:'#4CAF50' },
      'offline':   { dot:'🟠', txt:'Sin internet — modo offline', col:'#FF9800' },
      'syncing':   { dot:'🔄', txt:'Sincronizando...', col:'#1565C0' },
      'synced':    { dot:'✅', txt:'Todo sincronizado', col:'#2E7D32' },
      'partial':   { dot:'⚠️', txt:'Sync parcial — reintentará', col:'#E65100' },
      'error':     { dot:'🔴', txt:'Error Firebase', col:'#C62828' }
    };
    const s = map[status] || map['init'];
    el.innerHTML = s.dot + ' <span>' + s.txt + '</span>';
    el.style.color = s.col;
  }
  function _updateBadge(count) {
    const b = document.getElementById('syncBadge');
    if (!b) return;
    b.textContent = count > 0 ? count : '';
    b.style.display = count > 0 ? 'inline-block' : 'none';
  }

  // ── Helpers ─────────────────────────────────────────────────
  function _getDeviceId() {
    let id = localStorage.getItem('sfv_device_id');
    if (!id) {
      id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      localStorage.setItem('sfv_device_id', id);
    }
    return id;
  }

  // Forzar sincronización manual
  function forceSyncNow() {
    if (!_ready) {
      alert('Firebase no configurado. Revisa el archivo firebase-sync.js');
      return;
    }
    if (!_online) {
      alert('Sin conexión a internet. La sincronización es automática cuando vuelva la señal.');
      return;
    }
    _processQueue();
  }

  function getQueueCount() {
    return _loadQueue().length;
  }

  function getStatus() {
    return { online: _online, ready: _ready, syncing: _syncing, pending: _loadQueue().length };
  }

  // ── Exportar API pública ────────────────────────────────────
  return { init, queueCtrlRecord, queueCtrlBatch, queueFile, queueEstado, forceSyncNow, getQueueCount, getStatus };

})(); // fin SFV_SYNC
