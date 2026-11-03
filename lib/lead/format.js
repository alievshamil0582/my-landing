// Оформление заявки для письма и для Telegram. Чистые функции.

const TELEGRAM_LIMIT = 4096;
const TELEGRAM_CUT_NOTE = '\n… (обрезано, полный текст в письме)';
const SUBJECT_NAME_MAX = 60;

const MOSCOW = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

const formatTime = (at) => `${MOSCOW.format(at).replace(', ', ' ')} (МСК)`;

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Тема письма однострочная, имя в ней не длиннее 60 символов (считаем символы, а не половинки эмодзи).
const subjectName = (name) => Array.from(String(name).replace(/\s+/g, ' ').trim()).slice(0, SUBJECT_NAME_MAX).join('');

const orDash = (message) => (message === '' ? '—' : message);

/**
 * @param {{name: string, contact: string, service: string, message: string}} lead
 * @param {Date} at
 * @returns {{subject: string, text: string, html: string}}
 */
export function formatEmail(lead, at) {
  const when = formatTime(at);
  const subject = `Заявка с сайта: ${lead.service} — ${subjectName(lead.name)}`;

  const text = [
    'Новая заявка с сайта',
    '',
    `Имя: ${lead.name}`,
    `Контакт: ${lead.contact}`,
    `Услуга: ${lead.service}`,
    `Время: ${when}`,
    '',
    'Сообщение:',
    orDash(lead.message),
  ].join('\n');

  const row = (label, value) =>
    `<tr><th align="left" style="padding:4px 16px 4px 0;color:#555;font-weight:600;vertical-align:top">${label}</th>` +
    `<td style="padding:4px 0">${value}</td></tr>`;
  const html = [
    '<div style="font:15px/1.5 Arial,sans-serif;color:#1a1814">',
    '<h2 style="margin:0 0 12px;font-size:18px">Новая заявка с сайта</h2>',
    '<table cellpadding="0" cellspacing="0" role="presentation">',
    row('Имя', escapeHtml(lead.name)),
    row('Контакт', escapeHtml(lead.contact)),
    row('Услуга', escapeHtml(lead.service)),
    row('Время', escapeHtml(when)),
    '</table>',
    '<p style="margin:16px 0 4px;color:#555;font-weight:600">Сообщение</p>',
    `<p style="margin:0">${escapeHtml(orDash(lead.message)).replace(/\n/g, '<br>')}</p>`,
    '</div>',
  ].join('\n');

  return { subject, text, html };
}

/**
 * Простой текст (без parse_mode): разметка в сообщении посетителя остаётся буквами.
 * Лимит Telegram 4096 знаков: при превышении хвост сообщения обрезается, полный текст есть в письме.
 * @param {{name: string, contact: string, service: string, message: string}} lead
 * @param {Date} at
 * @returns {string}
 */
export function formatTelegram(lead, at) {
  const head = [
    'Новая заявка с сайта',
    '',
    `Имя: ${lead.name}`,
    `Контакт: ${lead.contact}`,
    `Услуга: ${lead.service}`,
    `Время: ${formatTime(at)}`,
    '',
    'Сообщение:',
    '',
  ].join('\n');
  const body = orDash(lead.message);
  if (head.length + body.length <= TELEGRAM_LIMIT) return head + body;

  let cut = body.slice(0, TELEGRAM_LIMIT - head.length - TELEGRAM_CUT_NOTE.length);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1); // не оставляем половину суррогатной пары
  return head + cut + TELEGRAM_CUT_NOTE;
}
