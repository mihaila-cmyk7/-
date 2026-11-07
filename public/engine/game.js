/**
 * Партия трёхсторонних шахмат: состояние, легальные ходы, шах/мат, результат.
 */
import * as B from './board.js?v=18';
import {
  createBoard,
  genPieceMoves,
  genCastles,
  isAttacked,
  kingCell,
  applyToBoard,
  PROMO_TYPES,
} from './rules.js?v=18';

const ALL = [0, 1, 2];

export class Game {
  constructor(opts = {}) {
    this.board = opts.board || createBoard();
    this.turn = opts.turn ?? 0;
    this.castling = opts.castling || [
      { k: true, q: true },
      { k: true, q: true },
      { k: true, q: true },
    ];
    this.alive = opts.alive || [true, true, true];
    this.halfmove = opts.halfmove ?? 0;
    this.ply = opts.ply ?? 0;
    this.status = opts.status || 'playing';
    this.result = opts.result || null;
    this.lastMove = opts.lastMove || null;
    this.history = opts.history || [];
    this.skipped = opts.skipped || [];
  }

  static initial() {
    return new Game();
  }

  clone() {
    return new Game({
      board: this.board.slice(),
      turn: this.turn,
      castling: this.castling.map((c) => ({ ...c })),
      alive: this.alive.slice(),
      halfmove: this.halfmove,
      ply: this.ply,
      status: this.status,
      result: this.result ? { ...this.result } : null,
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      history: this.history.slice(),
      skipped: this.skipped.slice(),
    });
  }

  /* ------------------------------- запросы ------------------------------- */

  piecesOf(wing) {
    const out = [];
    for (let i = 0; i < B.CELLS; i++) {
      const p = this.board[i];
      if (p && p.wing === wing) out.push(i);
    }
    return out;
  }

  kingCell(wing) {
    return kingCell(this.board, wing);
  }

  inCheck(wing) {
    const k = kingCell(this.board, wing);
    if (k < 0) return false;
    for (const w of ALL) {
      if (w !== wing && this.alive[w] && isAttacked(this.board, k, w)) return true;
    }
    return false;
  }

  /** Кто вообще шахует этого игрока (для подсказок в UI). */
  checkers(wing) {
    const k = kingCell(this.board, wing);
    if (k < 0) return [];
    return ALL.filter((w) => w !== wing && this.alive[w] && isAttacked(this.board, k, w));
  }

  pseudoMoves(wing) {
    const out = [];
    for (const from of this.piecesOf(wing)) {
      const p = this.board[from];
      for (const m of genPieceMoves(this.board, from)) out.push(m);
      if (p.type === 'k') out.push(...genCastles(this.board, from, this.castling));
    }
    return out;
  }

  isMoveLegal(wing, move) {
    const b = this.board.slice();
    applyToBoard(b, move);
    const k = kingCell(b, wing);
    if (k < 0) return true;
    for (const w of ALL) {
      if (w !== wing && this.alive[w] && isAttacked(b, k, w)) return false;
    }
    return true;
  }

  legalMoves(wing = this.turn) {
    const out = [];
    for (const m of this.pseudoMoves(wing)) {
      if (this.isMoveLegal(wing, m)) out.push(m);
    }
    return out;
  }

  legalMovesFrom(cell) {
    const p = this.board[cell];
    if (!p || p.wing !== this.turn) return [];
    return this.legalMoves(p.wing).filter((m) => m.from === cell);
  }

  /* ------------------------------- ход ----------------------------------- */

  play(from, to, promo) {
    if (this.status !== 'playing') return { ok: false, error: 'Партия окончена' };
    const wing = this.turn;
    if (!this.alive[wing]) return { ok: false, error: 'Вы вне игры' };
    const p = this.board[from];
    if (!p) return { ok: false, error: 'Пустая клетка' };
    if (p.wing !== wing) return { ok: false, error: 'Сейчас ходят ' + B.WING_TITLES[wing].toLowerCase() };

    const move = this.legalMovesFrom(from).find((m) => m.to === to);
    if (!move) return { ok: false, error: 'Недопустимый ход' };
    if (move.promo) move.promo = promo && PROMO_TYPES.includes(promo) ? promo : 'q';

    this.applyMove(move);
    return {
      ok: true,
      move,
      notation: this.history[this.history.length - 1].notation,
      status: this.status,
      result: this.result,
    };
  }

  applyMove(move) {
    const mover = this.turn;
    const piece = this.board[move.from];
    const hadCapture = !!move.capture;
    this.skipped = [];
    this.castling = this._castlingAfter(move, piece);
    applyToBoard(this.board, move);

    this.halfmove = piece.type === 'p' || hadCapture ? 0 : this.halfmove + 1;
    this.ply += 1;
    this.lastMove = { from: move.from, to: move.to, wing: mover };

    const notation = this._notation(move, piece);
    this.history.push({ ply: this.ply, wing: mover, move: this._plainMove(move), notation });
    this._advance(mover);

    const last = this.history[this.history.length - 1];
    if (this.status === 'finished' && this.result && this.result.reason === 'checkmate') last.notation += '#';
    else if (ALL.some((w) => w !== mover && this.alive[w] && this.inCheck(w))) last.notation += '+';
    return this;
  }

