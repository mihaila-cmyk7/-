/**
 * Готовит позиции для показа: середину партии (с выбранной фигурой, у которой
 * есть ход через складку) и финальный мат.
 *   node scripts/demo-positions.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Game } from '../tgcloud/lib/engine/game.js';
import { wingOf, cellName } from '../tgcloud/lib/engine/board.js';

const demo = JSON.parse(readFileSync('docs/demo-game.json', 'utf8'));

// заново проигрываем партию по нотации нельзя — поэтому переигрываем из финала
// назад нельзя тоже; зато в demo-game.json лежит final, а для середины
// перегенерируем ту же партию тем же движком.
const { chooseMove } = await import('../tgcloud/lib/engine/ai.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ищем тот же сид, что дал ровно ту же длину партии
let game = null;
for (let seed = 1; seed <= 60; seed++) {
  const g = Game.initial();
  const rnd = mulberry32(seed);
  const snaps = [];
  while (g.status === 'playing' && g.ply < 260) {
    const mv = chooseMove(g, g.turn, { level: 'hard', rng: rnd });
    if (!mv) break;
    const res = g.play(mv.from, mv.to, 'q');
    if (!res.ok) break;
    snaps.push({ ply: g.ply, game: g.toJSON(), turn: g.turn });
  }
  if (g.ply === demo.plies && g.result?.reason === 'checkmate' && g.result.winner === demo.result.winner) {
    game = { g, snaps };
    break;
  }
}

if (!game) throw new Error('не нашёл ту же партию');

// ищем позицию, где у игрока на ходу есть ход через складку
let mid = null;
for (const snap of game.snaps) {
  if (snap.ply < 8 || snap.ply > 40) continue;
  const g = Game.fromJSON(snap.game);
  let found = null;
  for (let cell = 0; cell < 96 && !found; cell++) {
    const p = g.board[cell];
    if (!p || p.wing !== g.turn) continue;
    const moves = g.legalMovesFrom(cell);
    const cross = moves.find((m) => wingOf(m.to) !== wingOf(m.from));
    if (cross && moves.length >= 4) found = { cell, crossTo: cross.to, moves: moves.length };
  }
  if (found) {
    mid = { ply: snap.ply, turn: snap.turn, ...found, game: snap.game };
    break;
  }
}

const out = {
  final: game.g.toJSON(),
  result: demo.result,
  mid,
  finalCell: (() => {
    // клетка короля проигравшего — подсветить мат
    const g = game.g;
    const loser = demo.result.loser;
    return { king: g.kingCell(loser), winner: demo.result.winner };
  })(),
};

writeFileSync('docs/demo-positions.json', JSON.stringify(out, null, 1));
console.log('финал:', JSON.stringify(demo.result), '| полуходов:', game.g.ply);
console.log(
  mid
    ? `середина: ход ${mid.ply}, фигура ${cellName(mid.cell)} (${mid.moves} ходов, есть переход шва)`
    : 'середину не нашёл',
);
console.log('король проигравшего:', cellName(out.finalCell.king));
