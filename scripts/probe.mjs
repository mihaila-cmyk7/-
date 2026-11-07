/**
 * Выполнить выражение на открытой странице и напечатать результат.
 *   node scripts/probe.mjs "document.body.dataset.online"
 */
const cdp = process.env.CDP || 'http://127.0.0.1:9222';
const expr = process.argv[2] || 'location.href';

const list = await (await fetch(cdp + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('нет вкладки');
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
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (r.result?.exceptionDetails) {
  console.log('ОШИБКА:', JSON.stringify(r.result.exceptionDetails).slice(0, 600));
} else {
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.result, null, 1));
}
ws.close();
