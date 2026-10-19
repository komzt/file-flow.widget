// ============================================================================
// FILE FLOW // Übersicht Desktop Widget for macOS
//
// What changed in your files, where and when.
//   · Each row is a folder: its latest perFolder files are shown.
//   · Horizontal axis = age (right = most recent), logarithmic scale.
//   · Lit zone = last recentDays days; only those files emit particles.
//   · Curves carry each file to its category (CODE, DOCS, ...).
//   · Bottom panel = latest changes. Click a file or panel item = reveal in Finder;
//     click a folder name = open it.
//
// File structure:
//   1. PURE   Config, layout and data layer. Touches neither DOM nor canvas.
//   2. Übersicht  Exports read by Übersicht (command, className, render).
//   3. Canvas  Drawing helpers and one draw function per section.
//   4. Loop    Interaction (mouse) and animation loop.
// ============================================================================
import { run } from 'uebersicht';

/* PURE:START — no DOM or canvas */

// ─── 1. Config (usually the only part you need to edit) ─────────────────────
const CONFIG = {
  syncDir: '/Users/TU_USUARIO/Google Drive',  // Synced folder (absolute path, no extra quotes)
  homeDir: '/Users/TU_USUARIO',             // Only used to shorten paths as "~/..."
  perFolder: 25,                       // Latest N files per folder
  syncRows: 12,                         // Max folders from the synced dir
  otherRows: 12,                       // Max folders from the rest of the system
  recentDays: 7,                       // "Recent" window (lit zone and particles)
  maxEmitters: 220,                    // Max files that emit particles
  panelItems: 8,                       // Files in "Latest changes"
  refreshMs: 2 * 60 * 1000,
  scan: {
    syncDepth: 5, syncLimit: 6000,     // synced dir: depth and max files read
    otherDirs: ['~/Documents', '~/Downloads', '~/Desktop', '~/Developer', '~/Pictures', '~/Movies'],
    otherDepth: 4, otherLimit: 4000,   // Rest: depth and max files read
    exclude: ['*/.*', '*/node_modules/*', '*/Library/*', '*/DerivedData/*'],
  },
};

const SYNC_LABEL = CONFIG.syncDir.split('/').pop();
const DAY = 86400;
const RECENT_SEC = CONFIG.recentDays * DAY;
const RECENT_PHRASE = CONFIG.recentDays === 7 ? 'this week' : `in ${CONFIG.recentDays} d`;
const SEP = '  ·  ';
const DRIVE_PREFIX = '#DRIVE|';        // Special line prepended by the command
const DRIVE_PROCESS = 'Google Drive';  // Exact process name of the app

// ─── 2. Layout (all positions in one place) ─────────────────────────────────
const LAYOUT = {
  w: 700, h: 630, margin: 22,
  header: { baseline: 22, dotY: 18, titleDotX: 128, statsX: 138 },
  plot: {
    x0: 108, x1: 300,                  // Scatter area (folder names go to the left)
    inset: 12,                         // Gap between "today" and the right edge
    top: 52, rowTop: 62, rowBot: 388, axisY: 398, captionY: 46,
    blockGap: 12,                      // Gap between the synced block and the rest
    dividerX0: 14,
  },
  rowLabel: { x: 24, ringX: 15, maxW: 56, countGap: 8, textDy: 3.3 },
  cat: { x: 470, y0: 84, step: 55 },
  panel: { dividerY: 432, titleY: 450, top: 458, itemH: 34, itemStep: 38, colW: 322, colX: [22, 356], perCol: 4 },
  footerY: 620,
};
const W = LAYOUT.w, H = LAYOUT.h;
const X0 = LAYOUT.plot.x0, X1 = LAYOUT.plot.x1;
const NODE_X = LAYOUT.cat.x;
const CURVE_MID_X = (X1 + NODE_X) / 2;         // Horizontal control point of the curves
const AGE_SCALE_DAYS = 1500;                   // Age spanned by the whole axis (log)

const AXIS_TICKS = [
  [0, 'today'],
  [CONFIG.recentDays, `${CONFIG.recentDays} d`],
  [30, '30 d'],
  [90, '90 d'],
  [365, '1 y'],
];

// Bubble geometry: max radius ~10 px so bubbles don't invade neighbouring rows
const BUBBLE_SIZE = { min: 1.6, range: 8.5, logScale: 9, exponent: 2 };
const bubbleRadius = bytes => BUBBLE_SIZE.min + Math.pow(Math.log10(bytes + 1) / BUBBLE_SIZE.logScale, BUBBLE_SIZE.exponent) * BUBBLE_SIZE.range;
// Deterministic jitter (no randomness) so bubbles in a row don't line up
const jitterY = i => (((i * 37) % 9) - 4) * 0.7;
const jitterX = i => (i * 53) % 6;

// Particles: the more recent, the faster and brighter
const PARTICLE = {
  lineShare: 0.3,                      // Share of the path travelled in a straight line before the curve
  vMin: 0.0035, vRange: 0.007,         // Speed per frame
  startWait: 2, waitMin: 0.3, waitRange: 1.2,
  alphaMin: 0.45, alphaRange: 0.5, sizeMin: 1.1, sizeRange: 1.4, fadeEdge: 0.08,
};

