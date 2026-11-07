/**
 * Тесты домена для Telegram Serverless: чистые функции, без БД и сети.
 * Запуск: node scripts/test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as B from '../tgcloud/lib/engine/board.js';
import { Game } from '../tgcloud/lib/engine/game.js';
import { chooseMove } from '../tgcloud/lib/engine/ai.js';
import {
  newRoom,
  joinRoom,
  maybeStart,
  fillBots,
  tick,
  playMove,
  applyAction,
  publicState,
  seatOfId,
  hydrate,
  dehydrate,
  MAX_CHAT,
} from '../tgcloud/lib/room.js';

const users = [
  { id: '1', name: 'Аня' },
  { id: '2', name: 'Боря' },
  { id: '3', name: 'Вика' },
];

function roomWithPlayers(n = 3) {
  const room = newRoom('TEST1');
  for (let i = 0; i < n; i++) joinRoom(room, users[i]);
  return room;
}

/* ------------------------------- движок ---------------------------------- */

test('движок: доска 96 клеток, три армии по 16 фигур', () => {
  const g = Game.initial();
  for (const w of [0, 1, 2]) {
    assert.equal(g.piecesOf(w).length, 16);
    assert.equal(g.inCheck(w), false);
  }
  assert.equal(B.CELLS, 96);
  assert.equal(B.SEAM_PAIRS.length, 12);
});

test('движок: пешка проходит шов и превращается на чужом тылу', () => {
  const g = new Game({ board: new Array(B.CELLS).fill(null), turn: 0 });
  g.board[B.idx(0, 4, 6)] = { type: 'p', wing: 0 };
  g.board[B.idx(0, 1, 5)] = { type: 'k', wing: 0 };
  const front = g.legalMovesFrom(B.idx(0, 4, 6)).map((m) => B.cellName(m.to));
  assert.ok(front.includes('rc4'), 'пешка бьёт через складку');
  const back = B.step(B.idx(0, 4, 6), B.S);
  assert.ok(front.includes(B.cellName(back.to)), 'пешка умеет отступать назад');

  const g2 = new Game({ board: new Array(B.CELLS).fill(null), turn: 0 });
  g2.board[B.idx(1, 2, 3)] = { type: 'p', wing: 0 };
  const promo = g2.legalMovesFrom(B.idx(1, 2, 3)).find((m) => m.to === B.idx(1, 1, 3));
  assert.equal(promo.promo, 'q');
});

test('движок: мат заканчивает партию в пользу поставившего', () => {
  const g = new Game({ board: new Array(B.CELLS).fill(null), turn: 0 });
  g.board[B.idx(1, 1, 1)] = { type: 'k', wing: 1 };
  g.board[B.idx(0, 1, 1)] = { type: 'k', wing: 0 };
  g.board[B.idx(1, 2, 3)] = { type: 'q', wing: 0 };
  g.board[B.idx(1, 4, 2)] = { type: 'r', wing: 0 };
  g.board[B.idx(2, 1, 5)] = { type: 'k', wing: 2 };
  const res = g.play(B.idx(1, 2, 3), B.idx(1, 2, 2));
  assert.equal(res.ok, true);
  assert.equal(g.status, 'finished');
  assert.equal(g.result.reason, 'checkmate');
  assert.equal(g.result.winner, 0);
});

test('движок: бот находит мат в один ход', () => {
  const g = new Game({ board: new Array(B.CELLS).fill(null), turn: 0 });
  g.board[B.idx(1, 1, 1)] = { type: 'k', wing: 1 };
  g.board[B.idx(0, 1, 1)] = { type: 'k', wing: 0 };
  g.board[B.idx(1, 2, 3)] = { type: 'q', wing: 0 };
  g.board[B.idx(1, 4, 2)] = { type: 'r', wing: 0 };
  g.board[B.idx(2, 1, 5)] = { type: 'k', wing: 2 };
  const mv = chooseMove(g, 0, { level: 'hard' });
  const probe = g.clone();
  probe.play(mv.from, mv.to, 'q');
  assert.equal(probe.status, 'finished');
});

/* -------------------------------- комнаты -------------------------------- */

test('комната: трое садятся по местам, готовность стартует партию', () => {
  const room = roomWithPlayers(3);
  assert.deepEqual([0, 1, 2].map((i) => room.seats[i].id), ['1', '2', '3']);
  assert.equal(maybeStart(room, Date.now()), false, 'без готовности не стартует');

  for (const u of users) applyAction(room, u, 'ready', {}, Date.now());
  assert.equal(room.status, 'playing');
  assert.equal(room.game.turn, 0);
  assert.deepEqual(room.clocks, [600000, 600000, 600000]);
});

