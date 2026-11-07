/**
 * Домен стола для Telegram Serverless: без сокетов и таймеров.
 * Всё, что раньше делал Durable Object по alarm, теперь делает `tick()` —
 * его вызывает каждый запрос от клиента (опрос состояния).
 */
import { Game } from './engine/game.js';
import { WING_TITLES } from './engine/board.js';
import { chooseMove } from './engine/ai.js';

export const MAX_CHAT = 40;
/** Один тик = один опрос клиента: столько «времени» списываем с часов. */
export const TICK_COST_MS = 1200;
export const DEFAULT_SETTINGS = { clock: 600, inc: 5, level: 'normal', bots: true, theme: defaultTheme() };

/** Тема стола: поле, фигуры, фон — её видят все игроки. */
export const THEMES = {
  board: ['slate', 'emerald', 'wood', 'neon'],
  pieces: ['classic', 'mono', 'neon', 'wood'],
  layout: ['trefoil', 'star', 'ring'],
  bg: ['night', 'aurora', 'felt', 'space', 'sunset', 'custom'],
};

export function defaultTheme() {
  return { board: 'slate', pieces: 'classic', bg: 'night', layout: 'trefoil' };
}

function sanitizeTheme(input) {
  const theme = defaultTheme();
  if (input && typeof input === 'object') {
    for (const key of ['board', 'pieces', 'bg', 'layout']) {
      if (THEMES[key].includes(input[key])) theme[key] = input[key];
    }
    // свой цвет фона (только обычный hex, чтобы не пролезло что-то лишнее)
    if (typeof input.bgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.bgColor)) {
      theme.bgColor = input.bgColor.toLowerCase();
      theme.bg = 'custom';
    }
  }
  return theme;
}

const A = [0, 1, 2];

export function makeCode(len = 5) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

export function newRoom(code) {
  return {
    code,
    status: 'lobby',
    hostId: null,
    seats: A.map((i) => ({ id: null, name: WING_TITLES[i], photo: null, ready: false, bot: false })),
    settings: { ...DEFAULT_SETTINGS },
    game: null,
    clocks: [0, 0, 0],
    turnStart: 0,
    pendingBot: false,
    chat: [],
    version: 0,
  };
}

/** Строка БД → объект домена (партия становится Game). */
export function hydrate(row) {
  const settings = { ...DEFAULT_SETTINGS, ...(row.settings || {}) };
  settings.theme = sanitizeTheme(settings.theme);
  return {
    ...row,
    seats: row.seats || newRoom(row.code).seats,
    settings,
    game: row.game ? Game.fromJSON(row.game) : null,
    clocks: row.clocks || [0, 0, 0],
    pendingBot: !!row.pendingBot,
    chat: row.chat || [],
  };
}

/** Объект домена → набор колонок для UPDATE/INSERT. */
export function dehydrate(room) {
  return {
    status: room.status,
    hostId: room.hostId,
    seats: room.seats,
    settings: room.settings,
    game: room.game ? room.game.toJSON() : null,
    clocks: room.clocks,
    turnStart: room.turnStart,
    pendingBot: !!room.pendingBot,
    chat: room.chat.slice(-MAX_CHAT),
    version: (room.version || 0) + 1,
  };
}

export const seatOfId = (room, id) => room.seats.findIndex((s) => s.id === String(id));
export const freeSeat = (room) => room.seats.findIndex((s) => !s.id && !s.bot);

/** Кто хозяин: он сам или любой, если хозяина нет за столом. */
export function canManage(room, id) {
  if (!room.hostId) return true;
  if (String(id) === room.hostId) return true;
  return !room.seats.some((s) => s.id === room.hostId);
}

export function joinRoom(room, user) {
  let seat = seatOfId(room, user.id);
  if (seat < 0 && room.status === 'lobby') {
    const preferFirst = room.seats[0].id === null && !room.seats[0].bot && room.hostId === String(user.id);
    seat = preferFirst ? 0 : freeSeat(room);
    if (seat >= 0) {
      room.seats[seat] = {
        id: String(user.id),
        name: user.name || 'Игрок',
        photo: user.photo || null,
        ready: false,
        bot: false,
      };
    }
  }
  if (!room.hostId) room.hostId = String(user.id);
  return seat;
}

