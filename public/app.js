/**
 * Мини-приложение: доска на 96 клеток, лобби, realtime через WebSocket,
 * тренировка с ботами на клиентском движке.
 */
import { Game } from './engine/game.js?v=18';
import * as B from './engine/board.js?v=18';
import { chooseMove } from './engine/ai.js?v=18';
import { CONFIG } from './config.js?v=18';
import {
  cellGeom,
  cellQuadPoints,
  cellQuadString,
  boardBounds,
  cellSize,
  hubPolygon,
  innerEdge as cellInnerEdge,
  setLayout,
  getLayoutId,
  LAYOUT_LIST,
  wingAngles,
  ribbonMax,
} from './engine/layout.js?v=18';

const tg = window.Telegram?.WebApp || null;
const params = new URLSearchParams(location.search);
const $ = (sel) => document.querySelector(sel);

/* ------------------------------ геометрия доски ---------------------------- */

const hubPointsString = () =>
  hubPolygon()
    .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
    .join(' ');

/** Подпись в центре — по высоте «ступицы» (у разных досок она разная). */
function hubLabelY() {
  const ys = hubPolygon().map((p) => p.y);
  return ((Math.max(...ys) - Math.min(...ys)) * 0.12).toFixed(2);
}

const fmt = (p) =>
  Array.isArray(p)
    ? `${p[0].toFixed(3)},${p[1].toFixed(3)}`
    : `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

/** Лента-складка между двумя склеенными клетками. */
function ribbonPoints(a, b) {
  const [a0, a1] = cellInnerEdge(a);
  const [b0, b1] = cellInnerEdge(b);
  return [a0, a1, b1, b0].map(fmt).join(' ');
}

const TABLE_RADIUS =
  Math.max(
    ...Array.from({ length: B.CELLS }, (_, i) => cellQuadPoints(i).map(([x, y]) => Math.hypot(x, y))).flat(),
  ) + 0.62;

const PIECES = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const WING_NAME = ['Белые', 'Красные', 'Чёрные'];

/* --------------------------------- состояние ------------------------------- */

const state = {
  mode: 'idle',
  ws: null,
  room: null,
  mySeat: -1,
  game: Game.initial(),
  status: 'menu',
  seats: [],
  settings: { clock: 600, inc: 5, level: 'normal' },
  clocks: [0, 0, 0],
  turnStart: 0,
  serverOffset: 0,
  chat: [],
  selected: -1,
  legal: [],
  result: null,
  practice: false,
  local: false,
  botTimer: null,
  config: { botUsername: '', miniAppUrl: location.origin },
  identity: null,
  pendingPromo: null,
  lastMove: null,
  reconnect: 0,
  poll: 0,
  lastStateAt: 0,
  suppressClick: false,
  zen: false,
  zoom: 1,
};

const view = { cells: new Map() };

/* -------------------------------- утилиты --------------------------------- */

function toast(text, ms = 2200) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

function haptic(kind = 'light') {
  try {
    tg?.HapticFeedback?.impactOccurred(kind);
  } catch {}
}

function fmtClock(ms) {
  if (ms == null) return '—';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function myTurn() {
  return (
    !!state.game &&
    state.status === 'playing' &&
    (state.local || state.game.turn === state.mySeat)
  );
}

/** Кто ходит на этом устройстве прямо сейчас (для hot-seat это текущий игрок). */
function activeSeat() {
  return state.local ? state.game.turn : state.mySeat;
}

function seatName(i) {
  const s = state.seats[i];
  if (!s) return WING_NAME[i];
  return s.name || WING_NAME[i];
}

function remaining(wing) {
  const base = state.clocks?.[wing];
  if (base == null) return null;
  if (state.status !== 'playing' || state.practice || state.local) return base;
  if (!state.game || wing !== state.game.turn) return base;
  // сервер списывает время по одному тику за опрос, поэтому между опросами
  // отсчитываем сами — от момента получения состояния
  return Math.max(0, base - (Date.now() - (state.lastStateAt || Date.now())));
}

/* --------------------------------- рендер --------------------------------- */

function renderBoard() {
  const svg = $('#board');
  const g = state.game;
  const parts = [];
  const angle = viewAngle();

  // подложка-«стол»
  parts.push(`<circle class="table" cx="0" cy="0" r="${TABLE_RADIUS.toFixed(2)}"/>`);

  // вся доска поворачивается так, чтобы своя армия была снизу
  parts.push(`<g transform="rotate(${angle} 0 0)">`);

  // центральная «складка»
  parts.push(`<polygon class="center-plate" points="${hubPointsString()}"/>`);


  // ленты шва: какие из них сейчас «работают» при выбранной фигуре
  const activeSeams = new Set();
  for (const m of state.legal) {
    if (B.wingOf(m.to) === B.wingOf(m.from)) continue;
    for (const pair of B.SEAM_PAIRS) {
      const [a, b] = pair;
      const crosses =
        (B.wingOf(a) === B.wingOf(m.from) && B.wingOf(b) === B.wingOf(m.to)) ||
        (B.wingOf(b) === B.wingOf(m.from) && B.wingOf(a) === B.wingOf(m.to));
      if (crosses) activeSeams.add(pair.join('-'));
    }
  }
  const maxRibbon = ribbonMax();
  for (const [a, b] of B.SEAM_PAIRS) {
    const ca = cellGeom(a);
    const cb = cellGeom(b);
    if (Math.hypot(ca.x - cb.x, ca.y - cb.y) > maxRibbon) continue;
    const active = activeSeams.has([a, b].join('-')) ? ' active' : '';
    parts.push(`<polygon class="ribbon${active}" points="${ribbonPoints(a, b)}"/>`);
  }

  // клетки
  for (let i = 0; i < B.CELLS; i++) {
    const shade = B.cellShade(i);
    parts.push(
      `<polygon class="cell wing-${B.wingOf(i)} shade-${shade}" data-cell="${i}" points="${cellQuadString(i)}"/>`,
    );
  }

  // подсветки
  if (state.lastMove) {
    parts.push(`<polygon class="overlay last" points="${cellQuadString(state.lastMove.from)}"/>`);
    parts.push(`<polygon class="overlay last" points="${cellQuadString(state.lastMove.to)}"/>`);
  }
  if (state.selected >= 0) {
    parts.push(`<polygon class="overlay sel" points="${cellQuadString(state.selected)}"/>`);
  }
  if (state.status === 'playing') {
    for (const w of [0, 1, 2]) {
      if (!g.alive[w]) continue;
      const k = g.kingCell(w);
      if (k >= 0 && g.inCheck(w)) parts.push(`<polygon class="overlay check" points="${cellQuadString(k)}"/>`);
    }
  }

  // фигуры (в 3D они рисуются отдельным слоем, чтобы «стоять»)
  if (!state.threeD) {
    for (let i = 0; i < B.CELLS; i++) {
      const p = g.board[i];
      if (!p) continue;
      const c = cellGeom(i);
      const fit = Math.max(0.55, Math.min(1, cellSize(i) / 0.92));
      parts.push(
        `<text class="piece w${p.wing}" transform="rotate(${-angle} ${c.x.toFixed(3)} ${c.y.toFixed(3)})" x="${c.x.toFixed(3)}" y="${(c.y + 0.02).toFixed(3)}" style="font-size:${(0.86 * fit).toFixed(3)}px">${PIECES[p.type]}</text>`,
      );
    }
  }

  // цели
  for (const m of state.legal) {
    if (m.capture) {
      parts.push(`<polygon class="overlay capture" points="${cellQuadString(m.to)}"/>`);
    } else {
      const c = cellGeom(m.to);
      parts.push(`<circle class="overlay target" cx="${c.x.toFixed(3)}" cy="${c.y.toFixed(3)}" r="0.13"/>`);
    }
  }

  // закрываем группу поворота
  parts.push('</g>');

  svg.innerHTML = parts.join('');

  const bb = boardBounds(0.5);
  const z = Math.min(3.4, Math.max(1, state.zoom || 1));
  const cw = bb.w / z;
  const chh = bb.h / z;
  const cx = bb.x + bb.w / 2;
  const cy = bb.y + bb.h / 2;
  svg.setAttribute(
    'viewBox',
    `${(cx - cw / 2).toFixed(2)} ${(cy - chh / 2).toFixed(2)} ${cw.toFixed(2)} ${chh.toFixed(2)}`,
  );
  renderPieces3D();
}

function renderHud() {
  const g = state.game;
  const hud = $('#hud');
  hud.innerHTML = [0, 1, 2]
    .map((w) => {
      const seat = state.seats[w] || {};
      const out = g && !g.alive[w];
      const turn = state.status === 'playing' && g.turn === w;
      const rem = remaining(w);
      const low = rem != null && rem <= 30000 && state.status === 'playing';
      const sub = out
        ? 'вне игры'
        : seat.bot
          ? 'бот'
          : seat.filled
            ? seat.online === false
              ? 'офлайн'
              : 'в игре'
            : 'свободно';
      const isMe = state.mySeat === w && !state.local;
      return `<div class="player ${turn ? 'turn' : ''} ${out ? 'out' : ''} ${isMe ? 'me' : ''}" data-wing="${w}">
        <div class="row"><span class="dot"></span><span class="nm">${escapeHtml(seatName(w))}</span>
        ${isMe ? '<span class="you">вы</span>' : ''}
        <span class="clk ${low ? 'low' : ''}">${rem == null ? '∞' : fmtClock(rem)}</span></div>
        <div class="sub">${WING_NAME[w]} · ${sub}</div>
      </div>`;
    })
    .join('');
}

function renderActions() {
  const box = $('#actions');
  const buttons = [];
  if (state.status === 'playing') {
    if (state.practice) buttons.push(`<button class="btn ghost" data-act="practice-menu">В меню</button>`);
    else buttons.push(`<button class="btn danger" data-act="resign">Сдаться</button>`);
    buttons.push(`<button class="btn" data-act="copy">Пригласить</button>`);
    if (!myTurn() && state.mode === 'online') buttons.push(`<button class="btn ghost" data-act="wait">Ждём ${escapeHtml(WING_NAME[state.game.turn])}</button>`);
  } else if (state.status === 'lobby') {
    buttons.push(`<button class="btn primary" data-act="ready">${state.seats[state.mySeat]?.ready ? 'Не готов' : 'Готов'}</button>`);
    buttons.push(`<button class="btn" data-act="copy">Ссылка</button>`);
  } else {
    buttons.push(`<button class="btn primary" data-act="menu">Играть</button>`);
  }
  box.innerHTML = buttons.join('');
}

function renderMoves() {
  const g = state.game;
  const box = $('#moves');
  if (!g || !g.history.length) {
    box.innerHTML = '<div class="mv" style="color:#8b98a9">Пока пусто — партия ещё не началась.</div>';
    return;
  }
  box.innerHTML = g.history
    .map(
      (h, idx) =>
        `<div class="mv w${h.wing}"><i>${idx + 1}.</i><b>${escapeHtml(h.notation)}</b><span style="color:#8b98a9">${WING_NAME[h.wing].toLowerCase()}</span></div>`,
    )
    .join('');
  box.scrollTop = box.scrollHeight;
}

function renderChat() {
  const box = $('#chat');
  box.innerHTML = state.chat
    .map((m) =>
      m.id === 'system'
        ? `<div class="chat-msg sys">${escapeHtml(m.text)}</div>`
        : `<div class="chat-msg"><span class="who">${escapeHtml(m.name || 'Игрок')}</span>${escapeHtml(m.text)}</div>`,
    )
    .join('');
  box.scrollTop = box.scrollHeight;
}

function renderAll() {
  applyTheme();
  renderBoard();
  renderHud();
  renderActions();
  renderMoves();
  renderChat();
  $('#room-code').textContent = state.room || '—';
  $('#status-chip').textContent =
    state.mode === 'practice'
      ? (state.local ? 'Втроём' : 'Тренировка')
      : state.status === 'playing'
        ? 'Партия'
        : state.status === 'lobby'
          ? 'Лобби'
          : 'Меню';
  renderBanner();
}

/** Кто за кого и чей ход — прямо над доской. */
function renderBanner() {
  const box = $('#banner');
  if (!box) return;
  const g = state.game;
  const seatName = (w) => state.seats[w]?.name || WING_NAME[w];

  if (state.status === 'playing' && g) {
    const turn = g.turn;
    const mine = state.local || turn === state.mySeat;
    const who = `${WING_NAME[turn]} · ${seatName(turn)}`;
    box.innerHTML = `
      <span class="dot w${turn}"></span>
      <span class="banner-text">${mine ? 'Ваш ход' : 'Ход'}: <b>${escapeHtml(who)}</b></span>
      <span class="banner-sub">${state.local ? 'передайте телефон' : mine ? 'выберите фигуру' : 'ждём'}</span>`;
    box.className = `banner w${turn}`;
    return;
  }
  if (state.status === 'finished' && state.result) {
    const r = state.result;
    const txt = r.winner === null ? 'Ничья' : `${WING_NAME[r.winner]} побеждают`;
    box.innerHTML = `<span class="banner-text"><b>${escapeHtml(txt)}</b></span>`;
    box.className = 'banner done';
    return;
  }
  if (state.status === 'lobby') {
    box.innerHTML = `<span class="banner-text">Стол <b>${state.room || '—'}</b></span><span class="banner-sub">позовите двоих</span>`;
    box.className = 'banner';
    return;
  }
  box.innerHTML = '<span class="banner-text">Играйте с ботами, втроём за одним телефоном или позовите друзей</span>';
  box.className = 'banner';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* --------------------------- вид: тема и 3D ------------------------------- */

const VIEW_KEY = 'chess3-3d';
const RULES_KEY = 'chess3-rules-seen';

/** Камера 3D: её же числа идут в CSS и в проекцию фигур. Крутится пальцем. */
const CAM_DEFAULT = { rx: 44, rz: -16, persp: 1100 };
const CAM_KEY = 'chess3-cam';
const CAM = { ...CAM_DEFAULT };

function loadCam() {
  try {
    const raw = localStorage.getItem(CAM_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (Number.isFinite(v.rx)) CAM.rx = Math.min(72, Math.max(12, v.rx));
    if (Number.isFinite(v.rz)) CAM.rz = Math.min(80, Math.max(-80, v.rz));
  } catch {}
}

function saveCam() {
  try {
    localStorage.setItem(CAM_KEY, JSON.stringify({ rx: CAM.rx, rz: CAM.rz }));
  } catch {}
}

function resetCam() {
  CAM.rx = CAM_DEFAULT.rx;
  CAM.rz = CAM_DEFAULT.rz;
  saveCam();
  applyBoardTransform();
  renderPieces3D();
  toast('Вид сброшен');
}

const THEMES = {
  board: [
    ['slate', 'Графит'],
    ['emerald', 'Изумруд'],
    ['wood', 'Дерево'],
    ['neon', 'Неон'],
  ],
  pieces: [
    ['classic', 'Классика'],
    ['mono', 'Моно'],
    ['neon', 'Неон'],
    ['wood', 'Дерево'],
  ],
  bg: [
    ['night', 'Ночь'],
    ['aurora', 'Аврора'],
    ['felt', 'Суно'],
    ['space', 'Космос'],
    ['sunset', 'Закат'],
  ],
};

const LAYOUT_IDS = LAYOUT_LIST.map((l) => l.id);

function theme() {
  const t = state.settings?.theme || {};
  const hex = typeof t.bgColor === 'string' && /^#[0-9a-f]{6}$/i.test(t.bgColor) ? t.bgColor.toLowerCase() : '';
  return {
    board: t.board || 'slate',
    pieces: t.pieces || 'classic',
    bg: t.bg || 'night',
    bgColor: hex,
    layout: LAYOUT_IDS.includes(t.layout) ? t.layout : LAYOUT_IDS[0],
  };
}

/** Тема стола (поле/фигуры/фон) — её видят все, кто сел за стол. */
function applyTheme() {
  const t = theme();
  const forced = (params.get('layout') || '').toLowerCase();
  if (LAYOUT_IDS.includes(forced)) t.layout = forced;
  setLayout(t.layout);
  document.body.dataset.layout = getLayoutId();
  document.body.dataset.board = t.board;
  document.body.dataset.pieces = t.pieces;
  document.body.dataset.bg = t.bgColor ? 'custom' : t.bg;
  if (t.bgColor) {
    document.body.style.setProperty?.('--bg-custom', t.bgColor);
    document.body.style.setProperty?.('--bg-custom-soft', shade(t.bgColor, -22));
  } else {
    document.body.style.removeProperty?.('--bg-custom');
    document.body.style.removeProperty?.('--bg-custom-soft');
  }
}

/** hex → на p процентов темнее/светлее. */
function shade(hex, p) {
  const n = parseInt(hex.slice(1), 16);
  const adj = (v) => Math.max(0, Math.min(255, Math.round(v + (255 * p) / 100)));
  const r = adj((n >> 16) & 255);
  const g = adj((n >> 8) & 255);
  const b = adj(n & 255);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Своя армия всегда снизу: угол поворота доски под зрителя. */
function viewAngle() {
  const seat = state.local ? 0 : state.mySeat >= 0 ? state.mySeat : 0;
  const base = wingAngles()[seat] ?? 90;
  return base - 270;
}

/** Масштаб 3D-вида: в zen доска крупнее (учитывается и в проекции фигур). */
function boardScale() {
  return 1;
}

function applyBoardTransform() {
  const tilt = document.querySelector('.board-tilt');
  if (!tilt) return;
  tilt.style.transform = state.threeD
    ? `perspective(${CAM.persp}px) rotateX(${CAM.rx.toFixed(1)}deg) rotateZ(${CAM.rz.toFixed(1)}deg)`
    : 'none';
}

/**
 * Геометрия доски в пикселях. Берём layout-размеры (clientWidth/Height):
 * getBoundingClientRect() у наклонённого элемента уже сжат 3D-трансформом,
 * и фигуры из-за этого уезжали.
 */
function svgSpace() {
  const svg = document.querySelector('#board');
  const tilt = document.querySelector('.board-tilt');
  if (!svg || !tilt) return null;
  const vb = (svg.getAttribute('viewBox') || '-8 -8 16 16').split(/\s+/).map(Number);
  const W = tilt.clientWidth || 1;
  const H = tilt.clientHeight || 1;
  // в zen SVG растянут на всю высоту, иначе высота идёт от пропорций viewBox
  const svgW = W;
  const svgH = document.body.classList.contains('zen') ? H : (W * vb[3]) / vb[2];
  const scale = Math.min(svgW / vb[2], svgH / vb[3]) || 1;
  return {
    s: scale,
    ox: (svgW - vb[2] * scale) / 2,
    oy: (svgH - vb[3] * scale) / 2,
    vx: vb[0],
    vy: vb[1],
    w: W,
    h: H,
  };
}

/** Точка доски → пиксели на экране с учётом наклона камеры. */
function projectPoint(x, y, space) {
  const rad = (viewAngle() * Math.PI) / 180;
  const rx0 = x * Math.cos(rad) - y * Math.sin(rad);
  const ry0 = x * Math.sin(rad) + y * Math.cos(rad);
  const px = space.ox + (rx0 - space.vx) * space.s;
  const py = space.oy + (ry0 - space.vy) * space.s;
  const cx = space.w * 0.5;
  const cy = space.h * 0.58;
  const dx = px - cx;
  const dy = py - cy;
  const rz = (CAM.rz * Math.PI) / 180;
  const rx = (CAM.rx * Math.PI) / 180;
  const x1 = dx * Math.cos(rz) - dy * Math.sin(rz);
  const y1 = dx * Math.sin(rz) + dy * Math.cos(rz);
  const y2 = y1 * Math.cos(rx);
  const z2 = y1 * Math.sin(rx);
  const k = CAM.persp / (CAM.persp - z2);
  const bs = boardScale();
  return { x: cx + x1 * k * bs, y: cy + y2 * k * bs, unit: space.s * k * bs };
}

/* ------------------------- картинки для правил ---------------------------- */

const THUMB_VIEW = (() => {
  const bb = boardBounds(0.6);
  return `${bb.x.toFixed(2)} ${bb.y.toFixed(2)} ${bb.w.toFixed(2)} ${bb.h.toFixed(2)}`;
})();

const cellPath = (i) => cellQuadString(i);

function thumbBoard(extra = '', view = THUMB_VIEW) {
  const cells = [];
  for (let i = 0; i < B.CELLS; i++) {
    cells.push(`<polygon class="t-cell w${B.wingOf(i)} s${B.cellShade(i)}" points="${cellPath(i)}"/>`);
  }
  const rot = viewAngle();
  return `<svg class="thumb" viewBox="${view}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g transform="rotate(${rot} 0 0)">${cells.join('')}${extra}</g></svg>`;
}