test('комната: ход по очереди, чужой ход отклоняется', () => {
  const room = roomWithPlayers(3);
  for (const u of users) applyAction(room, u, 'ready', {}, Date.now());
  const now = Date.now();

  const ok = playMove(room, 0, { from: 10, to: 26 }, now); // wc2-c4
  assert.equal(ok.ok, true);
  assert.equal(room.game.history.at(-1).notation, 'wc2-wc4');
  assert.equal(room.game.turn, 1);

  const bad = playMove(room, 0, { from: 32, to: 36 }, now);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /ход/i);
});

test('комната: пустые места занимают боты, они сами отвечают по tick', () => {
  const room = newRoom('BOTS1');
  joinRoom(room, users[0]);
  room.hostId = '1';
  fillBots(room);
  applyAction(room, users[0], 'ready', {}, Date.now());
  assert.equal(room.status, 'playing', 'боты уже ready');
  assert.equal(room.seats[1].bot, true);

  playMove(room, 0, { from: 10, to: 26 }, Date.now());
  assert.equal(room.game.turn, 1);

  const later = Date.now() + 5000;
  const changed = tick(room, later);
  assert.equal(changed, true, 'tick сыграл за бота');
  assert.equal(room.game.history.at(-1).wing, 1);
});

test('комната: просрочка времени убирает фигуры игрока', () => {
  const room = roomWithPlayers(3);
  for (const u of users) applyAction(room, u, 'ready', {}, Date.now());
  room.clocks[0] = 1000;
  room.turnStart = Date.now() - 5000;
  tick(room, Date.now());
  assert.equal(room.game.alive[0], false);
  assert.equal(room.piecesOf, undefined);
});

test('комната: чат обрезается, состояние отдаёт место зрителя', () => {
  const room = roomWithPlayers(3);
  for (let i = 0; i < MAX_CHAT + 10; i++) applyAction(room, users[0], 'chat', { text: 'msg ' + i }, Date.now());
  assert.equal(room.chat.length, MAX_CHAT);

  const st = publicState(room, '2', Date.now());
  assert.equal(st.you, 1);
  assert.equal(st.seats.length, 3);
  const guest = publicState(room, 'бурум', Date.now());
  assert.equal(guest.you, -1, 'чужак — зритель');
});

test('комната: сериализация в БД и обратно сохраняет партию', () => {
  const room = roomWithPlayers(3);
  for (const u of users) applyAction(room, u, 'ready', {}, Date.now());
  playMove(room, 0, { from: 10, to: 26 }, Date.now());

  const row = { code: room.code, createdAt: new Date(), ...dehydrate(room) };
  assert.equal(typeof row.game.board[0], 'string', 'партия лежит как JSON');

  const back = hydrate(row);
  assert.equal(typeof back.game.legalMoves, 'function');
  assert.equal(back.game.history.length, 1);
  assert.equal(back.game.turn, 1);
  assert.equal(back.seats[0].id, '1');
  assert.equal(back.status, 'playing');
});

test('комната: сдача и реванш', () => {
  const room = roomWithPlayers(3);
  for (const u of users) applyAction(room, u, 'ready', {}, Date.now());
  applyAction(room, users[1], 'resign', {}, Date.now());
  assert.equal(room.game.alive[1], false);
  assert.equal(room.status, 'playing', 'двое продолжают');

  applyAction(room, users[0], 'resign', {}, Date.now());
  assert.equal(room.status, 'finished');
  assert.equal(room.game.result.winner, 2);

  applyAction(room, users[0], 'rematch', {}, Date.now());
  assert.equal(room.status === 'lobby' || room.status === 'playing', true);
  assert.equal(room.game === null || room.game.status === 'playing', true);
});

test('комната: хозяин управляет настройками, чужой — нет', () => {
  const room = roomWithPlayers(3);
  const hostSet = applyAction(room, users[0], 'settings', { clock: 180, inc: 2 }, Date.now());
  assert.equal(hostSet.ok, true);
  assert.equal(room.settings.clock, 180);

  const guestSet = applyAction(room, users[1], 'settings', { clock: 60 }, Date.now());
  assert.equal(guestSet.ok, false);
  assert.equal(room.settings.clock, 180);
});

test('комната: место в лобби можно пересидеть', () => {
  const room = roomWithPlayers(1);
  assert.equal(seatOfId(room, '1'), 0);
  const moved = applyAction(room, users[0], 'sit', { seat: 2 }, Date.now());
  assert.equal(moved.ok, true);
  assert.equal(seatOfId(room, '1'), 2);
  assert.equal(room.seats[0].id, null);
});
