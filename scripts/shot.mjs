/**
 * Скриншот и замеры реального приложения через DevTools Protocol.
 * Нужен Chrome, запущенный с --remote-debugging-port=9222.
 *
 *   node scripts/shot.mjs http://127.0.0.1:8099/?practice=normal docs/ui-board.png
 */
import { writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8099/';
const out = process.argv[3] || 'docs/ui.png';
const preShot = process.argv[4] || '';
const cdp = process.env.CDP || 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(cdp + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('нет вкладки: ' + JSON.stringify(list).slice(0, 200));

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await call('Page.navigate', { url });
for (let i = 0; i < 40; i++) {
  await sleep(250);
  const ready = await call('Runtime.evaluate', {
    returnByValue: true,
    expression: `document.readyState === 'complete' && !!document.querySelector('#board') && document.querySelectorAll('polygon.cell').length === 96`,
  });
  if (ready.result?.result?.value === true) break;
}
await sleep(300);

if (preShot) {
  await call('Runtime.evaluate', { expression: preShot });
  await sleep(400);
}

const probe = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const q = (s) => document.querySelector(s);
    const r = (s) => { const el = q(s); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    const cells = [...document.querySelectorAll('polygon.cell')].map((p) => p.getBoundingClientRect());
    return JSON.stringify({
      viewport: [innerWidth, innerHeight],
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      card: r('.board-wrap'),
      svg: r('#board'),
      hud: r('#hud'),
      player: r('.player'),
      actions: r('#actions'),
      panel: r('.panel'),
      cellsRight: cells.length ? Math.round(Math.max(...cells.map((c) => c.right))) : null,
      cellsBottom: cells.length ? Math.round(Math.max(...cells.map((c) => c.bottom))) : null,
      cells: cells.length,
      players: document.querySelectorAll('.player').length,
      fontSize: (() => { const l = q('.topbar .logo'); return l ? getComputedStyle(l).fontSize : null; })(),
    });
  })()`,
});
if (!probe.result?.result?.value) { console.log(JSON.stringify(probe, null, 1).slice(0, 1500)); } else { console.log(JSON.parse(probe.result.result.value)); }

const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out);
ws.close();