/** Подсветка клеток цветом линии (жёлтые ряды / красные вертикали / зелёные диагонали). */
function highlight(cells, color, extraClass = '') {
  return cells
    .map((i) => `<polygon class="t-hl ${color} ${extraClass}" points="${cellPath(i)}"/>`)
    .join('');
}

/** Три картинки: кто за кого, линии доски, как ходит пешка. */
function rulesImages() {
  const w = B.WING_LETTERS;
  // 1. кто за кого: подсветить каждое крыло своим цветом
  const sides = [0, 1, 2]
    .map((wing) => {
      const cells = [];
      for (let i = 0; i < B.CELLS; i++) if (B.wingOf(i) === wing) cells.push(i);
      return highlight(cells, 'wing' + wing);
    })
    .join('');

  // 2. линии: ряд (файлы 1..8 ранга 2), вертикаль (файл 4 ранги 1..4), диагональ (r=c)
  const rank = [];
  const file = [];
  const diag = [];
  for (let f = 1; f <= 8; f++) rank.push(B.idx(0, 2, f));
  for (let r = 1; r <= 4; r++) file.push(B.idx(0, r, 4));
  for (let k = 1; k <= 4; k++) diag.push(B.idx(0, k, k));
  const lines = highlight(rank, 'yellow') + highlight(file, 'red') + highlight(diag, 'green');

  // 3. пешка на фронте: сама клетка + три варианта взятия
  const pawnFrom = B.idx(0, 4, 6);
  const targets = [B.idx(1, 4, 3), B.idx(1, 4, 2), B.idx(1, 4, 4)];
  const pawn =
    highlight([pawnFrom], 'green') +
    targets
      .map((t) => {
        const g = cellGeom(t);
        return `<circle class="t-dot" cx="${g.x.toFixed(2)}" cy="${g.y.toFixed(2)}" r="0.16"/>`;
      })
      .join('');

  return {
    sides: thumbBoard(sides),
    lines: thumbBoard(lines),
    pawn: thumbBoard(pawn, (() => {
      // приближаем зону фронта белых
      const a = cellGeom(B.idx(0, 2, 1));
      const b = cellGeom(B.idx(1, 4, 8));
      const x0 = Math.min(a.x, b.x) - 1.2;
      const y0 = Math.min(a.y, b.y) - 1.2;
      const x1 = Math.max(a.x, b.x) + 1.2;
      const y1 = Math.max(a.y, b.y) + 1.2;
      return `${x0.toFixed(2)} ${y0.toFixed(2)} ${(x1 - x0).toFixed(2)} ${(y1 - y0).toFixed(2)}`;
    })()),
  };
}

