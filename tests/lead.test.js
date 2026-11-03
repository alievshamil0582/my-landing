// Тесты формы заявок: функции вызываются напрямую, без сети; Telegram и почта подменены.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { validateLead } from '../lib/lead/validate.js';
import { formatEmail, formatTelegram } from '../lib/lead/format.js';
import { createGuard } from '../lib/lead/guard.js';
import { deliverLead } from '../lib/lead/deliver.js';
import { createHandler } from '../lib/lead/handler.js';
import apiHandler from '../api/lead.js';

const MSG = {
  name: 'Напишите, как к вам обращаться',
  contact: 'Укажите Telegram, телефон или email, чтобы я мог ответить',
  consent: 'Нужно согласие на обработку данных',
  message: 'Сообщение слишком длинное',
};

const ENV = {
  TELEGRAM_BOT_TOKEN: '123:test-token',
  TELEGRAM_CHAT_ID: '4242',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '465',
  SMTP_USER: 'robot',
  SMTP_PASS: 'secret',
  MAIL_FROM: 'site@example.test',
  MAIL_TO: 'owner@example.test',
};
const ENV_KEYS = Object.keys(ENV);

const AT = new Date('2026-11-03T16:57:12Z'); // 19:57:12 по Москве

const fields = (over = {}) => ({
  name: 'Анна', contact: '@anna', service: 'Сайт', message: 'Нужен сайт для кафе',
  consent: 'on', website: '', elapsed_ms: '5000', ...over,
});
const lead = (over = {}) => ({ name: 'Анна', contact: '@anna', service: 'Сайт', message: 'Нужен сайт для кафе', ...over });

// Подмены сети и почты. Каждая запоминает вызовы.
const spyFetch = (impl = () => ({ ok: true, status: 200 })) => {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
  fn.calls = calls;
  return fn;
};
const spyMail = (impl = () => ({ accepted: ['owner@example.test'] })) => {
  const calls = [];
  const fn = async (message) => { calls.push(message); return impl(message); };
  fn.calls = calls;
  return fn;
};
const reject = (err) => () => { throw err; };
const silent = () => {};

// Обработчик с настоящим guard на управляемых часах; доставка — подмена, которая считает вызовы.
function makeHandler({ result = { email: true, telegram: true } } = {}) {
  const calls = [];
  let t = 1_000_000;
  const guard = createGuard({ now: () => t });
  const deliver = async (l, at) => { calls.push({ lead: l, at }); return result; };
  const handle = createHandler({ deliver, guard, now: () => new Date(t) });
  return { handle, calls, advance: (ms) => { t += ms; } };
}
const post = (handle, f, ip = '203.0.113.1') => handle({ method: 'POST', fields: f, ip });

// Обработчик с настоящей доставкой (deliverLead) поверх подмен сети и почты.
function makeWiredHandler({ env = ENV, fetch, sendMail }) {
  const guard = createGuard();
  const deliver = (l, at) => deliverLead(l, env, { fetch, sendMail, now: () => at, log: silent });
  return createHandler({ deliver, guard, now: () => new Date(AT) });
}

// ---------- Обработчик: контракт POST /api/lead ----------

test('valid lead → 200 {ok:true}, deliver called once with the lead', async () => {
  const { handle, calls } = makeHandler();
  const res = await post(handle, fields());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].lead, lead());
});

test('empty name, contact and no consent → 400 with the three exact messages', async () => {
  const { handle, calls } = makeHandler();
  const f = fields({ name: '', contact: '' });
  delete f.consent;
  const res = await post(handle, f);
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.deepEqual(res.body.errors, { name: MSG.name, contact: MSG.contact, consent: MSG.consent });
  assert.equal(calls.length, 0);
});

