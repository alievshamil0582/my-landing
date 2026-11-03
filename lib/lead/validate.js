// Проверка полей заявки. Чистая функция: без сети, без часов, без побочных эффектов.

export const SERVICES = ['Сайт', 'Telegram-бот', 'ИИ-агент', 'Приложение', 'Пока не знаю'];
const DEFAULT_SERVICE = 'Пока не знаю';

const MIN_ELAPSED_MS = 3000;
const LIMITS = { name: 100, contactMin: 3, contact: 200, message: 4000 };

// Тексты ошибок. Первые четыре заданы ТЗ дословно, их же показывает клиентская проверка в main.js.
export const MESSAGES = {
  name: 'Напишите, как к вам обращаться',
  contact: 'Укажите Telegram, телефон или email, чтобы я мог ответить',
  consent: 'Нужно согласие на обработку данных',
  message: 'Сообщение слишком длинное',
  nameLong: 'Имя слишком длинное, не больше 100 символов',
  contactLong: 'Контакт слишком длинный, не больше 200 символов',
};

// Значение поля как строка. Vercel может отдать массив (повторяющийся ключ) или не строку (JSON).
function text(value) {
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

// Управляющие символы (кроме перевода строки и табуляции) в заявке не нужны.
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (s) => s.replace(CONTROLS, '');

// Имя и контакт однострочные: любые переносы и повторы пробелов сворачиваются в один пробел.
const oneLine = (s) => clean(s).replace(/\s+/g, ' ').trim();

const isChecked = (value) => ['on', 'true', '1', 'yes'].includes(text(value).trim().toLowerCase());

/**
 * @param {Record<string, string>} fields
 * @returns {{ok: true, lead: {name: string, contact: string, service: string, message: string}}
 *   | {ok: false, errors: Record<string, string>} | {spam: true}}
 */
export function validateLead(fields) {
  const f = fields ?? {};
  const name = oneLine(text(f.name));
  const contact = oneLine(text(f.contact));
  const message = clean(text(f.message)).replace(/\r\n?/g, '\n').trim();

  const errors = {};
  if (!name) errors.name = MESSAGES.name;
  else if (name.length > LIMITS.name) errors.name = MESSAGES.nameLong;
  if (contact.length < LIMITS.contactMin) errors.contact = MESSAGES.contact;
  else if (contact.length > LIMITS.contact) errors.contact = MESSAGES.contactLong;
  if (message.length > LIMITS.message) errors.message = MESSAGES.message;
  if (!isChecked(f.consent)) errors.consent = MESSAGES.consent;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // Спам: скрытое поле заполнено или форму «отправили» быстрее, чем способен человек. Ответ такой же, как при успехе.
  const elapsed = Number(text(f.elapsed_ms));
  if (text(f.website).trim() !== '' || !Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) return { spam: true };

  const picked = text(f.service).trim();
  const service = SERVICES.includes(picked) ? picked : DEFAULT_SERVICE;
  return { ok: true, lead: { name, contact, service, message } };
}