function renderRulesThumbs() {
  const imgs = rulesImages();
  for (const key of Object.keys(imgs)) {
    const box = document.querySelector('[data-thumb="' + key + '"]');
    if (box) box.innerHTML = imgs[key];
  }
}

/** Слой «стоячих» фигур для 3D-вида. */
function renderPieces3D() {
  const layer = document.querySelector('#pieces3d');
  if (!layer) return;
  if (!state.threeD) {
    layer.innerHTML = '';
    return;
  }
  const space = svgSpace();
  if (!space) return;
  const g = state.game;
  const out = [];
  for (let i = 0; i < B.CELLS; i++) {
    const p = g.board[i];
    if (!p) continue;
    const c = cellGeom(i);
    const pr = projectPoint(c.x, c.y, space);
    const fit = Math.max(0.55, Math.min(1, cellSize(i) / 0.92));
    const size = Math.max(7, pr.unit * 0.86 * fit);
    out.push(
      `<i class="p3d-shadow" style="left:${pr.x.toFixed(1)}px;top:${(pr.y + pr.unit * 0.26).toFixed(1)}px;width:${(pr.unit * 0.86).toFixed(1)}px;height:${(pr.unit * 0.3).toFixed(1)}px"></i>`,
    );
    out.push(
      `<span class="p3d w${p.wing}" style="left:${pr.x.toFixed(1)}px;top:${(pr.y + pr.unit * 0.24).toFixed(1)}px;font-size:${size.toFixed(1)}px">${PIECES[p.type]}</span>`,
    );
  }
  layer.innerHTML = out.join('');
}