test('honeypot filled → 200, deliver not called', async () => {
  const { handle, calls } = makeHandler();
  const res = await post(handle, fields({ website: 'http://spam.example' }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 0);
});

test('elapsed_ms 1000 or missing → 200, deliver not called', async () => {
  const { handle, calls } = makeHandler();
  const tooFast = await post(handle, fields({ elapsed_ms: '1000' }));
  const f = fields();
  delete f.elapsed_ms;
  const missing = await post(handle, f);
  const garbage = await post(handle, fields({ elapsed_ms: 'abc' }));
  for (const res of [tooFast, missing, garbage]) {
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  }
  assert.equal(calls.length, 0);
});

test('same contact+message twice within 60 s → 200 both times, deliver called once', async () => {
  const { handle, calls } = makeHandler();
  const first = await post(handle, fields());
  const second = await post(handle, fields());
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { ok: true });
  assert.equal(calls.length, 1);
});

test('same contact+message after 60 s is delivered again, a different message at once is not a duplicate', async () => {
  const { handle, calls, advance } = makeHandler();
  await post(handle, fields());
  await post(handle, fields({ message: 'Другое сообщение' }));
  assert.equal(calls.length, 2);
  advance(60_001);
  await post(handle, fields());
  assert.equal(calls.length, 3);
});

test('sixth request from one IP within 10 min → 429', async () => {
  const { handle, calls, advance } = makeHandler();
  for (let i = 1; i <= 5; i++) {
    const res = await post(handle, fields({ contact: `@anna${i}` }));
    assert.equal(res.status, 200, `request ${i}`);
  }
  const sixth = await post(handle, fields({ contact: '@anna6' }));
  assert.equal(sixth.status, 429);
  assert.deepEqual(sixth.body, { ok: false, error: 'rate' });
  assert.equal(calls.length, 5);

  const otherIp = await post(handle, fields({ contact: '@anna7' }), '203.0.113.2');
  assert.equal(otherIp.status, 200);

  advance(10 * 60_000 + 1);
  const later = await post(handle, fields({ contact: '@anna8' }));
  assert.equal(later.status, 200);
});

test('message of 4001 chars → 400 with errors.message', async () => {
  const { handle, calls } = makeHandler();
  const res = await post(handle, fields({ message: 'я'.repeat(4001) }));
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.errors, { message: MSG.message });
  assert.equal(calls.length, 0);

  const edge = await post(handle, fields({ message: 'я'.repeat(4000) }));
  assert.equal(edge.status, 200);
  assert.equal(calls.length, 1);
});

test('GET → 405', async () => {
  const { handle, calls } = makeHandler();
  const res = await handle({ method: 'GET', fields: {}, ip: '203.0.113.1' });
  assert.equal(res.status, 405);
  assert.equal(res.body.ok, false);
  assert.equal(calls.length, 0);
});

// ---------- Доставка и оформление ----------

test('message with <script> → email html has &lt;script&gt;, telegram text is plain', async () => {
  const evil = lead({ message: '<script>alert(1)</script> & "q"' });

  const mail = formatEmail(evil, AT);
  assert.ok(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
  assert.ok(!mail.html.includes('<script'));
  assert.ok(mail.text.includes('<script>alert(1)</script> & "q"'), 'text part stays plain');

  const fetch = spyFetch();
  const sendMail = spyMail();
  await deliverLead(evil, ENV, { fetch, sendMail, now: () => AT, log: silent });
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.ok(body.text.includes('<script>alert(1)</script> & "q"'), 'telegram text is not escaped');
  assert.ok(!('parse_mode' in body), 'no parse_mode, so Telegram shows plain text');
  assert.ok(!sendMail.calls[0].html.includes('<script'));
});

test('email and telegram both contain name, contact, service and message', async () => {
  const l = lead({ name: 'Иван Петров', contact: '+7 900 123-45-67', service: 'Telegram-бот', message: 'Бот для заказов\nвторая строка' });
  const fetch = spyFetch();
  const sendMail = spyMail();
  await deliverLead(l, ENV, { fetch, sendMail, now: () => AT, log: silent });

  const telegramText = JSON.parse(fetch.calls[0].init.body).text;
  const { text, html } = sendMail.calls[0];
  for (const where of [telegramText, text, html]) {
    for (const part of ['Иван Петров', '+7 900 123-45-67', 'Telegram-бот', 'Бот для заказов', 'вторая строка']) {
      assert.ok(where.includes(part), `missing "${part}"`);
    }
  }
  assert.equal(telegramText, formatTelegram(l, AT));
});

test('telegram fails, email ok → 200', async () => {
  const sendMail = spyMail();
  const byThrow = makeWiredHandler({ fetch: spyFetch(reject(new Error('blocked'))), sendMail });
  const res = await post(byThrow, fields());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sendMail.calls.length, 1);

  const byHttp = makeWiredHandler({ fetch: spyFetch(() => ({ ok: false, status: 403 })), sendMail: spyMail() });
  assert.equal((await post(byHttp, fields())).status, 200);
});