// Mouse-sensitive zones
const HIT = { bubblePad: 6, labelXMin: 8, labelXMaxGap: 2, labelMinTolerance: 6 };

// ─── 3. Categories ─────────────────────────────────────────────────────────
// Each extension must appear in exactly ONE category.
const CATEGORIES = [
  { name: 'CODE',   color: '#8b2cf5', ext: 'js jsx ts tsx py rb go rs swift c cpp h m java kt sh json html css yml yaml toml sql ipynb zig' },
  { name: 'DOCS',   color: '#e04455', ext: 'pdf doc docx pages txt rtf key numbers xls xlsx csv ppt pptx epub md org' },
  { name: 'DESIGN', color: '#ff9f43', ext: 'ai psd psb eps indd idml fig sketch xd afdesign afphoto svg ttf otf woff woff2 blend c4d prproj aep' },
  { name: 'IMAGES', color: '#6ee7d0', ext: 'jpg jpeg png gif heic heif webp tif tiff raw dng cr2 cr3 nef arw bmp avif icns' },
  { name: 'AV',     color: '#a3e635', ext: 'mov mp4 mkv avi m4v webm mp3 wav m4a flac aif aiff aac ogg logicx' },
  { name: 'OTHER',  color: '#5b6fc4', ext: '' },
];
const OTHER = CATEGORIES.length - 1;
const CAT_Y = CATEGORIES.map((_, i) => LAYOUT.cat.y0 + i * LAYOUT.cat.step);

// Map (not a plain object) so a file named "constructor" is not mistaken for a property
const EXT_TO_CAT = new Map();
CATEGORIES.forEach((c, i) => c.ext.split(' ').filter(Boolean).forEach(e => EXT_TO_CAT.set(e, i)));

// ─── 4. Text formatting ────────────────────────────────────────────────────
const fmtBytes = b => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? (b / 1e3).toFixed(0) + ' KB' : b + ' B');

const agoText = sec => {
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < DAY) return `${Math.floor(sec / 3600)} h ago`;
  const d = Math.floor(sec / DAY);
  if (d < 30) return `${d} d ago`;
  if (d < 365) { const m = Math.floor(d / 30); return `${m} mo ago`; }
  return `${(d / 365).toFixed(1)} y ago`;
};

const shortAgo = sec => {
  if (sec < 60) return 'now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < DAY) return `${Math.floor(sec / 3600)} h`;
  const d = Math.floor(sec / DAY);
  if (d < 30) return `${d} d`;
  if (d < 365) return `${Math.floor(d / 30)} mo`;
  return `${(d / 365).toFixed(1)} y`;
};

const shortPath = p => (p.indexOf(CONFIG.homeDir) === 0 ? '~' + p.slice(CONFIG.homeDir.length) : p);
const folderName = p => (p === CONFIG.syncDir ? SYNC_LABEL : p.split('/').pop() || '/');

// ─── 5. Data layer (pure functions) ─────────────────────────────────────────

// Shell command: "#DRIVE|1/0" line + most recent files first (sort BEFORE head)
function buildCommand(cfg = CONFIG) {
  const { scan } = cfg;
  const excludes = scan.exclude.map(p => `-not -path '${p}'`).join(' ');
  const find = (dirs, depth, limit) =>
    `find ${dirs} -maxdepth ${depth} -type f ${excludes} -exec stat -f "%z|%m|%N" {} + 2>/dev/null | sort -t'|' -k2,2nr | head -${limit}`;
  const driveCheck = `echo "${DRIVE_PREFIX}$(pgrep -x '${DRIVE_PROCESS}' >/dev/null && echo 1 || echo 0)"`;
  return `(${driveCheck}; ${find(`"${cfg.syncDir}"`, scan.syncDepth, scan.syncLimit)}; ${find(scan.otherDirs.join(' '), scan.otherDepth, scan.otherLimit)})`;
}

// "size|mtime|path" -> record, or null if the line is invalid (the path may contain "|")
function parseLine(line) {
  const p = line.split('|');
  if (p.length < 3) return null;
  const size = Number(p[0]), mtime = Number(p[1]);
  if (!Number.isFinite(size) || !Number.isFinite(mtime)) return null;
  return { size, mtime, path: p.slice(2).join('|') };
}

function describeFile({ size, mtime, path }) {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  const folder = parts.slice(0, -1).join('/') || '/';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const cat = EXT_TO_CAT.has(ext) ? EXT_TO_CAT.get(ext) : OTHER;
  const sync = path.indexOf(CONFIG.syncDir + '/') === 0;
  return { size, mtime, path, name, folder, cat, sync, key: (sync ? '1' : '0') + '|' + folder };
}