function applyView() {
  const wrap = $('.board-wrap');
  if (wrap) wrap.classList.toggle('mode-3d', !!state.threeD);
  const chip = $('#btn-3d');
  if (chip) chip.textContent = state.threeD ? '3D ✓' : '3D';
  applyTheme();
  applyBoardTransform();
  renderBoard();
}

/** Приближение: 1 — вся доска, до 3.4 — крупно. */
function zoomBy(factor) {
  state.zoom = Math.min(3.4, Math.max(1, (state.zoom || 1) * factor));
  renderBoard();
  renderPieces3D();
  const chip = document.querySelector('#btn-zen');
  if (chip) chip.blur?.();
}

/** Zen: спрятать всё лишнее и растянуть доску на весь экран. */
function toggleZen(force) {
  state.zen = force === undefined ? !state.zen : !!force;
  if (state.zen) {
    state.zoomBeforeZen = state.zoom || 1;
    if ((state.zoom || 1) < 1.02) state.zoom = state.threeD ? 1.0 : 1.15;
  } else if (state.zoomBeforeZen) {
    state.zoom = state.zoomBeforeZen;
    state.zoomBeforeZen = 0;
  }
  document.body.classList.toggle('zen', state.zen);
  const btn = document.querySelector('#btn-zen');
  if (btn) {
    btn.textContent = state.zen ? '⤡' : '⤢';
    btn.title = state.zen ? 'Показать панели' : 'Скрыть панели';
  }
  // после перестройки раскладки пересчитываем проекцию «стоячих» фигур
  requestAnimationFrame(() => {
    renderPieces3D();
    renderBoard();
  });
  haptic('light');
}

