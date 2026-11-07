/**
 * Тест ссылок и команд бота: ровно тот обработчик, который уедет в Telegram.
 * `sdk` подменён заглушкой из node_modules/sdk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calls, resetCalls } from 'sdk';
import handler from '../tgcloud/handlers/message.js';

const APP = 'https://app0000000000.tgcloud.ai/?v=17';
const msg = (text, chatId = 42) => ({
  chat: { id: chatId, type: 'private' },
  from: { id: 7, first_name: 'Ann' },
  text,
});

const last = () => calls[calls.length - 1];

test('бот: /start с кодом стола даёт кнопку в лобби', async () => {
  resetCalls();
  await handler(msg('/start AB12C'), { update: {} });
  const sent = last();
  assert.equal(sent.method, 'sendMessage');
  const button = sent.params.reply_markup.inline_keyboard[0][0];
  assert.ok(button.web_app, 'кнопка открывает мини-апп');
  assert.equal(button.web_app.url, `${APP}&room=AB12C`, 'ссылка ведёт сразу в лобби этого стола');
  assert.match(sent.params.text, /AB12C/);
});

test('бот: /start без кода открывает меню приложения', async () => {
  resetCalls();
  await handler(msg('/start'), { update: {} });
  const button = last().params.reply_markup.inline_keyboard[0][0];
  assert.equal(button.web_app.url, APP);
});

test('бот: /start с мусором в payload не ломает ссылку', async () => {
  resetCalls();
  await handler(msg('/start ПРИВЕТ'), { update: {} });
  const button = last().params.reply_markup.inline_keyboard[0][0];
  assert.equal(button.web_app.url, APP);
});

test('бот: /rules и /help отвечают текстом', async () => {
  resetCalls();
  await handler(msg('/rules'), { update: {} });
  assert.match(last().params.text, /Правила/);
  resetCalls();
  await handler(msg('/help'), { update: {} });
  assert.match(last().params.text, /Команды/);
});

test('бот: обычный текст игнорируется (не спамим)', async () => {
  resetCalls();
  await handler(msg('привет'), { update: {} });
  assert.equal(calls.length, 0);
});