// Full command output -> { files, drive }  (drive: true / false / null if unknown)
function parseOutput(output) {
  const files = [];
  let drive = null;
  (output || '').split('\n').forEach(line => {
    if (!line) return;
    if (line.indexOf(DRIVE_PREFIX) === 0) { drive = line.slice(DRIVE_PREFIX.length).trim() === '1'; return; }
    const rec = parseLine(line);
    if (rec) files.push(describeFile(rec));
  });
  return { files, drive };
}

// Per-category totals and recent changes (over ALL files read, not just those drawn)
function summarize(files, nowSec) {
  const cats = CATEGORIES.map(() => ({ n: 0, bytes: 0, week: 0 }));
  let week = 0, weekSync = 0;
  files.forEach(f => {
    const c = cats[f.cat];
    c.n++;
    c.bytes += f.size;
    if (nowSec - f.mtime <= RECENT_SEC) { c.week++; week++; if (f.sync) weekSync++; }
  });
  return { cats, week, weekSync };
}

// One row per folder, with its latest perFolder files
function groupByFolder(files, nowSec) {
  const groups = new Map();
  files.forEach(f => {
    if (!groups.has(f.key)) groups.set(f.key, []);
    groups.get(f.key).push(f);
  });
  return [...groups.values()].map(g => {
    g.sort((a, b) => b.mtime - a.mtime);
    const shown = g.slice(0, CONFIG.perFolder);
    return {
      key: g[0].key, path: g[0].folder, sync: g[0].sync,
      total: g.length, shown: shown.length,
      week: g.filter(f => nowSec - f.mtime <= RECENT_SEC).length,
      last: g[0].mtime, files: shown,
    };
  });
}

// Label = last folder of the path; if two collide, "parent/folder"
function assignLabels(rows) {
  const counts = new Map();
  rows.forEach(r => {
    r.label = folderName(r.path);
    counts.set(r.label, (counts.get(r.label) || 0) + 1);
  });
  rows.forEach(r => {
    if (counts.get(r.label) > 1) r.label = r.path.split('/').slice(-2).join('/');
  });
}

// Pick the most active folders of each group and sort them: synced first, then the rest, alphabetical
function selectRows(rows) {
  const byRecent = (a, b) => b.last - a.last;
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  const sync = rows.filter(r => r.sync).sort(byRecent).slice(0, CONFIG.syncRows);
  const other = rows.filter(r => !r.sync).sort(byRecent).slice(0, CONFIG.otherRows);
  assignLabels(sync.concat(other));
  return { rows: sync.sort(byLabel).concat(other.sort(byLabel)), syncCount: sync.length };
}

// Assign each row's Y coordinate; leave a gap between the synced block and the rest
function layoutRows(rows, syncCount) {
  const { rowTop, rowBot, blockGap } = LAYOUT.plot;
  const n = rows.length;
  const hasBothBlocks = syncCount > 0 && n - syncCount > 0;
  const gap = hasBothBlocks ? blockGap : 0;
  const step = n > 1 ? (rowBot - rowTop - gap) / (n - 1) : 30;
  rows.forEach((r, i) => {
    r.sy = n > 1 ? rowTop + i * step + (i >= syncCount ? gap : 0) : (rowTop + rowBot) / 2;
  });
  const dividerY = hasBothBlocks ? (rows[syncCount - 1].sy + rows[syncCount].sy) / 2 : null;
  return { step, dividerY };
}

// Position and size of each bubble
function placeFiles(rows, nowSec) {
  const files = [];
  rows.forEach(r => r.files.forEach(f => { f.row = r; files.push(f); }));
  files.forEach((f, i) => {
    f.plotted = true;
    f.sy = f.row.sy;
    f.y = f.sy + jitterY(i);
    f.age = Math.max(0, (nowSec - f.mtime) / DAY);
    f.x = xAge(f.age) - jitterX(i);
    f.r = bubbleRadius(f.size);
    f.cy = CAT_Y[f.cat];
  });
  return files;
}

// Only files from the last recentDays days emit particles
function buildEmitters(files, rand = Math.random) {
  return files
    .filter(f => f.age <= CONFIG.recentDays)
    .sort((a, b) => a.age - b.age)
    .slice(0, CONFIG.maxEmitters)
    .map(f => {
      const fresh = 1 - f.age / CONFIG.recentDays;
      return { f, fresh, t: -rand() * PARTICLE.startWait, v: PARTICLE.vMin + PARTICLE.vRange * fresh };
    });
}

// Advance particles one frame; after finishing the path they wait a while before restarting
function stepEmitters(emitters, rand = Math.random) {
  emitters.forEach(e => {
    e.t += e.v;
    if (e.t > 1) e.t = -(PARTICLE.waitMin + rand() * PARTICLE.waitRange);
  });
}

const latestFiles = (files, n) => files.slice().sort((a, b) => b.mtime - a.mtime).slice(0, n);

// Command output -> everything needed to draw
function buildState(output, nowSec, rand = Math.random) {
  const { files: all, drive } = parseOutput(output);
  const { cats, week, weekSync } = summarize(all, nowSec);
  const selected = selectRows(groupByFolder(all, nowSec));
  const { step, dividerY } = layoutRows(selected.rows, selected.syncCount);
  const files = placeFiles(selected.rows, nowSec);
  return {
    files, rows: selected.rows, cats,
    recent: latestFiles(all, CONFIG.panelItems),
    emitters: buildEmitters(files, rand),
    total: all.length, week, weekSync, drive,
    rowStep: step, dividerY,
  };
}

