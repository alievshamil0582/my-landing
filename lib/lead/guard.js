// Защита от частых и повторных отправок. Состояние живёт в памяти экземпляра функции,
// экземпляры Vercel не делят память, поэтому это best effort; второй рубеж — кнопка, отключаемая при отправке.
import { createHash } from 'node:crypto';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60_000;
const DUPLICATE_WINDOW_MS = 60_000;

/**
 * @param {{now?: () => number}} [opts]
 * @returns {{allow(ip: string): boolean, isDuplicate(lead: {contact: string, message: string}): boolean,
 *   release(lead: {contact: string, message: string}): void}}
 */
export function createGuard({ now = Date.now } = {}) {
  const hits = new Map(); // ip -> метки времени принятых запросов за последние 10 минут
  const seen = new Map(); // хеш контакта и сообщения -> время первой отправки

  const keyOf = (lead) => createHash('sha256').update(`${lead.contact}\u0000${lead.message}`).digest('hex');

  // Забываем устаревшее, чтобы память не росла.
  function prune(t) {
    for (const [ip, times] of hits) {
      const fresh = times.filter((x) => t - x < RATE_WINDOW_MS);
      if (fresh.length === 0) hits.delete(ip); else hits.set(ip, fresh);
    }
    for (const [key, at] of seen) if (t - at >= DUPLICATE_WINDOW_MS) seen.delete(key);
  }

  return {
    // До 5 принятых запросов за скользящие 10 минут с одного адреса. Отклонённый запрос окно не продлевает.
    allow(ip) {
      const t = now();
      prune(t);
      const times = hits.get(ip) ?? [];
      if (times.length >= RATE_LIMIT) return false;
      hits.set(ip, [...times, t]);
      return true;
    },

    // Та же пара «контакт + сообщение» в течение 60 секунд. Окно считается от первой отправки.
    isDuplicate(lead) {
      const t = now();
      prune(t);
      const key = keyOf(lead);
      if (seen.has(key)) return true;
      seen.set(key, t);
      return false;
    },

    // Заявка не дошла ни одним каналом: повтор посетителя не должен считаться дублем.
    release(lead) {
      seen.delete(keyOf(lead));
    },
  };
}
