/**
 * Раскладки доски. Правила (соседство, шов) от них НЕ зависят — они в board.js.
 * Здесь только геометрия, поэтому одну партию можно показывать тремя досками:
 *
 *   trefoil — три крыла с квадратными клетками и треугольной складкой (по умолчанию);
 *   flat    — плоская «Т-доска» как печатная: ровные клетки, белые снизу;
 *   ring    — «кольцо»: концентрические дуги-ряды и лучи из центра.
 */
import * as B from './board.js?v=18';

const TAU = Math.PI * 2;
const polar = (r, a) => ({ x: r * Math.cos(a), y: -r * Math.sin(a) });
const deg = (d) => (d * Math.PI) / 180;

/** Центры крыльев в исходной ориентации. */
const WING_ANGLE = [90, 210, 330].map(deg);

/* ------------------------------ трилистник -------------------------------- */

const D = 8 / (2 * Math.sqrt(3));
const TREFOIL_PLATE = [
  [-4, -D],
  [4, -D],
  [0, 2 * D],
];

function trefoil() {
  const geom = (i) => {
    const wing = B.wingOf(i);
    const rank = B.rankOf(i);
    const file = B.fileOf(i);
    const th = WING_ANGLE[wing];
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const px = -uy;
    const py = ux;
    const lx = 4.5 - file;
    const ly = 4 - rank + 0.5;
    const dist = D + ly;
    return { x: -ux * dist + px * lx, y: -uy * dist + py * lx, px, py, ux, uy };
  };

  return {
    id: 'trefoil',
    title: 'Трилистник',
    angels: [90, 210, 330],
    ribbonMax: Infinity,
    center: geom,
    quad(i) {
      const g = geom(i);
      const h = 0.5;
      return [
        [g.x + g.px * h + g.ux * h, g.y + g.py * h + g.uy * h],
        [g.x - g.px * h + g.ux * h, g.y - g.py * h + g.uy * h],
        [g.x - g.px * h - g.ux * h, g.y - g.py * h - g.uy * h],
        [g.x + g.px * h - g.ux * h, g.y + g.py * h - g.uy * h],
      ];
    },
    innerEdge(i) {
      const g = geom(i);
      const mx = g.x + g.ux * 0.5;
      const my = g.y + g.uy * 0.5;
      return [
        { x: mx + g.px * 0.5, y: my + g.py * 0.5 },
        { x: mx - g.px * 0.5, y: my - g.py * 0.5 },
      ];
    },
    hub: () => TREFOIL_PLATE.map(([x, y]) => ({ x, y })),
  };
}

/* ------------------------------- звезда ----------------------------------- */

/**
 * Доска с референса: те же три крыла 8×4, но каждая линия-ряд «обёрнута»
 * вокруг центра. Клетка с координатами (d — расстояние от фронта, t — вдоль
 * ряда) рисуется на окружности радиуса R = A·d + B под углом θ_крыла + t/R.
 * Поэтому ряды идут дугами, к центру клетки шире, а контур — скруглённый
 * треугольник с вырезами между крыльями.
 */
function starLayout() {
  // Пропорции как на референсе: 4 ряда по 8 клеток в секторе 120°,
  // клетки сходятся к центру, контур — скруглённый треугольник.
  const HUB = 0.55;
  const RING = 1.32;
  const SPREAD = (120 * Math.PI) / 180;
  const FILE_A = SPREAD / 8;

  /** Ряд: 0 у центра → 3 у края. Возвращает [r0, r1]. */
  const radii = (rank) => {
    const a = HUB + (4 - rank) * RING;
    return [a, a + RING];
  };
  const angles = (wing, file) => {
    const a0 = WING_ANGLE[wing] - SPREAD / 2 + (file - 1) * FILE_A;
    return [a0, a0 + FILE_A];
  };
  /** Контур-треугольник: к краям сектора радиус чуть меньше. */
  const dent = (t) => 1 - 0.26 * t * t;
  const at = (wing, r, a) => {
    const wingBase = WING_ANGLE[wing];
    const t = (a - wingBase) / (SPREAD / 2);
    return polar(r * dent(t), a);
  };

  const geom = (i) => {
    const [r0, r1] = radii(B.rankOf(i));
    const [a0, a1] = angles(B.wingOf(i), B.fileOf(i));
    const p = at(B.wingOf(i), (r0 + r1) / 2, (a0 + a1) / 2);
    return p;
  };

  return {
    id: 'star',
    title: 'Звезда',
    angels: [90, 210, 330],
    ribbonMax: 3.4,
    center: geom,
    quad(i) {
      const wing = B.wingOf(i);
      const [r0, r1] = radii(B.rankOf(i));
      const [a0, a1] = angles(wing, B.fileOf(i));
      const steps = 4;
      const pts = [];
      for (let k = 0; k <= steps; k++) {
        const p = at(wing, r0, a0 + ((a1 - a0) * k) / steps);
        pts.push([p.x, p.y]);
      }
      for (let k = 1; k <= steps; k++) {
        const p = at(wing, r0 + ((r1 - r0) * k) / steps, a1);
        pts.push([p.x, p.y]);
      }
      for (let k = steps; k >= 0; k--) {
        const p = at(wing, r1, a1 - ((a1 - a0) * k) / steps);
        pts.push([p.x, p.y]);
      }
      for (let k = steps - 1; k >= 1; k--) {
        const p = at(wing, r1 - ((r1 - r0) * k) / steps, a0);
        pts.push([p.x, p.y]);
      }
      return pts;
    },
    innerEdge(i) {
      const wing = B.wingOf(i);
      const [a0, a1] = angles(wing, B.fileOf(i));
      return [at(wing, HUB, a0), at(wing, HUB, a1)];
    },
    hub() {
      const pts = [];
      const r = HUB * 1.02;
      for (let k = 0; k < 40; k++) pts.push(polar(r, (k / 40) * TAU));
      return pts;
    },
  };
}

