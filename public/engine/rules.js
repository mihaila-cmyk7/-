/**
 * Правила: генерация ходов, атаки, шах.
 * Фигуры: { type: 'p'|'n'|'b'|'r'|'q'|'k', wing: 0|1|2 } — объекты неизменяемые.
 */
import * as B from './board.js?v=18';

export const PROMO_TYPES = ['q', 'r', 'b', 'n'];
export const PIECE_TITLES = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' };
export const PIECE_CHARS = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

export function createBoard() {
  const board = new Array(B.CELLS).fill(null);
  for (const { cell, type, wing } of B.START_PIECES) board[cell] = { type, wing };
  return board;
}

/** Направление «вперёд» для пешки: в своём крыле — к центру, в чужом — к чужому тылу. */
export function pawnForward(cell, wing) {
  return B.wingOf(cell) === wing ? B.N : B.S;
}

/** Псевдолегальные ходы фигуры с клетки from (без проверки шаха своему королю). */
export function genPieceMoves(board, from) {
  const p = board[from];
  if (!p) return [];
  const out = [];
  const w = p.wing;

  const add = (to) => {
    const t = board[to];
    if (t && t.wing === w) return false;
    // короля нельзя съесть: партия кончается матом
    if (t && t.type === 'k') return false;
    out.push({ from, to, capture: t || null, promo: null, castle: null });
    return !t;
  };

  switch (p.type) {
    case 'p': {
      const fwd = pawnForward(from, w);
      const one = B.step(from, fwd);
      if (one && !board[one.to]) {
        add(one.to);
        if (B.wingOf(from) === w && B.rankOf(from) === 2) {
          const two = B.step(one.to, one.d);
          if (two && !board[two.to]) add(two.to);
        }
      }
      for (const d of [(fwd + 1) & 7, (fwd + 7) & 7]) {
        const s = B.step(from, d);
        if (!s) continue;
        const t = board[s.to];
        if (t && t.wing !== w && t.type !== 'k')
          out.push({ from, to: s.to, capture: t, promo: null, castle: null });
      }
      // назад: шаг и два взятия, но только в пределах своего крыла
      const ours = B.wingOf(from);
      const back = (fwd + 4) & 7;
      const b1 = B.step(from, back);
      if (b1 && B.wingOf(b1.to) === ours && !board[b1.to]) add(b1.to);
      for (const d of [(back + 1) & 7, (back + 7) & 7]) {
        const s = B.step(from, d);
        if (!s || B.wingOf(s.to) !== ours) continue;
        const t = board[s.to];
        if (t && t.wing !== w && t.type !== 'k')
          out.push({ from, to: s.to, capture: t, promo: null, castle: null });
      }
      break;
    }
    case 'n': {
      for (const to of B.KNIGHT_TARGETS[from]) add(to);
      break;
    }
    case 'k': {
      for (const d of B.ALL_DIRS) {
        const s = B.step(from, d);
        if (s) add(s.to);
      }
      break;
    }
    case 'r':
    case 'b':
    case 'q': {
      const dirs = p.type === 'r' ? B.ORTHO : p.type === 'b' ? B.DIAG : B.ALL_DIRS;
      for (const d of dirs) {
        for (const to of B.RAYS[from][d]) {
          const t = board[to];
          if (!t) {
            out.push({ from, to, capture: null, promo: null, castle: null });
          } else {
            if (t.wing !== w && t.type !== 'k')
              out.push({ from, to, capture: t, promo: null, castle: null });
            break;
          }
        }
      }
      break;
    }
    default:
      break;
  }

  // превращение пешки: дошли до тыла соперника (ранг 1 чужого крыла)
  for (const m of out) {
    if (p.type === 'p' && B.wingOf(m.to) !== w && B.rankOf(m.to) === 1) m.promo = 'q';
  }
  return out;
}