export function fillBots(room) {
  room.seats.forEach((seat, i) => {
    if (!seat.id) {
      room.seats[i] = {
        id: null,
        name: 'Бот ' + WING_TITLES[i],
        photo: null,
        ready: true,
        bot: true,
      };
    }
  });
}

export function allFilled(room) {
  return room.seats.every((s) => s.id || s.bot);
}

export function maybeStart(room, now) {
  if (room.status !== 'lobby') return false;
  if (!room.seats.every((s) => (s.id || s.bot) && s.ready)) return false;
  if (room.settings.bots) fillBots(room);
  if (!allFilled(room)) return false;

  room.game = Game.initial();
  room.status = 'playing';
  room.clocks = A.map(() => room.settings.clock * 1000);
  room.turnStart = now;
  room.pendingBot = !!(room.seats[0] && room.seats[0].bot);
  room.chat.push({ id: 'system', name: 'Стол', text: 'Партия началась. Первыми ходят белые.', ts: now });
  return true;
}

function chargeTick(room, now) {
  const turn = room.game.turn;
  room.clocks[turn] = Math.max(0, room.clocks[turn] - TICK_COST_MS);
  room.turnStart = now;
  return room.clocks[turn];
}

function dropSeat(room, seat, reason, now) {
  const title = WING_TITLES[seat];
  room.game.drop(seat, reason);
  room.chat.push({
    id: 'system',
    name: 'Стол',
    text:
      reason === 'timeout'
        ? `${title}: время вышло. Фигуры уходят с доски.`
        : `${title}: сдались. Фигуры уходят с доски.`,
    ts: now,
  });
  room.turnStart = now;
  if (room.game.status === 'finished') room.status = 'finished';
  else room.pendingBot = !!(room.seats[room.game.turn] && room.seats[room.game.turn].bot);
}

/** Один ход бота (или просрочка времени). Возвращает true, если что-то изменилось. */
export function tick(room, now, opts = {}) {
  const bots = opts.bots !== false;
  if (room.status !== 'playing' || !room.game) return false;
  const turn = room.game.turn;
  const seat = room.seats[turn];

  // часы: цена одного опроса
  if (chargeTick(room, now) === 0) {
    dropSeat(room, turn, 'timeout', now);
    return true;
  }

  // бот думает один опрос, потом ходит
  if (seat && seat.bot && bots) {
    if (!room.pendingBot) {
      room.pendingBot = true;
      return false;
    }
    const mv = chooseMove(room.game, turn, { level: room.settings.level });
    if (!mv) {
      dropSeat(room, turn, 'resign', now);
      return true;
    }
    const res = room.game.play(mv.from, mv.to, 'q');
    if (!res.ok) return false;
    room.clocks[turn] += room.settings.inc * 1000;
    room.turnStart = now;
    room.pendingBot = !!(room.seats[room.game.turn] && room.seats[room.game.turn].bot);
    if (room.game.status === 'finished') {
      room.status = 'finished';
      room.chat.push({ id: 'system', name: 'Стол', text: resultText(room.game.result), ts: now });
    }
    return true;
  }
  return false;
}

function resultText(result) {
  if (!result) return '';
  if (result.winner === null) return 'Ничья (' + reasonText(result.reason) + ')';
  return `${WING_TITLES[result.winner]} побеждают (${reasonText(result.reason)})`;
}

export function reasonText(reason) {
  return (
    {
      checkmate: 'мат',
      'draw-stalemate': 'пат у всех',
      'draw-no-progress': 'нет прогресса',
      resign: 'сдача',
      timeout: 'время',
    }[reason] || reason
  );
}

/** Ход живого игрока. */
export function playMove(room, seat, input, now) {
  if (room.status !== 'playing' || !room.game) return { ok: false, error: 'Партия не идёт' };
  if (room.game.turn !== seat) return { ok: false, error: 'Сейчас не ваш ход' };

  if (chargeTick(room, now) === 0) {
    dropSeat(room, seat, 'timeout', now);
    return { ok: false, error: 'Время вышло' };
  }
  const res = room.game.play(Number(input.from), Number(input.to), input.promo);
  if (!res.ok) return { ok: false, error: res.error };

  room.clocks[seat] += room.settings.inc * 1000;
  room.turnStart = now;
  room.pendingBot = !!(room.seats[room.game.turn] && room.seats[room.game.turn].bot);
  if (room.game.status === 'finished') {
    room.status = 'finished';
    room.chat.push({ id: 'system', name: 'Стол', text: resultText(room.game.result), ts: now });
  }
  return { ok: true, notation: res.notation };
}

