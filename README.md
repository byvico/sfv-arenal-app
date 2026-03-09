# 📱 SFV Arenal — App Android (APK)

Dashboard de gestión de instalaciones fotovoltaicas para las cuadrillas técnicas del municipio de Arenal, Colombia.

**Funciona 100% sin internet** — los datos se guardan en el celular y se sincronizan automáticamente con Firebase cuando hay señal.

---

## 🔧 Requisitos previos (instala UNA SOLA VEZ en tu PC)

| Herramienta | Descarga | Versión mínima |
|-------------|----------|---------------|
| Node.js | https://nodejs.org (versión LTS) | v18 o superior |
| Android Studio | https://developer.android.com/studio | Cualquier versión reciente |
| Java JDK | Viene incluido con Android Studio | JDK 17 |

---

## 🔥 PASO 1 — Configurar Firebase (gratis)

> Firebase es el servidor en la nube donde se guardan los datos de las cuadrillas.
> El master accede a los datos desde el dashboard HTML normal.

1. Ve a **https://console.firebase.google.com**
2. Haz clic en **"Crear un proyecto"**
3. Nombre: `sfv-arenal` → Continuar (sin Google Analytics por ahora)
4. Una vez creado, haz clic en el ícono **`</>`** (Web) para agregar una app web
5. Nombre de la app: `SFV Arenal App` → clic en **Registrar app**
6. Copia el bloque `firebaseConfig` que aparece. Se ve así:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "sfv-arenal.firebaseapp.com",
  projectId: "sfv-arenal",
  storageBucket: "sfv-arenal.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

7. Abre el archivo **`www/firebase-sync.js`** con cualquier editor de texto
8. Reemplaza los valores en `SFV_FIREBASE_CONFIG` con los tuyos:

```javascript
const SFV_FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",          // ← tu apiKey
  authDomain:        "sfv-arenal.firebaseapp.com",
  projectId:         "sfv-arenal",
  storageBucket:     "sfv-arenal.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

9. De vuelta en Firebase Console → **Firestore Database** → Crear base de datos → Modo producción → Elegir región (us-east1) → Listo
10. En Firebase Console → **Storage** → Comenzar → Modo producción → Listo
11. En Firebase Console → **Firestore** → pestaña **Reglas** → Pega esto y publica:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

12. En Firebase Console → **Storage** → pestaña **Reglas** → Pega esto y publica:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ Estas reglas abiertas son para arrancar rápido. Puedes restringirlas por autenticación después.

---

## 🏗️ PASO 2 — Instalar dependencias del proyecto

Abre una **Terminal** (cmd / PowerShell en Windows, Terminal en Mac/Linux) en la carpeta `sfv-arenal-app` y ejecuta:

```bash
npm install
```

Espera a que termine (~2 minutos). Verás que se crea la carpeta `node_modules`.

---

## 📱 PASO 3 — Agregar plataforma Android

En la misma terminal, ejecuta:

```bash
npx cap add android
```

Esto crea la carpeta `android/` con todo el proyecto Android nativo.
Luego sincroniza los archivos web:

```bash
npx cap sync
```

---

## 🔨 PASO 4 — Abrir en Android Studio y compilar el APK

```bash
npx cap open android
```

Android Studio se abre automáticamente. La primera vez descarga los componentes del SDK (~5 GB, puede tardar 10-15 min).

Una vez cargado el proyecto en Android Studio:

1. Menú **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Espera la compilación (~3-5 minutos)
3. Cuando termine, aparece un aviso abajo: **"APK(s) generated"** → haz clic en **"locate"**
4. El APK está en: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📲 PASO 5 — Instalar el APK en los celulares de las cuadrillas

**Opción A — USB (más fácil para la primera vez):**
1. Conecta el celular por USB al computador
2. En el celular: activar "Opciones de desarrollador" → "Depuración USB"
3. En Android Studio: botón ▶ (Run) → seleccionar el celular → instala automáticamente

**Opción B — Compartir el archivo APK:**
1. Copia `app-debug.apk` a Google Drive, WhatsApp o email
2. En el celular: abrir el archivo → "Instalar"
3. Si aparece "Instalar apps de fuentes desconocidas" → Activar → Instalar

---

## 🔄 Cómo funciona la sincronización offline

```
CUADRILLA (APK)                    INTERNET                    MASTER (Dashboard HTML)
     │                                │                                │
     ├─ Registra datos ──► LocalStorage ◄── Sin internet, guarda local │
     │                                │                                │
     │  (aparece barra naranja        │                                │
     │   "Sin internet - modo offline"│                                │
     │   con contador de ops.)        │                                │
     │                                │                                │
     ├─ Llega a zona con señal ──────►│                                │
     │                                │                                │
     │  (barra cambia a verde         │                                │
     │   "Sincronizando...")          │                                │
     │                                ├──► Firebase Firestore ────────►│
     │                                ├──► Firebase Storage  ────────►│
     │                                │       (fotos)                 │
     ├─ Barra: "Todo sincronizado ✅" │                                │