function toggle3D() {
  state.threeD = !state.threeD;
  try {
    localStorage.setItem(VIEW_KEY, state.threeD ? '1' : '0');
  } catch {}
  applyView();
  haptic('light');
}

function openRules() {
  const el = $('#screen-rules');
  if (el) el.classList.remove('hidden');
  renderRulesThumbs();
  try {
    localStorage.setItem(RULES_KEY, '1');
  } catch {}
}

function closeRules() {
  const el = $('#screen-rules');
  if (el) el.classList.add('hidden');
}

/* --------------------------------- экраны --------------------------------- */

function showScreen(name) {
  for (const id of ['screen-menu', 'screen-lobby', 'screen-result']) {
    $('#' + id).classList.toggle('hidden', id !== 'screen-' + name);
  }
}

function renderThemeControls() {
  const t = theme();
  const me = String(state.identity?.id ?? '');
  const canEdit = state.mySeat >= 0 && (!state.hostId || state.hostId === me || state.mySeat === 0);
  for (const key of ['layout', 'board', 'pieces', 'bg']) {
    const box = document.getElementById('theme-' + key);
    if (!box) continue;
    const options = key === 'layout' ? LAYOUT_LIST.map((l) => [l.id, l.title]) : THEMES[key];
    let html = options
      .map(
        ([value, label]) =>
          `<button data-theme-key="${key}" data-theme-value="${value}" class="${
            t[key] === value && !(key === 'bg' && t.bgColor) ? 'on' : ''
          }">${label}</button>`,
      )
      .join('');
    if (key === 'bg') {
      html +=
        `<label class="swatch ${t.bgColor ? 'on' : ''}" title="Свой цвет фона">` +
        `<input type="color" id="bg-color-input" value="${t.bgColor || '#101820'}" />` +
        `<span>свой</span></label>`;
    }
    box.innerHTML = html;
    box.dataset.editable = canEdit ? '1' : '0';
  }
}

function renderLobby() {
  $('#lobby-code').textContent = state.room || '—';
  $('#lobby-seats').innerHTML = [0, 1, 2]
    .map((w) => {
      const seat = state.seats[w] || {};
      const mine = state.mySeat === w;
      const stateText = seat.bot
        ? '<span class="state bot">бот</span>'
        : seat.ready
          ? '<span class="state ok">готов</span>'
          : seat.filled
            ? '<span class="state">ждём</span>'
            : '<button class="btn ghost" data-sit="' + w + '" style="padding:5px 10px;font-size:12px">сесть</button>';
      return `<div class="seat ${mine ? 'mine' : ''}" data-wing="${w}">
        <span class="badge">${['Б', 'К', 'Ч'][w]}</span>
        <span class="who"><span class="n">${escapeHtml(seat.name || WING_NAME[w])}</span>
        <span class="s">${WING_NAME[w]}${seat.online === false && seat.filled ? ' · офлайн' : ''}</span></span>
        ${stateText}
      </div>`;
    })
    .join('');
  renderThemeControls();
  const me = state.seats[state.mySeat];
  $('#btn-ready').textContent = me?.ready ? 'Не готов' : 'Готов';
  $('#btn-ready').disabled = state.mySeat < 0;
  for (const btn of document.querySelectorAll('#clock-group button')) {
    const on = Number(btn.dataset.clock) === state.settings.clock && Number(btn.dataset.inc) === state.settings.inc;
    btn.classList.toggle('on', on);
  }
  for (const btn of document.querySelectorAll('#level-group button')) {
    btn.classList.toggle('on', btn.dataset.level === state.settings.level);
  }
}

function renderResult() {
  const r = state.result;
  const g = state.game;
  if (!r) return;
  const iWin = r.winner === state.mySeat;
  const draw = r.winner === null;
  $('#result-icon').textContent = draw ? '🤝' : iWin ? '🏆' : '💀';
  $('#result-title').textContent = draw ? 'Ничья' : iWin ? 'Победа!' : 'Поражение';
  const reason = {
    checkmate: 'мат',
    'draw-stalemate': 'пат у всех',
    'draw-no-progress': 'нет прогресса',
    resign: 'сдача',
    timeout: 'флаг упал',
  }[r.reason] || r.reason;
  const who = r.winner === null ? '' : ` · ${WING_NAME[r.winner]}`;
  $('#result-sub').textContent = `${reason}${who}`;
  $('#result-moves').innerHTML = g.history
    .slice(-10)
    .map((h) => `<div class="mv w${h.wing}"><b>${escapeHtml(h.notation)}</b></div>`)
    .join('');
  showScreen('result');
}

/* --------------------------------- действия -------------------------------- */

function selectCell(cell) {
  const g = state.game;
  const p = g.board[cell];
  if (!p || p.wing !== activeSeat()) {
    state.selected = -1;
    state.legal = [];
    renderBoard();
    return;
  }
  state.selected = cell;
  state.legal = g.legalMovesFrom(cell);
  haptic('light');
  renderBoard();
}

function tryMove(from, to) {
  const g = state.game;
  const move = state.legal.find((m) => m.to === to);
  if (!move) return;
  if (move.promo) {
    askPromotion((promo) => doMove(from, to, promo));
    return;
  }
  doMove(from, to, null);
}