/* -------------------------------- кольцо ---------------------------------- */

function ringLayout({ hubR = 4.2, ring = 1.0, spreadDeg = 120, steps = 3 } = {}) {
  const spread = deg(spreadDeg);
  const fileAngle = spread / 8;
  const radii = (rank) => {
    const inner = hubR + (4 - rank) * ring;
    return [inner, inner + ring];
  };
  const angles = (wing, file) => {
    const start = WING_ANGLE[wing] - spread / 2 + (file - 1) * fileAngle;
    return [start, start + fileAngle];
  };

  const center = (i) => {
    const [r0, r1] = radii(B.rankOf(i));
    const [a0, a1] = angles(B.wingOf(i), B.fileOf(i));
    const { x, y } = polar((r0 + r1) / 2, (a0 + a1) / 2);
    return { x, y, r0, r1, a0, a1 };
  };

  return {
    id: 'ring',
    title: 'Кольцо',
    angels: [90, 210, 330],
    ribbonMax: Infinity,
    center,
    quad(i) {
      const [r0, r1] = radii(B.rankOf(i));
      const [a0, a1] = angles(B.wingOf(i), B.fileOf(i));
      const at = (r, a) => {
        const p = polar(r, a);
        return [p.x, p.y];
      };
      const pts = [];
      for (let k = 0; k <= steps; k++) pts.push(at(r0, a0 + ((a1 - a0) * k) / steps));
      for (let k = 1; k <= steps; k++) pts.push(at(r0 + ((r1 - r0) * k) / steps, a1));
      for (let k = steps; k >= 0; k--) pts.push(at(r1, a1 - ((a1 - a0) * k) / steps));
      for (let k = steps - 1; k >= 1; k--) pts.push(at(r1 - ((r1 - r0) * k) / steps, a0));
      return pts;
    },
    innerEdge(i) {
      const [a0, a1] = angles(B.wingOf(i), B.fileOf(i));
      return [polar(hubR, a0), polar(hubR, a1)];
    },
    hub() {
      const pts = [];
      const r = hubR * 0.98;
      for (let k = 0; k < 60; k++) pts.push(polar(r, (k / 60) * TAU));
      return pts;
    },
  };
}

/* ------------------------------- реестр ----------------------------------- */

export const LAYOUTS = {
  trefoil: trefoil(),
  star: starLayout(),
  ring: ringLayout(),
};

export const LAYOUT_LIST = Object.values(LAYOUTS).map((l) => ({ id: l.id, title: l.title }));
export const DEFAULT_LAYOUT = 'trefoil';

let activeId = DEFAULT_LAYOUT;

export function setLayout(id) {
  activeId = LAYOUTS[id] ? id : DEFAULT_LAYOUT;
  return activeId;
}
export const getLayoutId = () => activeId;
export const layout = () => LAYOUTS[activeId];

/* ----------------------------- публичный API ------------------------------ */

export const cellGeom = (i) => layout().center(i);
export const cellQuadPoints = (i) => layout().quad(i);
export const innerEdge = (i) => layout().innerEdge(i);
export const hubPolygon = () => layout().hub();
export const wingAngles = () => layout().angels;
export const ribbonMax = () => layout().ribbonMax ?? Infinity;

export const cellQuadString = (i) =>
  cellQuadPoints(i)
    .map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)
    .join(' ');

/** Размер клетки: нужен, чтобы фигуры не вылезали в мелких клетках. */
export function cellSize(i) {
  const pts = cellQuadPoints(i);
  let area = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x1, y1] = pts[k];
    const [x2, y2] = pts[(k + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  area = Math.abs(area) / 2;
  return Math.sqrt(area) || 1;
}

export function boardBounds(pad = 0.5) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const eat = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const p of hubPolygon()) eat(p.x, p.y);
  for (let i = 0; i < B.CELLS; i++) for (const [x, y] of cellQuadPoints(i)) eat(x, y);
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}
