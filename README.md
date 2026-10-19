# File-flow

**English** · [Español](#español)

A desktop widget for [Übersicht](https://tracesof.net/uebersicht/) (macOS) that shows **which files changed, where and when**.
> Personal project, shared as-is with no support for now. Built with help from Google AI Studio.

## What it shows
<video src="https://github.com/user-attachments/assets/b2a446e0-112a-494d-a773-b28d1d564ea6" autoplay loop muted playsinline width="100%">
</video>

- **One row per folder**, with its latest 25 files as bubbles (size = file size).
- **Horizontal axis = age**, logarithmic: further right means more recent.
- **Lit zone** = last 7 days. Only those files emit particles.
- **Curves** carry each file to its category: CODE, DOCS, DESIGN, IMAGES, AV and OTHER, with totals and this week's changes.
- **"Latest changes" panel** with the most recently modified files.
- A **Google Drive** status indicator and a ring on files inside the synced folder.

Interaction: click a file or a panel item to reveal it in Finder. Click a folder name to open it.

## Requirements

- macOS
- [Übersicht](https://tracesof.net/uebersicht/)

## Installation

1. Clone or download this repo.
2. Copy the `file-flow.widget` folder into Übersicht's widgets folder:
   ```bash
   cp -R file-flow.widget ~/Library/Application\ Support/Übersicht/widgets/
   ```
3. Edit `file-flow.jsx` and change `CONFIG` (see below).
4. Übersicht reloads the widget on save. If not, use *Refresh All Widgets*.

### Permissions

Übersicht needs macOS permission to read `Documents`, `Downloads`, `Desktop`, etc. (System Settings → Privacy & Security → Files and Folders, or Full Disk Access). Without it the widget shows up empty.

## Configuration

Everything is at the top of `file-flow.jsx`, in the `CONFIG` object:

| Option | What it does |
|---|---|
| `syncDir` | Synced folder (e.g. Google Drive). **Absolute path.** |
| `homeDir` | Your home folder, only used to shorten paths as `~/...` |
| `perFolder` | Latest N files shown per folder |
| `syncRows` / `otherRows` | Max rows for the synced block / the rest |
| `recentDays` | "Recent" window (lit zone and particles) |
| `panelItems` | Files in "Latest changes" |
| `refreshMs` | How often it rescans (default 2 min) |
| `scan.otherDirs` | Other folders to scan |
| `scan.*Depth` / `*Limit` | Scan depth and max files read |
| `scan.exclude` | Ignored patterns (hidden files, `node_modules`, `Library`…) |

Categories and their extensions live in `CATEGORIES`. Element positions live in `LAYOUT`.

To hide the synced block, point `syncDir` to a folder that doesn't exist.

## How it works

1. Übersicht runs a shell command (`find` + `stat`) every `refreshMs`.
2. The output (`size|date|path`) is turned into data by pure functions (the `PURE` section of the file).
3. Everything is drawn on a `<canvas>` with its own animation loop.

## Privacy

- The widget **only reads metadata** (name, path, size, date). It never opens or reads file contents.
- It makes no network connections and sends nothing anywhere.
- It does **display file and folder names** on screen, so be careful when sharing screenshots.

## Known limitations

- macOS only.
- English-only interface (strings are hard-coded).
- The Drive indicator looks for a process called `Google Drive`; if your client is named differently, change `DRIVE_PROCESS`.
- Single quotes (`'`) in `syncDir` are not supported.
- Huge folders can be slow to scan; lower `syncLimit` / `otherLimit`.



---

# Español

[English](#file-flow) · **Español**

Widget de escritorio para [Übersicht](https://tracesof.net/uebersicht/) (macOS) que muestra **qué archivos cambiaron, dónde y cuándo**.

![captura](docs/screenshot.png)

> Proyecto personal, compartido tal cual y sin soporte de momento. Hecho con ayuda de Google AI Studio.

## Qué muestra

- **Una fila por carpeta**, con sus últimos 25 archivos como burbujas (tamaño = peso del archivo).
- **Eje horizontal = antigüedad**, en escala logarítmica: más a la derecha, más reciente.
- **Zona iluminada** = últimos 7 días. Solo esos archivos emiten partículas.
- **Curvas** que llevan cada archivo a su categoría: CODE, DOCS, DESIGN, IMAGES, AV y OTHER, con totales y cambios de la semana.
- **Panel "Latest changes"** con los archivos modificados más recientemente.
- Indicador de estado de **Google Drive** y un anillo en los archivos de la carpeta sincronizada.

Interacción: clic en un archivo o en el panel para mostrarlo en Finder. Clic en el nombre de una carpeta para abrirla.

## Requisitos

- macOS
- [Übersicht](https://tracesof.net/uebersicht/)

## Instalación

1. Clona o descarga este repo.
2. Copia la carpeta `file-flow.widget` a la carpeta de widgets de Übersicht:
   ```bash
   cp -R file-flow.widget ~/Library/Application\ Support/Übersicht/widgets/
   ```
3. Edita `file-flow.jsx` y cambia `CONFIG` (ver abajo).
4. Übersicht recarga el widget al guardar. Si no, usa *Refresh All Widgets*.

### Permisos

Übersicht necesita permiso de macOS para leer `Documents`, `Downloads`, `Desktop`, etc. (Ajustes del Sistema → Privacidad y seguridad → Archivos y carpetas, o Acceso total al disco). Sin eso el widget sale vacío.

## Configuración

Todo está al inicio de `file-flow.jsx`, en el objeto `CONFIG`:

| Opción | Qué hace |
|---|---|
| `syncDir` | Carpeta sincronizada (p. ej. Google Drive). **Ruta absoluta.** |
| `homeDir` | Tu carpeta de usuario, solo para abreviar rutas como `~/...` |
| `perFolder` | Últimos N archivos mostrados por carpeta |
| `syncRows` / `otherRows` | Máximo de filas del bloque sincronizado / del resto |
| `recentDays` | Ventana de "reciente" (zona iluminada y partículas) |
| `panelItems` | Archivos en "Latest changes" |
| `refreshMs` | Cada cuánto se reescanea (por defecto 2 min) |
| `scan.otherDirs` | Otras carpetas que se escanean |
| `scan.*Depth` / `*Limit` | Profundidad y tope de archivos leídos |
| `scan.exclude` | Patrones ignorados (ocultos, `node_modules`, `Library`…) |

Las categorías y sus extensiones están en `CATEGORIES`. La posición de cada elemento, en `LAYOUT`.

Para ocultar el bloque de la carpeta sincronizada, apunta `syncDir` a una carpeta que no exista.

## Cómo funciona

1. Übersicht ejecuta un comando de shell (`find` + `stat`) cada `refreshMs`.
2. La salida (`tamaño|fecha|ruta`) se convierte en datos con funciones puras (sección `PURE` del archivo).
3. Todo se dibuja en un `<canvas>` con su propio bucle de animación.

## Privacidad

- El widget **solo lee metadatos** (nombre, ruta, tamaño, fecha). Nunca abre ni lee el contenido de los archivos.
- No hace conexiones de red ni envía nada a ningún lado.
- Sí **muestra nombres de archivos y carpetas** en pantalla: ten cuidado al compartir capturas.

## Limitaciones conocidas

- Solo macOS.
- Interfaz solo en inglés (los textos están fijos en el código).
- El indicador de Drive busca un proceso llamado `Google Drive`; si tu cliente se llama distinto, cambia `DRIVE_PROCESS`.
- Las comillas simples (`'`) en `syncDir` no están soportadas.
- Las carpetas grandes pueden tardar en escanearse; baja `syncLimit` / `otherLimit`.