  _plainMove(m) {
    return {
      from: m.from,
      to: m.to,
      promo: m.promo || null,
      castle: m.castle || null,
      capture: m.capture ? { type: m.capture.type, wing: m.capture.wing } : null,
    };
  }

  _castlingAfter(move, piece) {
    const rights = this.castling.map((c) => ({ ...c }));
    if (piece.type === 'k') rights[piece.wing] = { k: false, q: false };
    if (piece.type === 'r') {
      if (B.rankOf(move.from) === 1) {
        const f = B.fileOf(move.from);
        if (f === 8) rights[piece.wing].k = false;
        if (f === 1) rights[piece.wing].q = false;
      }
    }
    // ладью могли съесть на её родной клетке
    if (move.capture && move.capture.type === 'r') {
      const w = move.capture.wing;
      const f = B.fileOf(move.to);
      if (B.rankOf(move.to) === 1) {
        if (f === 8) rights[w].k = false;
        if (f === 1) rights[w].q = false;
      }
    }
    return rights;
  }

  _notation(move, piece) {
    if (move.castle) return move.castle === 'k' ? '0-0' : '0-0-0';
    let s = B.cellName(move.from) + (move.capture ? 'x' : '-') + B.cellName(move.to);
    if (move.promo) s += '=' + move.promo.toUpperCase();
    return s;
  }

  _advance(mover) {
    // 1. мат любому из соперников
    for (const w of ALL) {
      if (w === mover || !this.alive[w]) continue;
      if (this.inCheck(w) && this.legalMoves(w).length === 0) return this._mate(w, mover);
    }
    // 2. ничья по «нет прогресса»
    if (this.halfmove >= 100) return this._finish({ winner: null, reason: 'draw-no-progress' });

    // 3. передача хода; патовые пропускают ход
    const order = [];
    for (let k = 1; k <= 3; k++) {
      const w = (mover + k) % 3;
      if (this.alive[w]) order.push(w);
    }
    const skipped = [];
    for (const w of order) {
      if (this.legalMoves(w).length > 0) {
        this.turn = w;
        this.skipped = skipped;
        return;
      }
      if (this.inCheck(w)) return this._mate(w, mover);
      skipped.push(w);
    }
    return this._finish({ winner: null, reason: 'draw-stalemate' });
  }

  /** Мат: победитель — тот, кто шахует (приоритет у сделавшего последний ход). */
  _mate(loserWing, mover) {
    const chk = this.checkers(loserWing);
    const winner = chk.includes(mover) ? mover : chk[0] ?? mover;
    return this._finish({ winner, loser: loserWing, reason: 'checkmate' });
  }

  _finish(result) {
    this.status = 'finished';
    this.result = {
      winner: result.winner ?? null,
      loser: result.loser ?? null,
      reason: result.reason,
      winners: result.winner === null ? [] : [result.winner],
    };
    return this;
  }

  /** Сдался / просрочил время: фигуры убираются, двое продолжают. */
  drop(wing, reason = 'resign') {
    if (this.status !== 'playing' || !this.alive[wing]) return;
    this.alive[wing] = false;
    for (let i = 0; i < B.CELLS; i++) {
      if (this.board[i] && this.board[i].wing === wing) this.board[i] = null;
    }
    const still = ALL.filter((w) => this.alive[w]);
    if (still.length <= 1) {
      this._finish({ winner: still[0] ?? null, loser: wing, reason });
      return;
    }
    if (this.turn === wing) {
      this.turn = still[0];
      // пропускаем патовых среди оставшихся
      for (const w of still) {
        if (this.legalMoves(w).length > 0) {
          this.turn = w;
          break;
        }
      }
    }
  }

  /** Материал крыла (для оценки бота и таблицы). */
  material(wing) {
    const val = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
    let s = 0;
    for (const cell of this.piecesOf(wing)) s += val[this.board[cell].type] || 0;
    return s;
  }

  /* ---------------------------- (де)сериализация -------------------------- */

  toJSON() {
    return {
      v: 1,
      board: this.board.map((p) => (p ? B.WING_LETTERS[p.wing] + p.type : null)),
      turn: this.turn,
      castling: this.castling,
      alive: this.alive,
      halfmove: this.halfmove,
      ply: this.ply,
      status: this.status,
      result: this.result,
      lastMove: this.lastMove,
      history: this.history,
      skipped: this.skipped,
    };
  }

  static fromJSON(obj) {
    if (!obj) return Game.initial();
    const board = obj.board.map((s) => (s ? { wing: B.WING_LETTERS.indexOf(s[0]), type: s[1] } : null));
    return new Game({
      board,
      turn: obj.turn,
      castling: obj.castling,
      alive: obj.alive,
      halfmove: obj.halfmove,
      ply: obj.ply,
      status: obj.status,
      result: obj.result,
      lastMove: obj.lastMove,
      history: obj.history,
      skipped: obj.skipped,
    });
  }
}