function askPromotion(cb) {
  const wrap = document.createElement('div');
  wrap.className = 'promo-dialog';
  wrap.innerHTML = `<div class="promo-row">${['q', 'r', 'b', 'n']
    .map((t) => `<button class="btn" data-promo="${t}">${PIECES[t]}</button>`)
    .join('')}</div>`;
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-promo]');
    if (!b) return;
    document.body.removeChild(wrap);
    cb(b.dataset.promo);
  });
  document.body.appendChild(wrap);
}

function doMove(from, to, promo) {
  state.selected = -1;
  state.legal = [];
  if (state.mode === 'online' && state.ws) {
    action({ action: 'move', from, to, promo })
      .then(applyState)
      .catch((e) => toast(e.message));
  } else if (state.practice) {
    const res = state.game.play(from, to, promo);
    if (!res.ok) {
      toast(res.error);
      renderBoard();
      return;
    }
    haptic('medium');
    state.lastMove = { from, to };
    renderAll();
    afterPracticeMove();
  }
}

function afterPracticeMove() {
  const g = state.game;
  if (state.local) {
    if (g.status === 'finished') {
      state.status = 'finished';
      state.result = g.result;
      renderAll();
      renderResult();
    } else {
      renderAll();
    }
    return;
  }
  if (g.status === 'finished') {
    state.status = 'finished';
    state.result = g.result;
    renderAll();
    renderResult();
    return;
  }
  if (g.turn !== state.mySeat) {
    clearTimeout(state.botTimer);
    state.botTimer = setTimeout(practiceBotMove, 420);
  }
}

function practiceBotMove() {
  const g = state.game;
  if (g.status !== 'playing') return;
  if (g.turn === state.mySeat) return;
  const mv = chooseMove(g, g.turn, { level: state.settings.level });
  if (!mv) return;
  g.play(mv.from, mv.to, 'q');
  state.lastMove = { from: mv.from, to: mv.to };
  haptic('light');
  renderAll();
  afterPracticeMove();
}

/* ---------------------------------- режимы -------------------------------- */

function startPractice(level = 'normal') {
  clearTimeout(state.botTimer);
  state.mode = 'practice';
  state.practice = true;
  state.local = false;
  state.mySeat = 0;
  state.status = 'playing';
  state.room = null;
  state.game = Game.initial();
  state.settings = { ...state.settings, level };
  state.clocks = [null, null, null];
  state.lastMove = null;
  state.selected = -1;
  state.legal = [];
  state.result = null;
  state.seats = [
    { name: 'Вы', bot: false, filled: true, online: true, ready: true },
    { name: 'Бот Рыжий', bot: true, filled: true, online: true, ready: true },
    { name: 'Бот Тень', bot: true, filled: true, online: true, ready: true },
  ];
  showScreen('none');
  renderAll();
  afterPracticeMove();
}

/** Втроём за одним телефоном: сервер не нужен вообще. */
function startLocal() {
  clearTimeout(state.botTimer);
  state.mode = 'local';
  state.practice = false;
  state.local = true;
  state.mySeat = -1;
  state.status = 'playing';
  state.room = null;
  state.game = Game.initial();
  state.clocks = [null, null, null];
  state.lastMove = null;
  state.selected = -1;
  state.legal = [];
  state.result = null;
  state.seats = [
    { name: 'Игрок 1 · белые', bot: false, filled: true, online: true, ready: true },
    { name: 'Игрок 2 · красные', bot: false, filled: true, online: true, ready: true },
    { name: 'Игрок 3 · чёрные', bot: false, filled: true, online: true, ready: true },
  ];
  showScreen('none');
  renderAll();
  toast('Ход белых. Передавайте телефон по кругу.');
}

function backToMenu() {
  clearTimeout(state.botTimer);
  clearInterval(state.poll);
  state.poll = 0;
  if (state.ws) {
    try {
      state.ws.close();
    } catch {}
    state.ws = null;
  }
  state.mode = 'idle';
  state.practice = false;
  state.local = false;
  state.status = 'menu';
  state.room = null;
  state.mySeat = -1;
  state.game = Game.initial();
  state.seats = [];
  state.legal = [];
  state.selected = -1;
  state.result = null;
  state.lastMove = null;
  state.clocks = [null, null, null];
  history.replaceState(null, '', location.pathname);
  showScreen('menu');
  renderAll();
}

/* ------------------------------ сеть (tgcloud) --------------------------- */

/** Вызов серверного эндпоинта: initData подставляет telegram-web-app.js. */
function call(name, input = {}) {
  return new Promise((resolve, reject) => {
    const api = window.Telegram?.WebApp?.Serverless;
    if (!api || typeof api.call !== 'function') {
      reject(new Error('Открой приложение внутри Telegram'));
      return;
    }
    api.call(name, input, (err, result) => (err ? reject(new Error(err.message || 'Ошибка сервера')) : resolve(result)));
  });
}

const action = (extra) => call('roomAction', { code: state.room, ...extra });

function applyState(msg) {
  if (msg.code) state.room = msg.code;
  state.lastStateAt = Date.now();
  const prevStatus = state.status;
  state.status = msg.status;
  state.seats = msg.seats;
  state.settings = msg.settings;
  state.clocks = msg.clocks;
  state.turnStart = msg.turnStart;
  state.serverOffset = msg.serverNow - Date.now();
  state.chat = msg.chat || [];
  state.mySeat = msg.you;
  state.game = msg.game ? Game.fromJSON(msg.game) : Game.initial();
  if (msg.game?.lastMove) state.lastMove = msg.game.lastMove;
  state.result = msg.game?.result || null;
  state.selected = -1;
  state.legal = [];

  if (state.status === 'lobby') {
    showScreen('lobby');
    renderLobby();
    renderAll();
    return;
  }
  showScreen('none');
  renderAll();
  if (state.status === 'finished' && prevStatus !== 'finished') renderResult();
}

async function createRoom() {
  try {
    const msg = await call('createRoom', {
      clock: state.settings.clock,
      inc: state.settings.inc,
      level: state.settings.level,
    });
    enterState(msg);
  } catch (err) {
    toast(err.message);
  }
}

function enterState(msg) {
  state.mode = 'online';
  state.practice = false;
  state.local = false;
  state.room = msg.code;
  enterRoomLoop();
  applyState(msg);
}

async function joinRoom(code) {
  try {
    const msg = await call('joinRoom', { code });
    enterState(msg);
  } catch (err) {
    toast(err.message);
  }
}

