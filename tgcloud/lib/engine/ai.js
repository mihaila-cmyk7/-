/**
 * Простой ИИ для трёхсторонних шахмат.
 *
 * Оценка позиции строится «против сильнейшего соперника»: в игре на троих
 * выигрывает не тот, у кого больше фигур, а тот, у кого перевес над лучшим
 * из противников. Бот считает:
 *   1. материал (с учётом того, прикрыта ли цель),
 *   2. превращение пешки,
 *   3. шах/мат,
 *   4. не висит ли фигура после хода,
 *   5. на уровне hard — что соперник может съесть в ответ.
 */
import * as B from './board.js';
import { genPieceMoves, isAttacked } from './rules.js';

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const WIN = 1e6;

export function materialOf(game, wing) {
  let sum = 0;
  for (const cell of game.piecesOf(wing)) sum += VAL[game.board[cell].type] || 0;
  return sum;
}

/** Статическая оценка позиции с точки зрения крыла wing. */
export function evaluate(game, wing) {
  if (!game.alive[wing]) return -WIN;
  const mine = materialOf(game, wing);
  let bestRival = -VAL.q;
  for (const w of [0, 1, 2]) {
    if (w !== wing && game.alive[w]) bestRival = Math.max(bestRival, materialOf(game, w));
  }
  let score = mine - Math.max(bestRival, 0);

  // продвижение пешек: чем ближе к чужому тылу, тем ценнее
  for (const cell of game.piecesOf(wing)) {
    const p = game.board[cell];
    if (p.type !== 'p') continue;
    const inOwn = B.wingOf(cell) === wing;
    const rank = B.rankOf(cell);
    score += inOwn ? rank * 4 : 24 + (5 - rank) * 8;
  }
  // король в центре событий — плохо
  const k = game.kingCell(wing);
  if (k >= 0 && B.rankOf(k) === 1) score += 12;
  return score;
}

/** Дешёвая проверка «фигура на клетке защищена своими». */
function isDefended(game, cell, wing) {
  for (const from of game.piecesOf(wing)) {
    if (from === cell) continue;
    const moves = genPieceMoves(game.board, from);
    for (const m of moves) if (m.to === cell) return true;
  }
  return false;
}

function attackersOf(game, cell, wing) {
  return [0, 1, 2].filter((w) => w !== wing && game.alive[w] && isAttacked(game.board, cell, w));
}

/** Насколько дорого стоит ход, если смотреть только на 1 ход вперёд. */
function scoreMove(game, move, wing, level, rnd) {
  const piece = game.board[move.from];
  const next = game.clone();
  next.applyMove(move);

  if (next.status === 'finished') {
    if (next.result.winner === wing) return WIN;
    if (next.result.winner === null) return 0;
    return -WIN;
  }

  let score = 0;

  // взятие: ценность фигуры, но со скидкой, если клетку прикрывают
  if (move.capture) {
    const defended = isDefended(next, move.to, move.capture.wing);
    score += (VAL[move.capture.type] || 0) * (defended ? 0.55 : 1);
  }
  if (move.promo) score += 700;
  if (move.castle) score += 35;

  // шах по любому сопернику
  for (const w of [0, 1, 2]) {
    if (w !== wing && next.alive[w] && next.inCheck(w)) score += 30;
  }

  // своя фигура под боем после хода
  const myPiece = next.board[move.to];
  if (myPiece) {
    const attackers = attackersOf(next, move.to, wing);
    if (attackers.length) {
      const defended = isDefended(next, move.to, wing);
      const risk = (VAL[myPiece.type] || 0) * (defended ? 0.25 : 0.85);
      // если фигура и так была под боем — риск не новый
      const wasAttacked = attackersOf(game, move.from, wing).length > 0;
      score -= wasAttacked ? risk * 0.5 : risk;
    }
  }

  // пешка ближе к чужому тылу
  if (piece.type === 'p') {
    const advanced = B.wingOf(move.to) !== wing ? 40 : (B.rankOf(move.to) - 1) * 8;
    score += advanced;
  }

  // чуть-чуть инициативы
  score += evaluate(next, wing) * 0.02;

  if (level === 'easy') score += rnd() * 60;
  else score += rnd() * 10;

  return score;
}

/** Угроза: максимум, что следующий игрок может у нас забрать. */
function replyThreat(next, wing) {
  const rival = next.turn;
  if (rival === wing) return 0;
  let worst = 0;
  for (const from of next.piecesOf(rival)) {
    for (const m of genPieceMoves(next.board, from)) {
      if (!m.capture || m.capture.wing !== wing) continue;
      const value = VAL[m.capture.type] || 0;
      const guarded = isDefended(next, m.to, wing);
      worst = Math.max(worst, value * (guarded ? 0.4 : 1));
    }
  }
  return worst;
}

/**
 * Выбирает ход за крыло wing.
 * @param {Game} game
 * @param {number} wing
 * @param {{level?: 'easy'|'normal'|'hard', rng?: () => number}} opts
 */
export function chooseMove(game, wing, opts = {}) {
  const level = opts.level || 'normal';
  const rnd = opts.rng || Math.random;
  const moves = game.legalMoves(wing);
  if (!moves.length) return null;

  const scored = moves.map((m) => ({ m, s: scoreMove(game, m, wing, level, rnd) }));
  scored.sort((a, b) => b.s - a.s);

  if (level === 'easy') return scored[Math.floor(rnd() * Math.min(6, scored.length))].m;

  if (level === 'hard') {
    const top = scored.slice(0, 5).map((c) => {
      const next = game.clone();
      next.applyMove(c.m);
      if (next.status === 'finished') return c;
      const threat = replyThreat(next, wing);
      return { m: c.m, s: c.s - threat * 0.8 };
    });
    top.sort((a, b) => b.s - a.s);
    return top[0].m;
  }

  return scored[0].m;
}
