/**
 * Демо-партия: три бота играют до развязки, результат сохраняется для показа.
 *   node scripts/demo-game.mjs
 */
import { writeFileSync } from 'node:fs';
import { Game } from '../tgcloud/lib/engine/game.js';
import { chooseMove } from '../tgcloud/lib/engine/ai.js';
import { WING_TITLES, cellName } from '../tgcloud/lib/engine/board.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(seed, maxPlies = 260) {
  const g = Game.initial();
  const rnd = mulberry32(seed);
  while (g.status === 'playing' && g.ply < maxPlies) {
    const mv = chooseMove(g, g.turn, { level: 'hard', rng: rnd });
    if (!mv) break;
    const res = g.play(mv.from, mv.to, 'q');
    if (!res.ok) break;
  }
  return g;
}

// ищем партию, которая закончилась матом (а не ничьей по времени/пату)
let best = null;
for (let seed = 1; seed <= 60; seed++) {
  const g = play(seed);
  if (g.status === 'finished' && g.result?.reason === 'checkmate') {
    if (!best || g.ply < best.ply) best = g;
    if (g.ply < 80) break;
  }
}
if (!best) {
  const g = play(7);
  best = g;
}

const g = best;
const moves = g.history.map((h, i) => ({
  n: i + 1,
  wing: h.wing,
  who: WING_TITLES[h.wing],
  notation: h.notation,
}));

const payload = {
  result: g.result,
  plies: g.ply,
  moves,
  final: g.toJSON(),
  seedDemo: true,
};

writeFileSync(new URL('../docs/demo-game.json', import.meta.url), JSON.stringify(payload, null, 1));
console.log(`Партия: ${g.ply} полуходов, итог: ${JSON.stringify(g.result)}`);
console.log('Последние 12 ходов:');
for (const m of moves.slice(-12)) console.log(`  ${m.n}. ${m.who} — ${m.notation}`);
console.log('\nПервые 6 ходов:');
for (const m of moves.slice(0, 6)) console.log(`  ${m.n}. ${m.who} — ${m.notation}`);
