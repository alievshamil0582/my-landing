// Логика ответа на POST /api/lead без привязки к Vercel: запрос приходит как { method, fields, ip },
// ответ уходит как { status, body }. Порядок: метод → поля → спам → частота → дубль → доставка.
import { validateLead } from './validate.js';

const reply = (status, body) => ({ status, body });

/**
 * @param {{
 *   deliver: (lead: object, at: Date) => Promise<{email: boolean, telegram: boolean}>,
 *   guard: {allow(ip: string): boolean, isDuplicate(lead: object): boolean, release?(lead: object): void},
 *   now: () => Date | number,
 * }} deps
 * @returns {(req: {method: string, fields: Record<string, string>, ip: string}) => Promise<{status: number, body: object}>}
 */
export function createHandler({ deliver, guard, now }) {
  return async function handle({ method, fields, ip }) {
    if (method !== 'POST') return reply(405, { ok: false, error: 'method' });

    const checked = validateLead(fields);
    if (checked.spam) return reply(200, { ok: true }); // боту не говорим, что он распознан
    if (!checked.ok) return reply(400, { ok: false, errors: checked.errors });

    if (!guard.allow(ip)) return reply(429, { ok: false, error: 'rate' });

    const { lead } = checked;
    if (guard.isDuplicate(lead)) return reply(200, { ok: true }); // повторная отправка: заявка уже ушла

    let sent;
    try {
      sent = await deliver(lead, new Date(now()));
    } catch {
      sent = { email: false, telegram: false };
    }
    if (sent.email || sent.telegram) return reply(200, { ok: true });

    // Не дошло ни одним каналом: посетитель увидит запасные контакты и может повторить, дублем это считаться не должно.
    guard.release?.(lead);
    return reply(502, { ok: false, error: 'delivery' });
  };
}