```

La barra de sincronización en la parte inferior del APK muestra en todo momento:
- 🟢 **En línea** — conectado y sincronizado
- 🟠 **Sin internet — modo offline** — guardando localmente
- 🔄 **Sincronizando...** — subiendo datos pendientes
- ✅ **Todo sincronizado** — todo subido exitosamente
- Contador: **"3 op. pendientes de subir"** — cuánto falta por sincronizar

---

## 📋 Ver datos desde el dashboard del master (Byron)

Una vez que las cuadrillas han sincronizado, los datos están en Firebase.
Para verlos desde el dashboard HTML:

1. Abre **Firebase Console → Firestore**
2. Ve a `projects → arenal → ctrl_records` para ver registros de control
3. Ve a `projects → arenal → fotos` para ver las fotos subidas (con URLs de descarga)

> En una próxima versión se puede agregar lectura de Firebase directamente en el dashboard HTML del master.

---

## 🛠️ Actualizar el APK con cambios al dashboard

Cada vez que el dashboard HTML cambie:

```bash
npx cap sync
```

Luego en Android Studio: **Build → Build APK(s)** y distribuir el nuevo APK a las cuadrillas.

---

## ❓ Solución de problemas frecuentes

| Problema | Solución |
|----------|----------|
| `npx: command not found` | Reinstala Node.js desde nodejs.org |
| Android Studio no abre | Ejecuta `npx cap open android` de nuevo |
| "SDK not found" en Android Studio | Ve a SDK Manager → instala Android 14 (API 34) |
| El APK no instala en el celular | Activa "Fuentes desconocidas" en Ajustes → Seguridad |
| La sincronización no funciona | Verifica que pegaste bien la config de Firebase en `firebase-sync.js` |
| "Firebase: Error (auth/...)" | Verifica las reglas de Firestore y Storage (ver Paso 1) |

---

## 📁 Estructura del proyecto

```
sfv-arenal-app/
├── package.json            ← Dependencias de Capacitor
├── capacitor.config.json   ← Configuración del app (ID, nombre)
├── www/                    ← Archivos web del dashboard
│   ├── index.html          ← Dashboard principal (2600+ líneas)
│   ├── firebase-sync.js    ← ← AQUÍ vas la config de Firebase
│   ├── sw.js               ← Service Worker (cache offline)
│   ├── manifest.json       ← Configuración PWA
│   └── icons/              ← Íconos del app
│       ├── icon-48.png
│       ├── icon-192.png
│       └── icon-512.png
├── android/                ← Generado por "npx cap add android"
│   └── app/build/outputs/apk/debug/app-debug.apk  ← EL APK FINAL
└── README.md               ← Este archivo
```

---

## 📞 Soporte

Proyecto: **SFV Arenal — 267 Sistemas Fotovoltaicos Individuales**
Municipio: Arenal, Bolívar, Colombia
Administrador: Byron Vizcaíno

---
*Generado con Dashboard SFV Arenal v1.0 · Powered by Capacitor + Firebase*

---

## 📍 GPS Automático en Registros

Cada vez que una cuadrilla agrega un nuevo registro en el Control Diario:
- El sistema pide la ubicación GPS del dispositivo automáticamente
- Las coordenadas se guardan con el registro (lat, lng, precisión en metros)
- En la tabla aparece un enlace directo a Google Maps con esa posición
- Si el GPS falla, el botón **"📍 Capturar GPS"** permite intentarlo de nuevo
- Las coordenadas se sincronizan a Firestore como `GeoPoint` nativo (permite consultas geoespaciales)

**Permisos necesarios en Android:**
- `ACCESS_FINE_LOCATION` — GPS preciso
- `ACCESS_COARSE_LOCATION` — red/wifi como fallback

Capacitor solicita estos permisos automáticamente la primera vez que se usa.

---

## 🗜️ Compresión Automática de Fotos

Antes de guardar cualquier foto (cámara o galería):
1. La imagen se redimensiona a máximo **1600px** en el lado mayor
2. Se comprime con calidad JPEG progresiva hasta caber en **300 KB**
3. Se muestra el tamaño final en el toast: `✅ Foto guardada (187 KB): Módulos instalados`

**Ejemplo de ahorro:**
| Foto original | Después de compresión |
|---|---|
| 5.2 MB (cámara 12MP) | ~180–280 KB |
| 3.8 MB (cámara 8MP) | ~140–220 KB |
| 1.2 MB (galería) | ~90–180 KB |

Las fotos en el PDF y en el ZIP se descargan ya comprimidas.
