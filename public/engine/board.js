/**
 * Геометрия доски трёхсторонних шахмат.
 *
 * Доска = 96 клеток = три «крыла» по 4 ранга x 8 файлов.
 *   крыло 0 = белые, 1 = красные, 2 = чёрные (по часовой стрелке).
 *
 * Клетка: wing*32 + (rank-1)*8 + (file-1), rank 1..4, file 1..8.
 * Ранг 1 — свой тыл (там стоят фигуры), ранг 4 — «фронт», он выходит к центру доски.
 *
 * Центр доски — это шов (фолд): фронт-ранги крыльев склеены попарно,
 * по 4 клетки на каждую половину ранга:
 *     w.files 5..8  <->  r.files 1..4
 *     r.files 5..8  <->  b.files 1..4
 *     b.files 5..8  <->  w.files 1..4
 * Склейка зеркальная: клетка (wing,4,c) соединена с (next,4,9-c), и при переходе
 * шва «цвет» клетки меняется (в классической доске епископ меняет цвет на центре).
 * Направление движения при переходе шва отражается: N <-> S, NE <-> SW и т.д.
 */

export const WING_LETTERS = ['w', 'r', 'b'];
export const WING_TITLES = ['Белые', 'Красные', 'Чёрные'];
export const WING_COLORS = ['#f2f4f8', '#e2554e', '#23262d'];

export const FILES = 8;
export const RANKS = 4;
export const CELLS = 96;

// Индексы направлений: N, NE, E, SE, S, SW, W, NW (против часовой от «вперёд»)
export const N = 0, NE = 1, E = 2, SE = 3, S = 4, SW = 5, W = 6, NW = 7;
export const DR = [1, 1, 0, -1, -1, -1, 0, 1];
export const DC = [0, 1, 1, 1, 0, -1, -1, -1];
export const ORTHO = [N, E, S, W];
export const DIAG = [NE, SE, SW, NW];
export const ALL_DIRS = [N, NE, E, SE, S, SW, W, NW];
export const DIR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Противоположное направление. */
export const opp = (d) => (d + 4) & 7;

/** Следующее крыло по часовой стрелке (правая половина фронта смотрит на него). */
export const NEXT = [1, 2, 0];
/** Предыдущее крыло (левая половина фронта смотрит на него). */
export const PREV = [2, 0, 1];

export const idx = (wing, rank, file) => wing * 32 + (rank - 1) * 8 + (file - 1);
export const wingOf = (i) => (i / 32) | 0;
export const rankOf = (i) => (((i % 32) / 8) | 0) + 1;
export const fileOf = (i) => (i % 8) + 1;
export const inBoard = (i) => i >= 0 && i < CELLS;

/** «wd3» — крыло + файл + ранг. */
export function cellName(i) {
  if (!inBoard(i)) return '??';
  return WING_LETTERS[wingOf(i)] + 'abcdefgh'[fileOf(i) - 1] + rankOf(i);
}

export function parseCell(s) {
  if (typeof s !== 'string' || s.length !== 3) return -1;
  const w = WING_LETTERS.indexOf(s[0]);
  const f = 'abcdefgh'.indexOf(s[1]);
  const r = '1234'.indexOf(s[2]);
  if (w < 0 || f < 0 || r < 0) return -1;
  return idx(w, r + 1, f + 1);
}

/**
 * Шаг по клетке в направлении d.
 * Возвращает { to, d } (d — направление уже в системе нового крыла) или null.
 */
export function step(i, d) {
  if (!inBoard(i)) return null;
  const wing = wingOf(i);
  const rank = rankOf(i);
  const file = fileOf(i);
  const nr = rank + DR[d];
  const nc = file + DC[d];
  if (nr > RANKS) {
    // уходим за фронт — это шов
    const target = file >= 5 ? NEXT[wing] : PREV[wing];
    const nf = 9 - file - DC[d];
    if (nf < 1 || nf > FILES) return null;
    return { to: idx(target, RANKS, nf), d: opp(d) };
  }
  if (nr < 1 || nc < 1 || nc > FILES) return null;
  return { to: idx(wing, nr, nc), d };
}

/** Шаг только по клетке (направление не нужно). */
export function stepTo(i, d) {
  const s = step(i, d);
  return s ? s.to : -1;
}

/** Пары склеенных клеток шва: [a, b] для отрисовки «фолда». */
export const SEAM_PAIRS = (() => {
  const pairs = [];
  for (let wing = 0; wing < 3; wing++) {
    for (let file = 5; file <= 8; file++) {
      const a = idx(wing, RANKS, file);
      const b = idx(NEXT[wing], RANKS, 9 - file);
      pairs.push([a, b]);
    }
  }
  return pairs;
})();

/** Лучи по всем 8 направлениям для каждой клетки: RAYS[cell][dir] = [cells...]. */
export const RAYS = (() => {
  const table = new Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const perDir = new Array(8);
    for (let d = 0; d < 8; d++) {
      const out = [];
      let cur = i;
      let dir = d;
      for (let k = 0; k < 20; k++) {
        const s = step(cur, dir);
        if (!s || out.includes(s.to)) break;
        out.push(s.to);
        cur = s.to;
        dir = s.d;
      }
      perDir[d] = out;
    }
    table[i] = perDir;
  }
  return table;
})();

/** Все клетки, достижимые ходом коня (леопардовый прыжок 2+1 с учётом шва). */
export const KNIGHT_TARGETS = (() => {
  const table = new Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const set = new Set();
    for (const d1 of ORTHO) {
      const a = step(i, d1);
      if (!a) continue;
      // перпендикулярные направления в системе текущего крыла (N <-> E/W, E <-> N/S)
      const perps = [(a.d + 2) & 7, (a.d + 6) & 7];
      for (const d2 of perps) {
        const b = step(a.to, d2);
        if (!b) continue;
        const c2 = step(b.to, d2);
        if (c2) set.add(c2.to);
      }
    }
    table[i] = [...set];
  }
  return table;
})();

/** «Цвет» клетки как в обычных шахматах: чётность суммы ранга и файла. */
export const cellShade = (i) => (rankOf(i) + fileOf(i)) % 2;

/** Клетки, на которых может стоять фигура крыла в начальной позиции. */
export const HOME_RANK = (wing) => idx(wing, 1, 5); // король e1
export const ROOK_FILES = [1, 8];

/** Начальная расстановка: ладья, конь, слон, ферзь, король, слон, конь, ладья + пешки. */
export const START_PIECES = (() => {
  const layout = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const list = [];
  for (let wing = 0; wing < 3; wing++) {
    for (let file = 1; file <= 8; file++) {
      list.push({ cell: idx(wing, 1, file), type: layout[file - 1], wing });
      list.push({ cell: idx(wing, 2, file), type: 'p', wing });
    }
  }
  return list;
})();

/** Расстояние «вперёд до вражеского тыла» — для оценки позиции ботом. */
export function forwardRank(i) {
  const wing = wingOf(i);
  return rankOf(i);
}