test('email fails, telegram ok → 200', async () => {
  const fetch = spyFetch();
  const handle = makeWiredHandler({ fetch, sendMail: spyMail(reject(new Error('smtp down'))) });
  const res = await post(handle, fields());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(fetch.calls.length, 1);
});

test('both fail → 502', async () => {
  const handle = makeWiredHandler({ fetch: spyFetch(reject(new Error('blocked'))), sendMail: spyMail(reject(new Error('smtp down'))) });
  const res = await post(handle, fields());
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { ok: false, error: 'delivery' });
});

test('both fail, then the visitor retries within 60 s → delivered, not swallowed as a duplicate', async () => {
  let down = true;
  const fetch = spyFetch(() => (down ? { ok: false, status: 502 } : { ok: true, status: 200 }));
  const sendMail = spyMail(() => { if (down) throw new Error('smtp down'); return {}; });
  const handle = makeWiredHandler({ fetch, sendMail });
  assert.equal((await post(handle, fields())).status, 502);
  down = false;
  const retry = await post(handle, fields());
  assert.equal(retry.status, 200);
  assert.equal(sendMail.calls.length, 2);
  assert.equal(fetch.calls.length, 2);
});

test('deliver itself throws → 502 {ok:false, error:"delivery"}, guard released so a retry within 60 s is delivered', async () => {
  let broken = true;
  const calls = [];
  const deliver = async (l) => { calls.push(l); if (broken) throw new Error('unexpected failure'); return { email: true, telegram: true }; };
  const handle = createHandler({ deliver, guard: createGuard(), now: () => new Date(AT) });
  const res = await post(handle, fields());
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { ok: false, error: 'delivery' });
  broken = false;
  const retry = await post(handle, fields());
  assert.equal(retry.status, 200);
  assert.equal(calls.length, 2, 'the retry is not swallowed as a duplicate');
});

test('no env configured → 502 and no network call', async () => {
  const fetch = spyFetch();
  const sendMail = spyMail();
  const handle = makeWiredHandler({ env: {}, fetch, sendMail });
  const res = await post(handle, fields());
  assert.equal(res.status, 502);
  assert.equal(fetch.calls.length, 0);
  assert.equal(sendMail.calls.length, 0);
});

test('a channel with partly missing env is skipped without a network call, the other still works', async () => {
  const { TELEGRAM_CHAT_ID, ...noChat } = ENV;
  const fetch = spyFetch();
  const sendMail = spyMail();
  const result = await deliverLead(lead(), noChat, { fetch, sendMail, now: () => AT, log: silent });
  assert.deepEqual(result, { email: true, telegram: false });
  assert.equal(fetch.calls.length, 0);

  const { MAIL_TO, ...noTo } = ENV;
  const result2 = await deliverLead(lead(), { ...noTo, TELEGRAM_CHAT_ID }, { fetch, sendMail, now: () => AT, log: silent });
  assert.deepEqual(result2, { email: false, telegram: true });
  assert.equal(sendMail.calls.length, 1, 'only the first run sent mail');
});

