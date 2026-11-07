/**
 * Проставляет версию к локальным ассетам, чтобы Telegram не отдавал старый кэш.
 *
 *   node scripts/bump-assets.mjs 18
 *
 * Меняет ссылки в index.html, импорты в app.js и engine/*.js. Если задан
 * APP_BASE (адрес вашего мини-аппа), обновляет и его в обработчике бота:
 *
 *   APP_BASE=https://app1234567890.tgcloud.ai/ node scripts/bump-assets.mjs 18
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const v = String(process.argv[2] || '').trim();
if (!/^\d+$/.test(v)) {
  console.error('укажи версию числом: node scripts/bump-assets.mjs 18');
  process.exit(1);
}

const stripVer = (s) => s.replace(/\?v=\d+/g, '');

/* --- 1. index.html: локальные css/js --- */
const htmlPath = 'public/index.html';
let html = stripVer(readFileSync(htmlPath, 'utf8'));
html = html.replace(/(href|src)="\.\/([^"?]+\.(?:css|js))"/g, (_m, attr, file) => `${attr}="./${file}?v=${v}"`);
writeFileSync(htmlPath, html);

/* --- 2. app.js и engine/*.js: относительные импорты --- */
const addVer = (file) => {
  let src = stripVer(readFileSync(file, 'utf8'));
  src = src.replace(/(from\s+')(\.\.?\/[^']+\.js)(')/g, (_m, a, spec, b) => `${a}${spec}?v=${v}${b}`);
  src = src.replace(/(import\s+')(\.\.?\/[^']+\.js)(')/g, (_m, a, spec, b) => `${a}${spec}?v=${v}${b}`);
  writeFileSync(file, src);
};

addVer('public/app.js');
for (const f of readdirSync('public/engine')) {
  if (f.endsWith('.js')) addVer(`public/engine/${f}`);
}

/* --- 3. необязательно: версия и адрес в обработчике бота --- */
const appBase = process.env.APP_BASE || '';
if (appBase) {
  const handlerPath = 'tgcloud/handlers/message.js';
  let h = readFileSync(handlerPath, 'utf8');
  h = h.replace(/const APP_VERSION = '\d+';/, `const APP_VERSION = '${v}';`);
  h = h.replace(/const APP_BASE = '[^']+';/, `const APP_BASE = '${appBase}';`);
  writeFileSync(handlerPath, h);
}

console.log(`версия ${v}: ассеты обновлены${appBase ? ', обработчик бота тоже' : ''}`);
