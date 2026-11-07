import { api } from 'sdk';

/** Адрес своего мини-аппа — его печатает `tgcloud push`. Замените на свой. */
const APP_BASE = 'https://app0000000000.tgcloud.ai/';
/**
 * Версия ассетов. Меняется при каждом деплое: Telegram держит webview-кэш,
 * и новая версия в ссылке — единственный способ гарантированно показать свежий код.
 */
const APP_VERSION = '17';

/** Ссылка в мини-апп с версией и, если нужно, кодом стола. */
const appUrl = (extra) => `${APP_BASE}?v=${APP_VERSION}${extra ? `&${extra}` : ''}`;

/**
 * handlers/message — команды бота.
 * Приглашение работает через ?start=КОД: бот отвечает кнопкой web_app,
 * и мини-апп открывается уже с подписанным initData.
 */
export default async function (message, ctx) {
  const text = (message.text || '').trim();
  const chatId = message.chat.id;
  if (!text.startsWith('/')) return;

  const [cmd, ...rest] = text.split(/\s+/);
  const payload = (rest[0] || '').toUpperCase();

  const send = (html, keyboard) =>
    api.sendMessage({
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });

  if (cmd === '/start' || cmd === '/play') {
    const hasCode = /^[A-Z0-9]{4,8}$/.test(payload);
    const lines = [
      '<b>Шахматы на троих</b>',
      '',
      'Доска на 96 клеток, три армии, три короля. Кто первый поставил мат — забирает партию.',
      hasCode ? `\nСтол <code>${payload}</code> ждёт.` : '',
      '',
      'Открой мини-приложение кнопкой ниже, собери стол и позови двоих.',
    ];
    const kb = {
      inline_keyboard: [
        [
          {
            text: hasCode ? '♟ Сесть за стол ' + payload : '♟ Открыть приложение',
            web_app: { url: hasCode ? appUrl('room=' + payload) : appUrl() },
          },
        ],
      ],
    };
    await send(lines.join('\n'), kb);
    return;
  }

  if (cmd === '/new') {
    await send(
      [
        '<b>Новый стол</b>',
        '',
        'Открой мини-приложение и нажми «Создать стол» — оно выдаст код и ссылку для друзей.',
      ].join('\n'),
      { inline_keyboard: [[{ text: '♟ Открыть приложение', web_app: { url: appUrl() } }]] },
    );
    return;
  }

  if (cmd === '/rules') {
    await send(
      [
        '<b>Правила на пальцах</b>',
        '• Три армии по 16 фигур стоят по краям доски и смотрят в центр.',
        '• Ходят по очереди: белые → красные → чёрные.',
        '• Ходят как в обычных шахматах, но в центре доска складывается: линии уходят из крыла в крыло.',
        '• Пешка идёт к центру, переходит шов и превращается на чужом тылу; назад тоже умеет — шаг и два взятия в своём крыле.',
        '• Мат любому королю = победа тому, кто его поставил. Короля нельзя съесть.',
        '• Сдался или упал флаг — твои фигуры уходят, двое продолжают.',
      ].join('\n'),
    );
    return;
  }

  if (cmd === '/help') {
    await send(
      [
        '<b>Команды</b>',
        '/start — открыть мини-приложение',
        '/new — как создать стол',
        '/rules — правила',
        '',
        'В приложении: «Создать стол» → ссылка друзьям, «Готов» у всех троих → игра.',
      ].join('\n'),
    );
  }
}
