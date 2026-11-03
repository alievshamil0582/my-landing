// Доставка заявки: email (nodemailer, SMTP) и Telegram (Bot API) параллельно, таймаут каждого 5 секунд.
// Заявка нигде не хранится. В журнал попадают только название канала и вид ошибки, никаких данных посетителя.
import nodemailer from 'nodemailer';
import { formatEmail, formatTelegram } from './format.js';

const TIMEOUT_MS = 5000;

const fail = (kind) => Object.assign(new Error(kind), { kind });

// Вид ошибки для журнала: наш собственный, таймаут или короткий код (EAUTH, ECONNECTION…). Текст ошибки не берём:
// в нём могут оказаться адреса и куски заявки.
function kindOf(err) {
  if (typeof err?.kind === 'string') return err.kind;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  const code = err?.code ?? err?.cause?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{2,24}$/.test(code)) return code.toLowerCase();
  return 'error';
}

// Общий потолок на канал: SMTP проходит несколько стадий (соединение, приветствие, ответ), у каждой своя пятёрка.
function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(fail('timeout')), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

function pick(env, names) {
  const out = {};
  for (const name of names) {
    out[name] = clean(env?.[name]);
    if (!out[name]) throw fail('config'); // нет настройки: канал не пытается выйти в сеть
  }
  return out;
}

async function sendTelegram(lead, at, env, doFetch) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = pick(env, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']);
  const response = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Без parse_mode: Telegram показывает простой текст, разметка из сообщения посетителя не сработает.
    body: JSON.stringify({ chat_id: chatId, text: formatTelegram(lead, at), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw fail(`http_${response.status}`);
}

async function sendEmail(lead, at, env, sendMailOverride) {
  const cfg = pick(env, ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_TO']);
  const port = Number(cfg.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('config');

  const message = { from: cfg.MAIL_FROM, to: cfg.MAIL_TO, ...formatEmail(lead, at) };
  const send = sendMailOverride ?? ((m) => sendViaSmtp(cfg, port, m));
  await withTimeout(send(message), TIMEOUT_MS);
}

async function sendViaSmtp(cfg, port, message) {
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port,
    secure: port === 465, // 465: TLS сразу; на других портах STARTTLS обязателен, пароль в открытом виде не уходит
    requireTLS: port !== 465,
    auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    await transport.sendMail(message);
  } finally {
    transport.close();
  }
}

/**
 * @param {{name: string, contact: string, service: string, message: string}} lead
 * @param {Record<string, string | undefined>} env
 * @param {{fetch?: typeof fetch, sendMail?: (message: object) => Promise<unknown>,
 *   now?: () => Date | number, log?: (line: string) => void}} [io]  подмены для тестов; now и log необязательны
 * @returns {Promise<{email: boolean, telegram: boolean}>}
 */
export async function deliverLead(lead, env, io = {}) {
  const at = new Date(io.now ? io.now() : Date.now());
  const doFetch = io.fetch ?? globalThis.fetch;
  const log = io.log ?? ((line) => console.error(line));

  // Оба канала стартуют сразу (до первого await), каждый сам проверяет свои настройки.
  const [email, telegram] = await Promise.allSettled([
    sendEmail(lead, at, env, io.sendMail),
    sendTelegram(lead, at, env, doFetch),
  ]);

  const report = (channel, outcome) => {
    if (outcome.status === 'fulfilled') return true;
    log(`lead delivery failed: channel=${channel} kind=${kindOf(outcome.reason)}`);
    return false;
  };
  return { email: report('email', email), telegram: report('telegram', telegram) };
}
