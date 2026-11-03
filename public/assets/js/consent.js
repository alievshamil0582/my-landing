/* Согласие на cookie и Яндекс.Метрика.
   Счётчик подключается только после «Принять»: до этого нет ни запроса к mc.yandex.ru, ни cookie Метрики.
   Разметка баннера лежит в каждой странице (#consent-banner), здесь она только показывается, прячется и читает выбор.
   Номер счётчика берётся из <meta name="ym-id">. Пустой или нечисловой: баннера нет, кнопки «Настройки cookie»
   в подвале скрыты, ничего не грузится. */
(function () {
  'use strict';

  var KEY = 'cookie-consent'; /* значения: granted | denied */
  var GOALS = ['cta_discuss_click', 'form_submit', 'telegram_click', 'project_open'];

  var meta = document.querySelector('meta[name="ym-id"]');
  var raw = meta ? (meta.getAttribute('content') || '').trim() : '';
  var counterId = /^\d+$/.test(raw) ? Number(raw) : 0;
  var loaded = false;
  var denied = false; /* на этой странице выбрано «Отклонить»: счётчик уже не выгрузить, но цели в него больше не идут */
  var memory = null; /* выбор на время жизни страницы, если localStorage недоступен */

  function readChoice() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) { /* заблокирован: берём из памяти */ }
    if (v !== 'granted' && v !== 'denied') v = memory;
    return v === 'granted' || v === 'denied' ? v : null;
  }

  function saveChoice(v) {
    memory = v;
    try { localStorage.setItem(KEY, v); } catch (e) { /* остаётся только в памяти страницы */ }
  }

  function loadCounter() {
    if (loaded || !counterId) return;
    loaded = true;
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    window.ym(counterId, 'init', { clickmap: false, trackLinks: true, accurateTrackBounce: true, webvisor: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.appendChild(s);
  }

  /* Цель в Метрику: только после согласия, пока на странице не выбрано «Отклонить», и только из списка GOALS.
     Никогда не бросает и ничего не копит заранее. */
  function goal(name) {
    try {
      if (loaded && !denied && GOALS.indexOf(name) !== -1) window.ym(counterId, 'reachGoal', name);
    } catch (e) { /* аналитика не должна ломать страницу */ }
  }
  window.leadAnalytics = { goal: goal };

  var banner = document.getElementById('consent-banner');
  if (!counterId) return; /* без номера счётчика баннера нет, кнопки «Настройки cookie» остаются скрытыми */

  var choice = readChoice();
  if (choice === 'granted') loadCounter();
  if (!banner) return;

  var opener = null; /* кнопка «Настройки cookie», с которой открыт баннер: после выбора фокус возвращается к ней */

  /* Баннер не модальный и фокус при обычном показе не забирает. После выбора фокус, если он был в баннере,
     возвращается на кнопку «Настройки cookie» (если баннер открыт с неё) или уходит на начало содержимого
     (#main, как у ссылки «Перейти к содержимому»), чтобы не пропасть в никуда. */
  function choose(value) {
    var hadFocus = banner.contains(document.activeElement);
    saveChoice(value);
    denied = value === 'denied'; /* «Принять» после отказа снимает запрет */
    banner.hidden = true;
    if (value === 'granted') loadCounter();
    var back = opener && !opener.hidden ? opener : document.getElementById('main');
    opener = null;
    if (hadFocus && back) {
      if (back.id === 'main' && !back.hasAttribute('tabindex')) back.setAttribute('tabindex', '-1');
      back.focus({ preventScroll: true });
    }
  }

  banner.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-consent]');
    if (btn && banner.contains(btn)) choose(btn.getAttribute('data-consent') === 'granted' ? 'granted' : 'denied');
  });

  /* «Настройки cookie» в подвале (кнопки скрыты в разметке, показываются только здесь): стирают сохранённый выбор,
     снова показывают баннер и переводят в него фокус. Если счётчик уже загружен на этой странице («Принять» было
     раньше), выгрузить его нельзя: отказ действует со следующей загрузки страницы. */
  document.querySelectorAll('[data-consent-reset]').forEach(function (btn) {
    btn.hidden = false;
    btn.addEventListener('click', function () {
      memory = null;
      try { localStorage.removeItem(KEY); } catch (e) { /* заблокирован: выбор жил только в памяти, она уже очищена */ }
      opener = btn;
      banner.hidden = false;
      var first = banner.querySelector('button');
      if (first) first.focus();
    });
  });

  if (!choice) banner.hidden = false;
})();