test('telegram request: bot URL, POST, JSON chat_id and text, abort signal for the 5 s timeout', async () => {
  const fetch = spyFetch();
  await deliverLead(lead(), ENV, { fetch, sendMail: spyMail(), now: () => AT, log: silent });
  const { url, init } = fetch.calls[0];
  assert.equal(url, `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.signal.aborted, false);
  const body = JSON.parse(init.body);
  assert.equal(body.chat_id, '4242');
  assert.equal(typeof body.text, 'string');
});

test('mail message: from and to come from env, subject carries service and name', async () => {
  const sendMail = spyMail();
  await deliverLead(lead({ name: 'Анна', service: 'ИИ-агент' }), ENV, { fetch: spyFetch(), sendMail, now: () => AT, log: silent });
  const m = sendMail.calls[0];
  assert.equal(m.from, 'site@example.test');
  assert.equal(m.to, 'owner@example.test');
  assert.equal(m.subject, 'Заявка с сайта: ИИ-агент — Анна');
});

test('email that never answers fails after 5 s, telegram still counts', { timeout: 3000 }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = deliverLead(lead(), ENV, {
      fetch: spyFetch(), sendMail: () => new Promise(() => {}), now: () => AT, log: silent,
    });
    mock.timers.tick(4999);
    mock.timers.tick(1);
    assert.deepEqual(await pending, { email: false, telegram: true });
  } finally {
    mock.timers.reset();
  }
});

test('failure log names the channel and the error kind, never personal data', async () => {
  const lines = [];
  const l = lead({ name: 'Секретное Имя', contact: '+7 999 000-11-22', message: 'Секретный текст' });
  const mailError = Object.assign(new Error('550 rejected owner@example.test for Секретное Имя'), { code: 'EENVELOPE' });
  await deliverLead(l, ENV, {
    fetch: spyFetch(() => ({ ok: false, status: 403 })),
    sendMail: spyMail(reject(mailError)),
    now: () => AT,
    log: (line) => lines.push(String(line)),
  });
  const joined = lines.join('\n');
  assert.equal(lines.length, 2);
  assert.match(joined, /telegram/);
  assert.match(joined, /http_403/);
  assert.match(joined, /email/);
  assert.match(joined, /eenvelope/);
  for (const secret of ['Секретное Имя', '+7 999 000-11-22', 'Секретный текст', 'owner@example.test', '123:test-token']) {
    assert.ok(!joined.includes(secret), `log leaks ${secret}`);
  }
});

// ---------- Оформление писем и сообщений ----------

test('formatEmail: subject cuts the name to 60 chars, body lists the time in Moscow time', () => {
  const longName = 'А'.repeat(80);
  const { subject, text, html } = formatEmail(lead({ name: longName }), AT);
  assert.equal(subject, `Заявка с сайта: Сайт — ${'А'.repeat(60)}`);
  assert.ok(text.includes('03.11.2026') && text.includes('19:57'));
  assert.ok(html.includes('03.11.2026') && html.includes('19:57'));
});

test('formatEmail: a name with line breaks cannot break the subject header', () => {
  const { subject } = formatEmail(lead({ name: 'Анна\r\nBcc: evil@example.test' }), AT);
  assert.ok(!/[\r\n]/.test(subject));
});

test('formatTelegram: plain text, always within the 4096-char Telegram limit, tail cut with a note', () => {
  const longest = lead({ name: 'Я'.repeat(100), contact: 'к'.repeat(200), message: '😀'.repeat(2000) });
  const text = formatTelegram(longest, AT);
  assert.ok(text.length <= 4096);
  assert.ok(text.includes('полный текст в письме'));
  assert.ok(!/[\uD800-\uDBFF]$/.test(text), 'no half of a surrogate pair at the end');

  const short = formatTelegram(lead(), AT);
  assert.ok(!short.includes('полный текст в письме'));
  assert.ok(short.includes('Нужен сайт для кафе'));
});

// ---------- Проверка полей ----------

test('validateLead: trims, keeps a known service, replaces an unknown one with «Пока не знаю»', () => {
  const ok = validateLead(fields({ name: '  Анна  ', contact: ' @anna ', service: 'ИИ-агент', message: '  привет\r\nмир  ' }));
  assert.deepEqual(ok, { ok: true, lead: { name: 'Анна', contact: '@anna', service: 'ИИ-агент', message: 'привет\nмир' } });

  const unknown = validateLead(fields({ service: 'Взлом пентагона' }));
  assert.equal(unknown.lead.service, 'Пока не знаю');
  const missing = fields();
  delete missing.service;
  assert.equal(validateLead(missing).lead.service, 'Пока не знаю');
});

test('validateLead: length limits for name (1–100) and contact (3–200), message may be empty', () => {
  assert.ok(validateLead(fields({ name: 'a'.repeat(100) })).ok);
  assert.equal(validateLead(fields({ name: 'a'.repeat(101) })).ok, false);
  assert.ok(validateLead(fields({ contact: 'abc' })).ok);
  assert.equal(validateLead(fields({ contact: 'ab' })).errors.contact, MSG.contact);
  assert.ok(validateLead(fields({ contact: 'a'.repeat(200) })).ok);
  assert.equal(validateLead(fields({ contact: 'a'.repeat(201) })).ok, false);
  assert.equal(validateLead(fields({ message: '' })).lead.message, '');
  assert.equal(validateLead(fields({ name: '   ' })).errors.name, MSG.name);
});

test('validateLead: consent must be a checked checkbox, honeypot must be empty, time at least 3000 ms', () => {
  assert.equal(validateLead(fields({ consent: '' })).errors.consent, MSG.consent);
  assert.equal(validateLead(fields({ consent: 'off' })).errors.consent, MSG.consent);
  assert.ok(validateLead(fields({ consent: 'on' })).ok);
  assert.deepEqual(validateLead(fields({ website: 'x' })), { spam: true });
  assert.deepEqual(validateLead(fields({ elapsed_ms: '2999' })), { spam: true });
  assert.ok(validateLead(fields({ elapsed_ms: '3000' })).ok);
});

test('validateLead: field errors are reported before spam checks, and odd value types do not throw', () => {
  const res = validateLead(fields({ name: '', website: 'x' }));
  assert.equal(res.ok, false);
  assert.equal(res.errors.name, MSG.name);
  assert.doesNotThrow(() => validateLead({ name: ['a', 'b'], contact: 123456, message: { x: 1 }, consent: true }));
  assert.doesNotThrow(() => validateLead(undefined));
});

// ---------- Защита в памяти ----------

test('guard: allow() counts per IP in a sliding 10-minute window, isDuplicate() remembers a lead for 60 s', () => {
  let t = 0;
  const guard = createGuard({ now: () => t });
  for (let i = 0; i < 5; i++) assert.equal(guard.allow('1.1.1.1'), true);
  assert.equal(guard.allow('1.1.1.1'), false);
  assert.equal(guard.allow('2.2.2.2'), true);
  t = 10 * 60_000;
  assert.equal(guard.allow('1.1.1.1'), true);

  t = 0;
  const g2 = createGuard({ now: () => t });
  assert.equal(g2.isDuplicate(lead()), false);
  t = 59_999;
  assert.equal(g2.isDuplicate(lead()), true);
  assert.equal(g2.isDuplicate(lead({ message: 'иначе' })), false);
  t = 60_000;
  assert.equal(g2.isDuplicate(lead()), false, 'the window is counted from the first request and is not extended by duplicates');
});

// ---------- Точка входа Vercel (api/lead.js): разбор запроса ----------

function fakeRes() {
  return {
    headers: {}, statusCode: undefined, payload: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; },
  };
}
async function callApi(req) {
  const res = fakeRes();
  await apiHandler({ method: 'POST', headers: {}, ...req }, res);
  return res;
}

// В этих проверках env не задан: доставка не обращается к сети и отвечает 502, а 400 и 405 приходят раньше доставки.
async function withNoEnv(run) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  const netCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...a) => { netCalls.push(a); throw new Error('network is off in tests'); };
  const errors = mock.method(console, 'error', () => {});
  try { await run({ netCalls, errors }); } finally {
    errors.mock.restore();
    globalThis.fetch = realFetch;
    for (const k of ENV_KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
}

test('api/lead.js: object body, urlencoded string body and Buffer body are all parsed', async () => {
  await withNoEnv(async ({ netCalls }) => {
    const bodies = [
      fields({ contact: '@api-object' }),
      new URLSearchParams(fields({ contact: '@api-string' })).toString(),
      Buffer.from(new URLSearchParams(fields({ contact: '@api-buffer' })).toString()),
    ];
    for (const body of bodies) {
      const res = await callApi({ body, headers: { 'x-forwarded-for': '198.51.100.10' } });
      assert.equal(res.statusCode, 502, 'valid lead reaches delivery (502 because env is empty)');
      assert.deepEqual(res.payload, { ok: false, error: 'delivery' });
    }
    assert.equal(netCalls.length, 0);
  });
});

test('api/lead.js: missing or broken body → 400, never an exception; GET → 405 with Allow: POST', async () => {
  await withNoEnv(async () => {
    for (const body of [undefined, null, '', 42, '{not-urlencoded']) {
      const res = await callApi({ body, headers: { 'x-forwarded-for': '198.51.100.11' } });
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.ok, false);
    }
    const get = await callApi({ method: 'GET' });
    assert.equal(get.statusCode, 405);
    assert.equal(get.headers.allow, 'POST');
  });
});

test('api/lead.js: the client IP is the first x-forwarded-for entry; the limit works across warm calls', async () => {
  await withNoEnv(async () => {
    const xff = '198.51.100.20, 10.0.0.1, 10.0.0.2';
    const codes = [];
    for (let i = 1; i <= 6; i++) {
      const res = await callApi({ body: fields({ contact: `@rate${i}` }), headers: { 'x-forwarded-for': xff } });
      codes.push(res.statusCode);
    }
    assert.deepEqual(codes, [502, 502, 502, 502, 502, 429]);
    // тот же первый адрес, другой хвост цепочки: это тот же посетитель
    const same = await callApi({ body: fields({ contact: '@rate7' }), headers: { 'x-forwarded-for': '198.51.100.20, 10.9.9.9' } });
    assert.equal(same.statusCode, 429);
    // другой первый адрес: другой посетитель
    const other = await callApi({ body: fields({ contact: '@rate8' }), headers: { 'x-forwarded-for': '198.51.100.21' } });
    assert.equal(other.statusCode, 502);
  });
});

test('api/lead.js: failure log carries channel names only, the answer carries Cache-Control: no-store', async () => {
  await withNoEnv(async ({ errors }) => {
    const res = await callApi({ body: fields({ name: 'ЛичноеИмя', contact: '@secret-contact' }), headers: { 'x-forwarded-for': '198.51.100.30' } });
    assert.equal(res.headers['cache-control'], 'no-store');
    const logged = errors.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');
    assert.match(logged, /email/);
    assert.match(logged, /telegram/);
    assert.ok(!logged.includes('ЛичноеИмя') && !logged.includes('@secret-contact'));
  });
});

test('api/lead.js: an unexpected exception → 500 {ok:false, error:"server"}, the log has error name and code but no visitor data', async () => {
  await withNoEnv(async ({ errors }) => {
    const res = fakeRes();
    const req = {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.40' },
      // обращение к body бросает ошибку, в тексте которой лежат данные посетителя (как могло бы быть в разборе тела)
      get body() { throw Object.assign(new TypeError('cannot parse ЛичноеИмя @secret-contact'), { code: 'ERR_TEST' }); },
    };
    await apiHandler(req, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.payload, { ok: false, error: 'server' });
    assert.equal(res.headers['cache-control'], 'no-store');
    const logged = errors.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');
    assert.match(logged, /TypeError/);
    assert.match(logged, /ERR_TEST/);
    assert.ok(!logged.includes('ЛичноеИмя') && !logged.includes('@secret-contact') && !logged.includes('cannot parse'));
  });
});