/** Таблица: какие пешки (клетка + владелец) бьют данную клетку. */
const PAWN_ATTACKS = (() => {
  const table = new Array(B.CELLS);
  for (let i = 0; i < B.CELLS; i++) {
    const perWing = [new Set(), new Set(), new Set()];
    for (let wing = 0; wing < 3; wing++) {
      const fwd = pawnForward(i, wing);
      for (const d of [(fwd + 1) & 7, (fwd + 7) & 7]) {
        const s = B.step(i, d);
        if (s) perWing[wing].add(s.to);
      }
    }
    table[i] = perWing.map((s) => [...s]);
  }
  return table;
})();

export function kingCell(board, wing) {
  for (let i = 0; i < B.CELLS; i++) {
    const p = board[i];
    if (p && p.wing === wing && p.type === 'k') return i;
  }
  return -1;
}

/** Атакована ли клетка фигурами крыла byWing. */
export function isAttacked(board, cell, byWing) {
  for (const from of B.KNIGHT_TARGETS[cell]) {
    const p = board[from];
    if (p && p.wing === byWing && p.type === 'n') return true;
  }
  for (const d of B.ALL_DIRS) {
    const s = B.step(cell, d);
    if (!s) continue;
    const p = board[s.to];
    if (p && p.wing === byWing && p.type === 'k') return true;
  }
  for (const from of PAWN_ATTACKS[cell][byWing]) {
    const p = board[from];
    if (p && p.wing === byWing && p.type === 'p') return true;
  }
  for (const d of B.ORTHO) {
    for (const to of B.RAYS[cell][d]) {
      const p = board[to];
      if (!p) continue;
      if (p.wing === byWing && (p.type === 'r' || p.type === 'q')) return true;
      break;
    }
  }
  for (const d of B.DIAG) {
    for (const to of B.RAYS[cell][d]) {
      const p = board[to];
      if (!p) continue;
      if (p.wing === byWing && (p.type === 'b' || p.type === 'q')) return true;
      break;
    }
  }
  return false;
}

/** Ходы перестановки (рокировки) — нужен доступ к правам и атакам. */
export function genCastles(board, from, castling) {
  const p = board[from];
  if (!p || p.type !== 'k') return [];
  const wing = p.wing;
  const rights = castling[wing];
  if (!rights) return [];
  if (from !== B.idx(wing, 1, 5)) return [];
  if (isAttacked(board, from, (wing + 1) % 3) || isAttacked(board, from, (wing + 2) % 3)) return [];

  const out = [];
  const enemySafe = (cell) =>
    !isAttacked(board, cell, (wing + 1) % 3) && !isAttacked(board, cell, (wing + 2) % 3);

  const trySide = (side) => {
    if (!rights[side]) return;
    const rookFrom = B.idx(wing, 1, side === 'k' ? 8 : 1);
    const rook = board[rookFrom];
    if (!rook || rook.type !== 'r' || rook.wing !== wing) return;
    const between = side === 'k' ? [6, 7] : [2, 3, 4];
    for (const f of between) if (board[B.idx(wing, 1, f)]) return;
    const transit = B.idx(wing, 1, side === 'k' ? 6 : 4);
    const dest = B.idx(wing, 1, side === 'k' ? 7 : 3);
    const rookTo = B.idx(wing, 1, side === 'k' ? 6 : 4);
    if (!enemySafe(transit) || !enemySafe(dest)) return;
    out.push({
      from,
      to: dest,
      capture: null,
      promo: null,
      castle: side,
      rookFrom,
      rookTo,
    });
  };
  trySide('k');
  trySide('q');
  return out;
}

/** Применяет ход к доске (мутирует переданный массив, только для симуляций/клона). */
export function applyToBoard(board, move) {
  const p = board[move.from];
  board[move.from] = null;
  if (move.castle) {
    const rook = board[move.rookFrom];
    board[move.rookFrom] = null;
    board[move.rookTo] = rook;
  }
  if (move.capture && !move.castle) {
    board[move.to] = null;
  }
  board[move.to] = move.promo ? { type: move.promo, wing: p.wing } : p;
}
