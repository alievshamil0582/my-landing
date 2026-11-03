// Функция Vercel POST /api/lead. Здесь только разбор запроса Vercel; вся логика в lib/lead/.
// Заявка нигде не хранится: она уходит владельцу на email и в Telegram.
import { createGuard } from '../lib/lead/guard.js';
import { deliverLead } from '../lib/lead/deliver.js';
import { createHandler } from '../lib/lead/handler.js';

// Один guard на модуль: тёплые вызовы одного экземпляра делят память и считают запросы вместе.
const handle = createHandler({
  deliver: (lead, at) => deliverLead(lead, process.env, { now: () => at }),
  guard: createGuard(),
  now: () => new Date(),
});

const FIELDS = ['name', 'contact', 'service', 'message', 'consent', 'website', 'elapsed_ms'];

// Vercel сам разбирает urlencoded и JSON в объект; запасные варианты на случай строки, Buffer или пустого тела.
function parseFields(body) {
  let source = body;
  if (Buffer.isBuffer(source)) source = source.toString('utf8');
  if (typeof source === 'string') source = Object.fromEntries(new URLSearchParams(source));
  if (!source || typeof source !== 'object') return {};

  const fields = {};
  for (const key of FIELDS) {
    let value = source[key];
    if (Array.isArray(value)) value = value[0];
    if (typeof value === 'string') fields[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') fields[key] = String(value);
  }
  return fields;
}

// Адрес посетителя: первая запись x-forwarded-for (Vercel подставляет её сам).
function clientIp(req) {
  const header = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[0] : header;
  const first = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
  return first || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { status, body } = await handle({ method: req.method, fields: parseFields(req.body), ip: clientIp(req) });
    if (status === 405) res.setHeader('Allow', 'POST');
    res.status(status).json(body);
  } catch (err) {
    // Неожиданный сбой: только тип и код ошибки; message и стек могут содержать данные заявки.
    console.error('lead handler failed', err?.name, err?.code);
    res.status(500).json({ ok: false, error: 'server' });
  }
}
