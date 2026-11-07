/**
 * Смоук-тест мини-аппа для tgcloud: DOM-шим + поддельный Serverless.call.
 * Проверяем рисование доски, режимы, офлайн-игру и сетевую ветку.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as realSetTimeout } from 'node:timers';
import { Game } from '../tgcloud/lib/engine/game.js';

class FakeEl {
  constructor(sel = '') {
    this.sel = sel;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
    this.dataset = {};
    this.children = [];
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.classList = {
      _s: new Set(),
      add: (...c) => c.forEach((x) => this.classList._s.add(x)),
      remove: (...c) => c.forEach((x) => this.classList._s.delete(x)),
      toggle: (c, on) => (on ? this.classList._s.add(c) : this.classList._s.delete(c)),
      contains: (c) => this.classList._s.has(c),
    };
  }
  addEventListener() {}
  removeEventListener() {}
  setAttribute(k, v) {
    this[k] = v;
  }
  appendChild(c) {
    this.children.push(c);
  }
  removeChild(c) {
    this.children = this.children.filter((x) => x !== c);
  }
  closest() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}

const els = new Map();
const el = (sel) => {
  if (!els.has(sel)) els.set(sel, new FakeEl(sel));
  return els.get(sel);
};

globalThis.document = {
  querySelector: (sel) => el(sel),
  querySelectorAll: () => [],
  createElement: () => new FakeEl('created'),
  getElementById: (id) => el('#' + id),
  body: new FakeEl('body'),
  dataset: {},
  addEventListener() {},
  removeEventListener() {},
};
globalThis.location = { search: '', pathname: '/', origin: 'https://app1.tgcloud.ai', host: 'app1.tgcloud.ai', protocol: 'https:' };
globalThis.history = { replaceState() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.confirm = () => true;
globalThis.WebSocket = class {
  constructor() {
    this.readyState = 0;
  }
  send() {}
  close() {}
};

/* поддельный Telegram: initData, тема и Serverless.call */
const roomState = () => {
  const game = Game.initial();
  return {
    code: 'TST01',
    status: 'playing',
    hostId: '7',
    seats: [
      { i: 0, name: 'Аня', bot: false, ready: true, filled: true },
      { i: 1, name: 'Бот', bot: true, ready: true, filled: true },
      { i: 2, name: 'Бот', bot: true, ready: true, filled: true },
    ],
    settings: { clock: 600, inc: 5, level: 'normal', bots: true },
    clocks: [600000, 600000, 600000],
    turnStart: Date.now(),
    serverNow: Date.now(),
    game: game.toJSON(),
    chat: [],
    you: 0,
  };
};
const calls = [];
globalThis.Telegram = {
  WebApp: {
    ready() {},
    expand() {},
    setHeaderColor() {},
    setBackgroundColor() {},
    enableClosingConfirmation() {},
    initDataUnsafe: { user: { id: 7, first_name: 'Аня' } },
    HapticFeedback: { impactOccurred() {} },
    Serverless: {
      call(name, input, cb) {
        calls.push([name, input]);
        cb(null, roomState());
      },
    },
  },
};
globalThis.window = globalThis;

const origInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const app = await import('../public/app.js');
await new Promise((r) => realSetTimeout(r, 20));
globalThis.setInterval = origInterval;

const api = app.__test;

test('мини-апп: доска 96 клеток, 12 лент шва, 48 фигур', () => {
  const svg = el('#board').innerHTML;
  assert.equal((svg.match(/class="cell wing-/g) || []).length, 96);
  assert.equal((svg.match(/class="ribbon/g) || []).length, 12);
  assert.equal((svg.match(/class="piece /g) || []).length, 48);
  assert.ok(svg.includes('class="table"'));
  assert.match(el('#board').viewBox || '', /^-?\d/);
});

test('мини-апп: меню содержит три режима', () => {
  assert.ok(el('#actions').innerHTML.includes('btn'));
  const hud = el('#hud').innerHTML;
  assert.equal((hud.match(/class="player/g) || []).length, 3);
});

test('мини-апп: тренировка против ботов', () => {
  api.startPractice('easy');
  const st = api.state;
  assert.equal(st.mode, 'practice');
  assert.equal(st.status, 'playing');
  const res = st.game.play(12, 28, null); // we2-we4
  assert.equal(res.ok, true, res.error);
  api.afterPracticeMove();
  assert.equal(st.game.history.length, 1);
  api.practiceBotMove();
  assert.equal(st.game.history.length, 2, 'бот ответил');
});

test('мини-апп: втроём на одном телефоне — можно ходить за всех', () => {
  api.startLocal();
  const st = api.state;
  assert.equal(st.mode, 'local');
  assert.equal(st.local, true);
  assert.equal(st.mySeat, -1);
  assert.equal(api.myTurn(), true, 'ходят с этого устройства');

  // белые
  st.game.play(10, 26, null); // wc2-c4
  api.afterPracticeMove();
  assert.equal(st.game.turn, 1);
  // красные
  const red = st.game.legalMoves(1)[0];
  st.game.play(red.from, red.to, null);
  api.afterPracticeMove();
  assert.equal(st.game.history.length, 2);
  assert.equal(st.game.turn, 2);
});

test('мини-апп: в лобби есть палитры поля, фигур и фона', () => {
  api.state.status = 'lobby';
  api.state.mySeat = 0;
  api.state.room = 'TST01';
  api.state.identity = { id: '7', name: 'Ann' };
  api.state.hostId = '7';
  api.state.seats = [
    { i: 0, name: 'Ann', bot: false, ready: false, filled: true },
    { i: 1, name: 'Bob', bot: false, ready: false, filled: true },
    { i: 2, name: 'Bot', bot: true, ready: true, filled: true },
  ];
  api.state.settings = { clock: 600, inc: 5, level: 'normal', theme: { board: 'emerald', pieces: 'neon', bg: 'space' } };
  api.renderLobby();
  for (const key of ['board', 'pieces', 'bg']) {
    const html = el('#theme-' + key).innerHTML;
    assert.ok(html.length > 20, 'палитра ' + key + ' отрисована');
    assert.ok(html.includes('data-theme-key="' + key + '"'), 'ключ ' + key);
  }
  assert.ok(el('#theme-board').innerHTML.includes('Изумруд'));
  assert.ok(el('#theme-bg').innerHTML.includes('Космос'));
  assert.ok(el('#theme-bg').innerHTML.includes('bg-color-input'), 'есть выбор своего цвета');
  api.startLocal(); // возвращаем нормальное состояние для следующих тестов
});

test('мини-апп: сетевая ветка зовёт эндпоинт и рисует состояние', async () => {
  await api.call('roomState', { code: 'TST01' });
  const msg = roomState();
  api.applyState(msg);
  const st = api.state;
  assert.equal(st.room, 'TST01');
  assert.equal(st.status, 'playing');
  assert.equal(st.mySeat, 0);
  assert.ok(el('#actions').innerHTML.includes('Пригласить'));
  assert.ok(calls.some(([name]) => name === 'roomState'), 'вызов ушёл в Serverless.call');
});
