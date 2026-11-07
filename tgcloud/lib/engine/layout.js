/**
 * Раскладка доски на плоскости: три крыла по 120° вокруг центра,
 * в центре — треугольная «складка» (шов).
 *
 * Используется и мини-аппом, и скриптом превью, чтобы картинка и игра
 * считались из одной формулы.
 */
import * as B from './board.js';

/** Расстояние от центра до фронта крыла: фронт длиной 8 = сторона правильного треугольника. */
export const D = 8 / (2 * Math.sqrt(3));
export const THETA = [90, 210, 330].map((deg) => (deg * Math.PI) / 180);

/** Центральная треугольная пластина (шов). */
export const PLATE = [
  [-4, -D],
  [4, -D],
  [0, 2 * D],
];

/** Центр клетки и её локальные оси в мировых координатах. */
export function cellGeom(i) {
  const wing = B.wingOf(i);
  const rank = B.rankOf(i);
  const file = B.fileOf(i);
  const th = THETA[wing];
  const ux = Math.cos(th);
  const uy = Math.sin(th);
  const px = -uy;
  const py = ux;
  const lx = 4.5 - file;
  const ly = 4 - rank + 0.5;
  const dist = D + ly;
  return {
    x: -ux * dist + px * lx,
    y: -uy * dist + py * lx,
    ux,
    uy,
    px,
    py,
  };
}

/** Четыре угла клетки (по часовой стрелке). */
export function cellQuad(i) {
  const g = cellGeom(i);
  const h = 0.5;
  return [
    [g.x + g.px * h + g.ux * h, g.y + g.py * h + g.uy * h],
    [g.x - g.px * h + g.ux * h, g.y - g.py * h + g.uy * h],
    [g.x - g.px * h - g.ux * h, g.y - g.py * h - g.uy * h],
    [g.x + g.px * h - g.ux * h, g.y + g.py * h - g.uy * h],
  ];
}

export const cellQuadString = (i) =>
  cellQuad(i)
    .map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)
    .join(' ');

/** Середина внутреннего (фронтового) ребра клетки — оттуда растёт «нить» шва. */
export function frontEdge(i) {
  const g = cellGeom(i);
  return { x: g.x + g.ux * 0.5, y: g.y + g.uy * 0.5 };
}

/** Габариты доски. */
export function boardBounds(pad = 0.5) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < B.CELLS; i++) {
    for (const [x, y] of cellQuad(i)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}