const emptyState = () => ({
  files: [], rows: [], cats: [], recent: [], emitters: [],
  total: 0, week: 0, weekSync: 0, drive: null,
  rowStep: 30, dividerY: null, backdrop: null, raw: null,
});

// ─── 6. Geometry shared by drawing and interaction ──────────────────────────

// Horizontal position by age (log): right = most recent
function xAge(ageDays) {
  const { x0, x1, inset } = LAYOUT.plot;
  const t = Math.min(1, Math.log10(1 + ageDays) / Math.log10(1 + AGE_SCALE_DAYS));
  return x0 + (1 - t) * (x1 - x0 - inset);
}

// Point on the Bézier curve bubble -> category node (t from 0 to 1)
function curveToCategory(f, t) {
  const u = 1 - t;
  const x = u * u * u * X1 + 3 * u * u * t * CURVE_MID_X + 3 * u * t * t * CURVE_MID_X + t * t * t * NODE_X;
  const y = u * u * u * f.sy + 3 * u * u * t * f.sy + 3 * u * t * t * f.cy + t * t * t * f.cy;
  return [x, y];
}

// Full particle path: bubble -> straight run to the axis -> curve to the category
function flowPoint(f, u) {
  const k = PARTICLE.lineShare;
  if (u < k) {
    const s = u / k;
    return [f.x + (X1 - f.x) * s, f.y + (f.sy - f.y) * s];
  }
  return curveToCategory(f, (u - k) / (1 - k));
}

function panelRect(i) {
  const p = LAYOUT.panel;
  return { x: p.colX[Math.floor(i / p.perCol)], y: p.top + (i % p.perCol) * p.itemStep, w: p.colW, h: p.itemH };
}

// ─── 7. Interaction (pure functions) ────────────────────────────────────────
const insideRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function nearestBubble(files, mx, my) {
  let best = null, bestDist = Infinity;
  files.forEach(f => {
    const d = Math.hypot(f.x - mx, f.y - my);
    if (d < f.r + HIT.bubblePad && d < bestDist) { bestDist = d; best = f; }
  });
  return best;
}

function rowAtLabel(state, mx, my) {
  if (!(mx > HIT.labelXMin && mx < X0 - HIT.labelXMaxGap)) return null;
  let best = null, bestDist = Infinity;
  state.rows.forEach(r => {
    const d = Math.abs(r.sy - my);
    if (d < bestDist) { bestDist = d; best = r; }
  });
  return best && bestDist <= Math.max(HIT.labelMinTolerance, state.rowStep / 2) ? best : null;
}

// Priority: panel > bubble > folder name
function hitTest(state, mx, my) {
  const idx = state.recent.findIndex((_, i) => insideRect(panelRect(i), mx, my));
  if (idx >= 0) {
    const item = state.recent[idx];
    return { kind: 'panel', item, f: item.plotted ? item : null, mx, my };
  }
  const bubble = nearestBubble(state.files, mx, my);
  if (bubble) return { kind: 'file', f: bubble, mx, my };
  const row = rowAtLabel(state, mx, my);
  return row ? { kind: 'row', row, mx, my } : null;
}

// Which file/row to highlight and whether to dim the rest
function focusOf(hover) {
  if (!hover) return { file: null, row: null, dimRow: null };
  const file = hover.f || null;
  const isRow = hover.kind === 'row';
  return { file, row: isRow ? hover.row : file ? file.row : null, dimRow: isRow ? hover.row : null };
}

// Tooltip content (4 lines); null if that hover kind has no tooltip
function describeHover(hover, state, nowSec) {
  if (hover.kind === 'file') {
    const f = hover.f;
    const driveWarn = f.sync && state.drive === false;
    return {
      color: CATEGORIES[f.cat].color,
      warnLast: driveWarn,
      lines: [
        f.name,
        shortPath(f.folder),
        [fmtBytes(f.size), agoText(nowSec - f.mtime), CATEGORIES[f.cat].name].concat(f.sync ? [SYNC_LABEL] : []).join(SEP),
        (driveWarn ? 'Google Drive is closed' + SEP : '') + 'click: reveal in Finder',
      ],
    };
  }
  if (hover.kind === 'row') {
    const r = hover.row;
    return {
      color: r.sync ? '#ffffff' : '#9aa4c7',
      warnLast: false,
      lines: [
        r.label,
        shortPath(r.path),
        `${r.shown} of ${r.total} files${SEP}last change ${agoText(nowSec - r.last)}`,
        `${r.week} changes in ${CONFIG.recentDays} days${SEP}click: open folder`,
      ],
    };
  }
  return null;
}

/* PURE:END */