/** Опрос состояния: он же heartbeat для ботов и просрочки времени. */
function enterRoomLoop() {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    if (state.mode !== 'online' || !state.room) return;
    try {
      const msg = await call('roomState', { code: state.room });
      applyState(msg);
    } catch (err) {
      console.warn('roomState', err.message);
    }
  }, 1200);
}

function leaveRoom() {
  clearInterval(state.poll);
  state.poll = 0;
  state.room = null;
  state.mode = 'idle';
}

/** Онлайн-режим: нужен Telegram + Serverless платформы. На статике выключен. */
const TG_APP = window.Telegram?.WebApp || null;
// initData есть только внутри настоящего мини-аппа: снаружи (GitHub Pages,
// обычный браузер) серверных вызовов нет, даже если SDK подключён.
const ONLINE = CONFIG.online === true || (CONFIG.online !== false && !!TG_APP?.initData && !!TG_APP?.Serverless);

const BOT_USERNAME = CONFIG.botUsername || '';

/**
 * Ссылка-приглашение ведёт через бота (?start=КОД): бот отвечает кнопкой,
 * которая открывает мини-апп уже с initData. Так работает всегда — даже если
 * у бота не настроен «красивый» startapp.
 */
function updateInviteLink() {
  const bot = BOT_USERNAME;
  const site = `${location.origin}${location.pathname}`;
  state.directUrl = state.room ? `${site}?room=${state.room}` : site;
  // есть бот — приглашаем через него (открывается мини-апп с initData),
  // нет бота — обычной ссылкой на сайт
  state.inviteUrl = bot
    ? state.room
      ? `https://t.me/${bot}?start=${state.room}`
      : `https://t.me/${bot}`
    : state.directUrl;
  return state.inviteUrl;
}

async function copyInvite() {
  updateInviteLink();
  const text = state.room
    ? `Стол ${state.room} — шахматы на троих. Заходи: ${state.inviteUrl}`
    : `Играю в шахматы на троих: ${state.inviteUrl}`;
  try {
    await navigator.clipboard.writeText(text);
    toast('Ссылка скопирована — отправь друзьям');
  } catch {
    // в WebView буфер бывает недоступен: показываем и открываем шаринг Telegram
    toast(text);
    try {
      tg?.openTelegramLink?.(state.inviteUrl);
    } catch {}
  }
}


/* --------------------------------- события -------------------------------- */