/** Действия из лобби/чата: ready, sit, fillBots, settings, chat, resign, rematch. */
export function applyAction(room, user, action, input, now) {
  const id = String(user.id);
  const seat = seatOfId(room, id);
  const name = user.name || 'Игрок';

  switch (action) {
    case 'ready': {
      if (seat < 0 || room.status !== 'lobby') return { ok: false, error: 'Нечего подтверждать' };
      room.seats[seat].ready = !room.seats[seat].ready;
      return { ok: true, started: maybeStart(room, now) };
    }
    case 'sit': {
      if (room.status !== 'lobby') return { ok: false, error: 'Партия уже идёт' };
      const target = Number(input.seat);
      if (!(target >= 0 && target <= 2)) return { ok: false, error: 'Нет такого места' };
      if (room.seats[target].id || room.seats[target].bot) return { ok: false, error: 'Место занято' };
      if (seat >= 0) room.seats[seat] = { ...newRoom('x').seats[seat] };
      room.seats[target] = { id, name, photo: user.photo || null, ready: false, bot: false };
      if (!room.hostId) room.hostId = id;
      return { ok: true };
    }
    case 'fillBots': {
      if (room.status !== 'lobby') return { ok: false, error: 'Партия уже идёт' };
      if (!canManage(room, id)) return { ok: false, error: 'Только хозяин стола' };
      fillBots(room);
      return { ok: true, started: maybeStart(room, now) };
    }
    case 'settings': {
      if (room.status !== 'lobby') return { ok: false, error: 'Партия уже идёт' };
      if (!canManage(room, id)) return { ok: false, error: 'Только хозяин стола' };
      const clock = Number(input.clock);
      const inc = Number(input.inc);
      if (Number.isFinite(clock)) room.settings.clock = Math.min(3600, Math.max(60, clock));
      if (Number.isFinite(inc)) room.settings.inc = Math.min(30, Math.max(0, inc));
      if (['easy', 'normal', 'hard'].includes(input.level)) room.settings.level = input.level;
      if (input.theme) room.settings.theme = sanitizeTheme(input.theme);
      return { ok: true };
    }
    case 'chat': {
      const text = String(input.text || '').slice(0, 200).trim();
      if (!text) return { ok: false, error: 'Пусто' };
      room.chat.push({ id, name, text, ts: now });
      room.chat = room.chat.slice(-MAX_CHAT);
      return { ok: true };
    }
    case 'resign': {
      if (room.status !== 'playing' || seat < 0) return { ok: false, error: 'Не в игре' };
      dropSeat(room, seat, 'resign', now);
      return { ok: true };
    }
    case 'rematch': {
      if (room.status !== 'finished') return { ok: false, error: 'Партия ещё идёт' };
      room.status = 'lobby';
      room.game = null;
      room.clocks = [0, 0, 0];
      room.turnStart = 0;
      room.pendingBot = false;
      room.seats.forEach((s) => {
        s.ready = !!s.bot;
      });
      return { ok: true, started: maybeStart(room, now) };
    }
    default:
      return { ok: false, error: 'Неизвестное действие' };
  }
}

/** Состояние для клиента. */
export function publicState(room, userId, now) {
  const seat = seatOfId(room, userId);
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    seats: room.seats.map((s, i) => ({
      i,
      name: s.name,
      photo: s.photo,
      ready: !!s.ready,
      bot: !!s.bot,
      filled: !!s.id || !!s.bot,
      title: WING_TITLES[i],
    })),
    settings: room.settings,
    clocks: room.clocks,
    turnStart: room.turnStart,
    pendingBot: !!room.pendingBot,
    serverNow: now,
    game: room.game ? room.game.toJSON() : null,
    chat: room.chat.slice(-MAX_CHAT),
    you: seat,
  };
}