// ============================================================================
// Übersicht: what the widget engine reads
// ============================================================================
export const refreshFrequency = CONFIG.refreshMs;
export const command = buildCommand();
export const className = `
  top: 10px;
  left: 10px;
  width: ${W}px;
  height: ${H}px;
  background: rgba(15, 18, 24, 0.22);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border: 0px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 10px 20px -10px rgba(0, 0, 0, 0.19), inset 0 1px 0 rgba(255, 255, 255, 0.01);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  canvas { display: block; pointer-events: auto; }
`;

// ============================================================================
// Canvas: style and drawing helpers
// ============================================================================
const TAU = Math.PI * 2;
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif';

// White text in five emphasis levels
const INK = { max: 0.95, strong: 0.8, body: 0.6, muted: 0.45, faint: 0.3 };
// Opacity of lines and backgrounds
const LINE = { band: 0.035, grid: 0.045, lane: 0.035, laneFocus: 0.16, divider: 0.1, axis: 0.12, tick: 0.25, panelDivider: 0.08 };
const COLORS = { ok: [16, 185, 129], warn: [245, 158, 11], tooltipBg: 'rgba(15,17,24,0.86)' };

const BUBBLE = { recentAlpha: 0.88, oldAlpha: 0.4, hoverAlpha: 0.98, dimFactor: 0.3, breathe: 0.04, pulseGap: 3.8, haloGap: 2, haloMinRadius: 5 };
const CAT_NODE = { glowRadius: 16, dotRadius: 4.5, dotPulse: 0.5, labelDx: 14, nameDy: -5, statsDy: 8, weekDy: 21 };
// Background curve per file: faint if old, stronger if recent
const BACKDROP = { scale: 2, old: { alpha: 0.07, width: 0.8 }, recent: { alpha: 0.22, width: 1 } };
// Focused file's curve: wide glow + thin stroke
const FOCUS_STROKES = [{ alpha: 0.35, width: 3.5 }, { alpha: 0.95, width: 1.4 }];
const TOOLTIP = { maxTextW: 300, padX: 30, h: 68, offsetX: 14, offsetY: 8, edge: 10 };

const ink = a => `rgba(255,255,255,${a})`;
const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const fontOf = (weight, size) => `${weight} ${size}px ${FONT_FAMILY}`;