function bindEvents() {
  $('#board').addEventListener('click', (e) => {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    const el = e.target.closest('[data-cell]');
    if (!el || state.status !== 'playing') return;
    const cell = Number(el.dataset.cell);
    if (state.selected >= 0) {
      const target = state.legal.find((m) => m.to === cell);
      if (target) return tryMove(state.selected, cell);
      if (cell === state.selected) {
        state.selected = -1;
        state.legal = [];
        renderBoard();
        return;
      }
    }
    if (!myTurn()) {
      toast('Сейчас ход ' + WING_NAME[state.game.turn].toLowerCase());
      return;
    }
    selectCell(cell);
  });

  $('#btn-create').addEventListener('click', createRoom);
  $('#btn-practice').addEventListener('click', () => startPractice(state.settings.level));
  const localBtn = $('#btn-local');
  if (localBtn) localBtn.addEventListener('click', startLocal);

  // правила и 3D
  const rulesBtn = $('#btn-rules');
  if (rulesBtn) rulesBtn.addEventListener('click', openRules);
  const rulesClose = $('#rules-close');
  if (rulesClose) rulesClose.addEventListener('click', closeRules);
  const rulesOverlay = $('#screen-rules');
  if (rulesOverlay) {
    rulesOverlay.addEventListener('click', (e) => {
      if (e.target === rulesOverlay) closeRules();
    });
  }
  const threeBtn = $('#btn-3d');
  if (threeBtn) threeBtn.addEventListener('click', toggle3D);

  const zoomIn = $('#btn-zoom-in');
  if (zoomIn) zoomIn.addEventListener('click', () => zoomBy(1.25));
  const zoomOut = $('#btn-zoom-out');
  if (zoomOut) zoomOut.addEventListener('click', () => zoomBy(0.8));
  const zenBtn = $('#btn-zen');
  if (zenBtn) zenBtn.addEventListener('click', () => toggleZen());

  // колесо мыши
  const wrapForZoom = $('.board-wrap');
  if (wrapForZoom && typeof wrapForZoom.addEventListener === 'function') {
    wrapForZoom.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && Math.abs(e.deltaY) < 4) return;
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.12 : 0.9);
      },
      { passive: false },
    );
  }

  // две точки — щипок
  const touches = new Map();
  let pinchStart = 0;
  let pinchZoom = 1;
  const dist = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  if (wrapForZoom && typeof wrapForZoom.addEventListener === 'function') {
    wrapForZoom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinchStart = dist();
        pinchZoom = state.zoom || 1;
      }
    });
    wrapForZoom.addEventListener('pointermove', (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && pinchStart > 0) {
        const k = dist() / pinchStart;
        state.zoom = Math.min(3.4, Math.max(1, pinchZoom * k));
        state.suppressClick = true;
        renderBoard();
        renderPieces3D();
      }
    });
    const clearTouch = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinchStart = 0;
    };
    wrapForZoom.addEventListener('pointerup', clearTouch);
    wrapForZoom.addEventListener('pointercancel', clearTouch);
  }
  const helpChip = $('#help-chip');
  if (helpChip) helpChip.addEventListener('click', openRules);

  // палитры темы стола
  const onDocClick = (e) => {
    const b = e.target.closest('[data-theme-key]');
    if (!b) return;
    const box = b.parentElement;
    if (box && box.dataset.editable === '0') {
      toast('Оформление меняет хозяин стола');
      return;
    }
    const next = { ...theme(), [b.dataset.themeKey]: b.dataset.themeValue };
    if (b.dataset.themeKey === 'bg') next.bgColor = '';
    // сразу применяем у себя, потом подтверждаем сервером
    state.settings = { ...state.settings, theme: next };
    applyTheme();
    renderBoard();
    renderLobby();
    action({ action: 'settings', theme: next }).then(applyState).catch((err) => toast(err.message));
  };
  if (typeof document.addEventListener === 'function') document.addEventListener('click', onDocClick);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('input', (e) => {
      const input = e.target.closest && e.target.closest('#bg-color-input');
      if (!input) return;
      const box = input.closest('.pill-group');
      if (box && box.dataset.editable === '0') {
        toast('Оформление меняет хозяин стола');
        return;
      }
      const color = String(input.value || '').toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(color)) return;
      const next = { ...theme(), bg: 'night', bgColor: color };
      state.settings = { ...state.settings, theme: next };
      applyTheme();
      action({ action: 'settings', theme: next }).then(applyState).catch((err) => toast(err.message));
    });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.zen) toggleZen(false);
    });
  }
  window.addEventListener('resize', () => {
      renderPieces3D();
      renderRulesThumbs();
    });
  }

  // --- 3D: крутим доску пальцем ---
  const boardWrap = $('.board-wrap');
  if (boardWrap && typeof boardWrap.addEventListener === 'function') {
    let drag = null;
    boardWrap.addEventListener('pointerdown', (e) => {
      if (!state.threeD) return;
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      state.suppressClick = false;
    });
    boardWrap.addEventListener('pointermove', (e) => {
      if (!drag || !state.threeD) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved < 4) return;
      state.suppressClick = true;
      CAM.rz = Math.min(80, Math.max(-80, CAM.rz + dx * 0.35));
      CAM.rx = Math.min(72, Math.max(12, CAM.rx - dy * 0.28));
      applyBoardTransform();
      renderPieces3D();
    });
    const finish = () => {
      if (drag && drag.moved >= 4) saveCam();
      drag = null;
    };
    boardWrap.addEventListener('pointerup', finish);
    boardWrap.addEventListener('pointercancel', finish);
    boardWrap.addEventListener('pointerleave', finish);
    boardWrap.addEventListener('dblclick', () => {
      if (state.threeD) resetCam();
    });
  }
  $('#btn-join').addEventListener('click', () => {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length < 4) return toast('Код из 5 символов');
    history.replaceState(null, '', `?room=${code}`);
    joinRoom(code);
  });

  $('#btn-ready').addEventListener('click', () => action({ action: 'ready' }).then(applyState).catch((e) => toast(e.message)));
  $('#btn-bots').addEventListener('click', () => action({ action: 'fillBots' }).then(applyState).catch((e) => toast(e.message)));
  $('#btn-invite').addEventListener('click', copyInvite);
  $('#btn-lobby-menu').addEventListener('click', backToMenu);
  $('#btn-lobby-exit').addEventListener('click', () => {
    leaveRoom();
    backToMenu();
  });

  $('#clock-group').addEventListener('click', (e) => {
    const b = e.target.closest('[data-clock]');
    if (!b) return;
    action({ action: 'settings', clock: Number(b.dataset.clock), inc: Number(b.dataset.inc) }).then(applyState).catch((e) => toast(e.message));
  });
  $('#level-group').addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    state.settings.level = b.dataset.level;
    action({ action: 'settings', level: b.dataset.level }).then(applyState).catch((e) => toast(e.message));
    renderLobby();
  });
  $('#lobby-seats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sit]');
    if (!b) return;
    action({ action: 'sit', seat: Number(b.dataset.sit) }).then(applyState).catch((e) => toast(e.message));
  });

  $('#actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'resign') {
      if (confirm('Сдаться? Ваши фигуры уйдут с доски.')) action({ action: 'resign' }).then(applyState).catch((e) => toast(e.message));
    } else if (act === 'copy') copyInvite();
    else if (act === 'menu') showScreen('menu');
    else if (act === 'practice-menu') backToMenu();
    else if (act === 'ready') action({ action: 'ready' }).then(applyState).catch((e) => toast(e.message));
  });

  $('#btn-rematch').addEventListener('click', () => {
    if (state.practice) return startPractice(state.settings.level);
    action({ action: 'rematch' }).then(applyState).catch((e) => toast(e.message));
    showScreen('none');
  });
  $('#btn-result-menu').addEventListener('click', backToMenu);

  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      const tab = btn.dataset.tab;
      $('#tab-moves').classList.toggle('hidden', tab !== 'moves');
      $('#tab-chat').classList.toggle('hidden', tab !== 'chat');
      $('#chat-form').classList.toggle('hidden', tab !== 'chat');
    });
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (state.mode === 'online') action({ action: 'chat', text }).then(applyState).catch((e) => toast(e.message));
    else {
      state.chat.push({ id: 'me', name: 'Вы', text });
      renderChat();
    }
  });

  $('#status-chip').addEventListener('click', () => {
    if (state.status === 'lobby') showScreen('lobby');
    else if (state.status === 'playing') showScreen('none');
    else showScreen('menu');
  });
  $('#room-chip').addEventListener('click', copyInvite);
}

/* ---------------------------------- старт --------------------------------- */

async function boot() {
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#0b0f14');
      tg.setBackgroundColor('#0b0f14');
      tg.enableClosingConfirmation?.();
    } catch {}
  }

  const tgUser = tg?.initDataUnsafe?.user;
  state.identity = tgUser ? { id: String(tgUser.id), name: tgUser.first_name || 'Игрок' } : null;

  state.config = { botUsername: '', miniAppUrl: location.origin };

  // 3D-вид запоминаем между запусками
  try {
    state.threeD = localStorage.getItem(VIEW_KEY) === '1';
  } catch {
    state.threeD = false;
  }
  if (params.get('3d')) state.threeD = true;
  loadCam();
  document.body.dataset.online = ONLINE ? '1' : '0';

  bindEvents();
  applyView();
  renderAll();

  const roomFromUrl = (params.get('room') || tg?.initDataUnsafe?.start_param || '').toUpperCase();
  if (roomFromUrl && /^[A-Z0-9]{4,8}$/.test(roomFromUrl)) {
    joinRoom(roomFromUrl);
  } else if (params.get('practice')) {
    // быстрый вход в тренировку: удобно для демо и скриншотов
    startPractice(params.get('practice') || 'normal');
  } else {
    showScreen('menu');
    // первый запуск — сразу показываем правила
    let seen = null;
    try {
      seen = localStorage.getItem(RULES_KEY);
    } catch {}
    if (!seen) openRules();
  }

  setInterval(() => {
    if (state.status === 'playing') renderHud();
  }, 500);
}

boot();

/** Хуки для смоук-теста интерфейса (в браузере просто не используются). */
export const __test = {
  state,
  startPractice,
  startLocal,
  afterPracticeMove,
  practiceBotMove,
  renderAll,
  renderBoard,
  renderLobby,
  renderResult,
  applyState,
  call,
  selectCell,
  tryMove,
  doMove,
  myTurn,
};