function text(ctx, str, x, y, { size = 10, weight = 400, color, align = 'left' }) {
  ctx.font = fontOf(weight, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}
function textWidth(ctx, str, size, weight = 400) {
  ctx.font = fontOf(weight, size);
  return ctx.measureText(str).width;
}
// Trim with "…" at the end / start until it fits in maxW
function fitText(ctx, str, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(str).width <= maxW) return str;
  let lo = 0, hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(str.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return str.slice(0, lo) + '…';
}
function fitTextStart(ctx, str, maxW, font) {
  ctx.font = font;
  let t = str;
  while (t.length > 1 && ctx.measureText('…' + t).width > maxW) t = t.slice(1);
  return t === str ? str : '…' + t;
}
function fillCircle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function strokeCircle(ctx, x, y, r, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}
function strokeLine(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
function fillRoundRect(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color; roundRectPath(ctx, x, y, w, h, r); ctx.fill();
}
function strokeRoundRect(ctx, x, y, w, h, r, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; roundRectPath(ctx, x, y, w, h, r); ctx.stroke();
}

// Background curves, drawn ONCE per data update on an auxiliary double-resolution canvas
function paintBackdrop(files) {
  const canvas = document.createElement('canvas');
  canvas.width = W * BACKDROP.scale; canvas.height = H * BACKDROP.scale;
  const g = canvas.getContext('2d');
  g.scale(BACKDROP.scale, BACKDROP.scale);
  [false, true].forEach(isRecent => {
    const style = isRecent ? BACKDROP.recent : BACKDROP.old;
    g.lineWidth = style.width;
    files.filter(f => (f.age <= CONFIG.recentDays) === isRecent).forEach(f => {
      g.strokeStyle = hexA(CATEGORIES[f.cat].color, style.alpha);
      g.beginPath();
      g.moveTo(X1, f.sy);
      g.bezierCurveTo(CURVE_MID_X, f.sy, CURVE_MID_X, f.cy, NODE_X, f.cy);
      g.stroke();
    });
  });
  return canvas;
}

// ============================================================================
// Canvas: one draw function per section
// ============================================================================

function drawHeader(ctx, s) {
  const { margin, header } = LAYOUT;
  text(ctx, 'File Flow', margin, header.baseline, { size: 12.5, weight: 600, color: ink(INK.max) });
  fillCircle(ctx, header.titleDotX, header.dotY, 2.5, rgba(COLORS.ok, 1));
  const stats = [`${s.week} changes ${RECENT_PHRASE}`, `${s.weekSync} in ${SYNC_LABEL}`, `${s.total.toLocaleString()} files read`].join(SEP);
  text(ctx, stats, header.statsX, header.baseline, { size: 11, color: ink(INK.muted) });

  // Right legend: Google Drive status and synced-dir ring (right to left)
  let x = W - margin;
  if (s.drive !== null) {
    const label = s.drive ? 'Drive open' : 'Drive closed';
    const color = rgba(s.drive ? COLORS.ok : COLORS.warn, 0.92);
    text(ctx, label, x, header.baseline, { size: 10.5, weight: 500, color, align: 'right' });
    const w = textWidth(ctx, label, 10.5, 500);
    fillCircle(ctx, x - w - 9, header.dotY, 2.5, color);
    x -= w + 28;
  }
  text(ctx, SYNC_LABEL, x, header.baseline, { size: 10.5, weight: 500, color: ink(INK.body), align: 'right' });
  const w = textWidth(ctx, SYNC_LABEL, 10.5, 500);
  strokeCircle(ctx, x - w - 10, header.dotY, 4, ink(0.85), 1.2);
}

function drawEmpty(ctx, s) {
  text(ctx, s.raw ? 'No files to show' : 'Scanning files…', W / 2, H / 2, { size: 12, color: ink(INK.muted), align: 'center' });
}

// Last-week zone, grid, row lanes and time axis
function drawPlotBackground(ctx, s, focusRow) {
  const { top, axisY, captionY, dividerX0 } = LAYOUT.plot;
  const { x: labelX, countGap } = LAYOUT.rowLabel;
  const xWeek = xAge(CONFIG.recentDays);

  ctx.fillStyle = ink(LINE.band);
  ctx.fillRect(xWeek, top, X1 - xWeek, axisY - top);

  const caption = { size: 8.5, color: ink(INK.faint) };
  text(ctx, 'FOLDER', labelX, captionY, caption);
  text(ctx, `${CONFIG.recentDays} D`, X0 - countGap, captionY, { ...caption, align: 'right' });
  text(ctx, RECENT_PHRASE.toUpperCase(), (xWeek + X1) / 2, captionY, { size: 8.5, color: ink(INK.muted), align: 'center' });

  AXIS_TICKS.forEach(([days]) => strokeLine(ctx, xAge(days), top, xAge(days), axisY, ink(LINE.grid)));
  s.rows.forEach(r => strokeLine(ctx, X0, r.sy, X1, r.sy, ink(r === focusRow ? LINE.laneFocus : LINE.lane)));

  if (s.dividerY !== null) {
    ctx.setLineDash([2, 3]);
    strokeLine(ctx, dividerX0, s.dividerY, X1, s.dividerY, ink(LINE.divider));
    ctx.setLineDash([]);
  }

  strokeLine(ctx, X0, axisY, X1, axisY, ink(LINE.axis));
  strokeLine(ctx, X1, top, X1, axisY, ink(LINE.axis));
  AXIS_TICKS.forEach(([days, label]) => {
    strokeLine(ctx, xAge(days), axisY, xAge(days), axisY + 3, ink(LINE.tick));
    text(ctx, label, xAge(days), axisY + 14, { size: 9, color: ink(INK.muted), align: 'center' });
  });
}

const rowLabelCache = new WeakMap();   // Already-trimmed text of each row (measuring every frame is unnecessary)
function fittedRowLabel(ctx, row) {
  if (!rowLabelCache.has(row)) rowLabelCache.set(row, fitText(ctx, row.label, LAYOUT.rowLabel.maxW, fontOf(500, 9.5)));
  return rowLabelCache.get(row);
}

// Folder name, ring if synced, and number of recent changes
function drawRowLabels(ctx, s, focusRow) {
  const { x, ringX, countGap, textDy } = LAYOUT.rowLabel;
  s.rows.forEach(r => {
    const active = r === focusRow;
    text(ctx, fittedRowLabel(ctx, r), x, r.sy + textDy, { size: 9.5, weight: 500, color: ink(active ? INK.max : INK.body) });
    if (r.sync) strokeCircle(ctx, ringX, r.sy, 2.6, ink(active ? 0.95 : 0.5), 1);
    if (r.week > 0) {
      text(ctx, String(r.week), X0 - countGap, r.sy + textDy, { size: 9, weight: 600, color: ink(active ? INK.max : INK.strong), align: 'right' });
    }
  });
}

function traceFlowPath(ctx, f) {
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(X1, f.sy);
  ctx.bezierCurveTo(CURVE_MID_X, f.sy, CURVE_MID_X, f.cy, NODE_X, f.cy);
}

function drawFocusCurve(ctx, f) {
  FOCUS_STROKES.forEach(({ alpha, width }) => {
    ctx.strokeStyle = hexA(CATEGORIES[f.cat].color, alpha);
    ctx.lineWidth = width;
    traceFlowPath(ctx, f);
    ctx.stroke();
  });
}

function drawParticles(ctx, emitters) {
  emitters.forEach(e => {
    if (e.t < 0) return;                                         // waiting for its turn
    const [x, y] = flowPoint(e.f, e.t);
    const fade = Math.min(1, e.t / PARTICLE.fadeEdge, (1 - e.t) / PARTICLE.fadeEdge);
    const alpha = (PARTICLE.alphaMin + PARTICLE.alphaRange * e.fresh) * fade;
    fillCircle(ctx, x, y, PARTICLE.sizeMin + PARTICLE.sizeRange * e.fresh, hexA(CATEGORIES[e.f.cat].color, alpha));
  });
}

// Bright = recent, faint = old
function drawBubbles(ctx, s, T, focus) {
  s.files.forEach((f, i) => {
    const hovered = focus.file === f;
    const recent = f.age <= CONFIG.recentDays;
    const r = f.r * (1 + Math.sin(T * 1.2 + i * 0.7) * BUBBLE.breathe);
    const color = CATEGORIES[f.cat].color;
    let alpha = hovered ? BUBBLE.hoverAlpha : recent ? BUBBLE.recentAlpha : BUBBLE.oldAlpha;
    if (focus.dimRow && f.row !== focus.dimRow) alpha *= BUBBLE.dimFactor;

    fillCircle(ctx, f.x, f.y, r, hexA(color, alpha));

    if (f.age < 1) {                                             // modified in the last 24 h: pulse
      strokeCircle(ctx, f.x, f.y, r + BUBBLE.pulseGap, hexA(color, 0.25 + 0.2 * Math.sin(T * 3 + i)), 1);
    }
    if (f.sync && (f.r > BUBBLE.haloMinRadius || hovered)) {     // white ring: file in the synced dir
      strokeCircle(ctx, f.x, f.y, r + BUBBLE.haloGap, ink(hovered ? 0.95 : 0.35), hovered ? 1.2 : 0.8);
    }
    if (hovered) {                                               // marks where the curve leaves the axis
      ctx.fillStyle = color;
      ctx.fillRect(X1 - 1.5, f.sy - 1.5, 3, 3);
    }
  });
}

// Category nodes (right): totals and changes of the week
function drawCategories(ctx, s, T) {
  CATEGORIES.forEach((c, i) => {
    const y = CAT_Y[i];
    const stats = s.cats[i];

    const glow = ctx.createRadialGradient(NODE_X, y, 0, NODE_X, y, CAT_NODE.glowRadius);
    glow.addColorStop(0, hexA(c.color, 0.35));
    glow.addColorStop(1, hexA(c.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(NODE_X, y, CAT_NODE.glowRadius, 0, TAU); ctx.fill();

    fillCircle(ctx, NODE_X, y, CAT_NODE.dotRadius + Math.sin(T * 1.8 + i) * CAT_NODE.dotPulse, c.color);

    const x = NODE_X + CAT_NODE.labelDx;
    text(ctx, c.name, x, y + CAT_NODE.nameDy, { size: 11, weight: 600, color: c.color });
    if (!stats) return;
    text(ctx, `${stats.n.toLocaleString()}${SEP}${fmtBytes(stats.bytes)}`, x, y + CAT_NODE.statsDy, { size: 10, color: ink(INK.body) });
    text(ctx, stats.week > 0 ? `+${stats.week} ${RECENT_PHRASE}` : `no changes in ${CONFIG.recentDays} d`, x, y + CAT_NODE.weekDy, {
      size: 9.5, weight: 500, color: stats.week > 0 ? hexA(c.color, 0.95) : ink(INK.faint),
    });
  });
}

function drawPanel(ctx, s, hover, nowSec) {
  const { margin } = LAYOUT;
  const { dividerY, titleY } = LAYOUT.panel;
  strokeLine(ctx, margin, dividerY, W - margin, dividerY, ink(LINE.panelDivider));
  text(ctx, 'Latest changes', margin, titleY, { size: 11, weight: 600, color: ink(INK.max) });
  text(ctx, 'click to reveal in Finder', W - margin, titleY, { size: 9.5, color: ink(INK.faint), align: 'right' });

  s.recent.forEach((item, i) => {
    const r = panelRect(i);
    const color = CATEGORIES[item.cat].color;
    const secs = nowSec - item.mtime;
    if (hover && hover.kind === 'panel' && hover.item === item) {
      fillRoundRect(ctx, r.x - 6, r.y - 3, r.w + 12, r.h + 2, 7, ink(0.07));
    }
    fillRoundRect(ctx, r.x, r.y + 2, 3, r.h - 8, 1.5, color);

    text(ctx, shortAgo(secs), r.x + r.w - 2, r.y + 13, { size: 10, weight: 500, color: secs < 3600 ? hexA(color, 1) : ink(INK.body), align: 'right' });
    text(ctx, fitText(ctx, item.name, r.w - 74, fontOf(600, 10.5)), r.x + 12, r.y + 13, { size: 10.5, weight: 600, color: ink(INK.max) });
    const sub = [folderName(item.folder), fmtBytes(item.size)].concat(item.sync ? [SYNC_LABEL] : []).join(SEP);
    text(ctx, fitText(ctx, sub, r.w - 20, fontOf(400, 9.5)), r.x + 12, r.y + 27, { size: 9.5, color: ink(INK.muted) });
  });
}

// How to read the chart
function drawFooter(ctx) {
  const legend = [
    'bubble = file (size = file size)',
    'further right = more recent',
    `particles = changes in the last ${CONFIG.recentDays} days`,
    `ring = ${SYNC_LABEL}`,
  ].join(SEP);
  text(ctx, legend, LAYOUT.margin, LAYOUT.footerY, { size: 9, color: ink(INK.faint) });
}

function drawTooltip(ctx, tip, hover) {
  const [title, where, meta, action] = tip.lines;
  const shownTitle = fitText(ctx, title, TOOLTIP.maxTextW, fontOf(600, 11));
  const shownWhere = fitTextStart(ctx, where, TOOLTIP.maxTextW, fontOf(400, 10));
  const widest = Math.max(
    textWidth(ctx, shownTitle, 11, 600),
    textWidth(ctx, shownWhere, 10), textWidth(ctx, meta, 10), textWidth(ctx, action, 10)
  );
  const w = Math.min(widest + TOOLTIP.padX, TOOLTIP.maxTextW + TOOLTIP.padX), h = TOOLTIP.h;
  const x = Math.min(hover.mx + TOOLTIP.offsetX, W - w - TOOLTIP.edge);
  const y = Math.max(hover.my - h - TOOLTIP.offsetY, TOOLTIP.edge);

  fillRoundRect(ctx, x, y, w, h, 10, COLORS.tooltipBg);
  strokeRoundRect(ctx, x, y, w, h, 10, ink(0.12), 1);
  fillRoundRect(ctx, x + 8, y + 12, 3, h - 24, 1.5, tip.color);

  const tx = x + 18;
  text(ctx, shownTitle, tx, y + 19, { size: 11, weight: 600, color: '#FFFFFF' });
  text(ctx, shownWhere, tx, y + 34, { size: 10, color: ink(INK.body) });
  text(ctx, meta, tx, y + 47, { size: 10, color: ink(INK.body) });
  text(ctx, action, tx, y + 60, { size: 10, color: tip.warnLast ? rgba(COLORS.warn, 0.95) : ink(INK.muted) });
}

// ============================================================================
// State, interaction and animation loop
// ============================================================================
const store = { state: emptyState(), hover: null, canvas: null };

const shellQuote = s => "'" + s.replace(/'/g, "'\\''") + "'";
const shell = cmd => { try { run(cmd); } catch (e) { /* no action if Übersicht cannot run it */ } };
const revealInFinder = path => shell(`open -R ${shellQuote(path)}`);
const openFolder = path => shell(`open ${shellQuote(path)}`);

function activate(hover) {
  if (!hover) return;
  if (hover.kind === 'file') revealInFinder(hover.f.path);
  else if (hover.kind === 'panel') revealInFinder(hover.item.path);
  else if (hover.kind === 'row') openFolder(hover.row.path);
}

function bindPointer(canvas) {
  canvas.onmousemove = e => {
    const b = canvas.getBoundingClientRect();
    const mx = (e.clientX - b.left) * (W / b.width), my = (e.clientY - b.top) * (H / b.height);
    store.hover = hitTest(store.state, mx, my);
    canvas.style.cursor = store.hover ? 'pointer' : 'default';
  };
  canvas.onmouseleave = () => { store.hover = null; canvas.style.cursor = 'default'; };
  canvas.onclick = () => activate(store.hover);
}

function renderFrame(ctx, T) {
  const s = store.state, hover = store.hover;
  const nowSec = Date.now() / 1000;
  ctx.clearRect(0, 0, W, H);

  drawHeader(ctx, s);
  if (!s.files.length) { drawEmpty(ctx, s); return; }

  const focus = focusOf(hover);
  stepEmitters(s.emitters);

  drawPlotBackground(ctx, s, focus.row);
  drawRowLabels(ctx, s, focus.row);
  if (s.backdrop) ctx.drawImage(s.backdrop, 0, 0, W, H);
  if (focus.file) drawFocusCurve(ctx, focus.file);
  drawParticles(ctx, s.emitters);
  drawBubbles(ctx, s, T, focus);
  drawCategories(ctx, s, T);
  drawPanel(ctx, s, hover, nowSec);
  drawFooter(ctx);

  const tip = hover && describeHover(hover, s, nowSec);
  if (tip) drawTooltip(ctx, tip, hover);
}

function start(canvas) {
  if (store.canvas === canvas) return;
  store.canvas = canvas;
  cancelAnimationFrame(window.__fileFlowRaf || 0);

  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineJoin = 'round';

  bindPointer(canvas);

  const loop = ts => {
    renderFrame(ctx, ts / 1000);
    window.__fileFlowRaf = requestAnimationFrame(loop);
  };
  window.__fileFlowRaf = requestAnimationFrame(loop);
}

// Each Übersicht refresh delivers a new `output`; state is only recomputed if it changed
function createState(output) {
  const s = buildState(output, Date.now() / 1000);
  s.backdrop = paintBackdrop(s.files);
  s.raw = output;
  return s;
}

export const render = ({ output }) => {
  if (output && output !== store.state.raw) {
    store.state = createState(output);
    store.hover = null;
  }
  return <canvas width={W} height={H} ref={c => c && start(c)} />;
};
