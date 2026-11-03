(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Тема: система → светлая → тёмная (ТЗ 6.7) */
  var modes = ['system', 'light', 'dark'];
  var labels = { system: 'как в системе', light: 'светлая', dark: 'тёмная' };
  var themeBtn = document.getElementById('theme-btn');
  function applyMode(m, animate) {
    if (animate && !reduce) { root.classList.add('theme-anim'); setTimeout(function () { root.classList.remove('theme-anim'); }, 400); }
    root.dataset.mode = m;
    if (m === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', m);
    var text = 'Тема: ' + labels[m] + '. Нажмите, чтобы сменить';
    themeBtn.setAttribute('aria-label', text);
    themeBtn.title = text;
  }
  applyMode(root.dataset.mode || 'system', false);
  themeBtn.addEventListener('click', function () {
    var next = modes[(modes.indexOf(root.dataset.mode) + 1) % modes.length];
    applyMode(next, true);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });

  /* Тень шапки после первого экрана */
  var header = document.getElementById('site-header');
  function onScroll() { header.classList.toggle('scrolled', window.scrollY > 8); }
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

  /* Появление блоков при прокрутке (один раз). Если настройка не удалась, показываем всё сразу.
     data-reveal="ready" сообщает скрипту в <head>, что запасной вариант (reveal-all через 3 с) не нужен. */
  try {
    var reveals = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window && !reduce) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: 0.12 });
      reveals.forEach(function (el) { io.observe(el); });
    } else {
      reveals.forEach(function (el) { el.classList.add('in'); });
    }
    root.setAttribute('data-reveal', 'ready');
  } catch (err) {
    root.classList.add('reveal-all');
  }

  /* Подсветка текущего раздела в меню */
  var links = {};
  document.querySelectorAll('.nav-desktop a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && links[e.target.id]) {
          Object.keys(links).forEach(function (k) { links[k].removeAttribute('aria-current'); });
          links[e.target.id].setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(links).forEach(function (id) { var s = document.getElementById(id); if (s) so.observe(s); });
  }

  /* Мобильное меню: закрыть по клику на пункт */
  var menu = document.getElementById('mobile-menu');
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { if (menu.hidePopover) menu.hidePopover(); });
  });

  /* Ссылки-заглушки href="#" не прокручивают страницу к началу */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#"]');
    if (a) e.preventDefault();
  });

  /* Кнопки «Обсудить» подставляют услугу в форму */
  var select = document.getElementById('f-service');
  document.querySelectorAll('[data-service]').forEach(function (a) {
    a.addEventListener('click', function () { select.value = a.dataset.service; });
  });

  /* Форма: проверка полей на странице, отправка пока имитируется (настоящий обработчик подключается отдельно).
     Без JavaScript работает обычная проверка браузера, поэтому novalidate ставится здесь, а не в разметке. */
  var form = document.getElementById('lead-form');
  form.noValidate = true;
  var result = document.getElementById('form-result');
  var submit = document.getElementById('f-submit');
  var fields = [
    { el: document.getElementById('f-name'), err: document.getElementById('e-name'), msg: 'Напишите, как к вам обращаться', test: function (el) { return el.value.trim().length > 0; } },
    { el: document.getElementById('f-contact'), err: document.getElementById('e-contact'), msg: 'Укажите Telegram, телефон или email, чтобы я мог ответить', test: function (el) { return el.value.trim().length >= 3; } },
    { el: document.getElementById('f-consent'), err: document.getElementById('e-consent'), msg: 'Нужно согласие на обработку данных', test: function (el) { return el.checked; } }
  ];
  fields.forEach(function (f) {
    f.el.addEventListener('input', function () { if (f.test(f.el)) { f.err.textContent = ''; f.el.removeAttribute('aria-invalid'); } });
    f.el.addEventListener('change', function () { if (f.test(f.el)) { f.err.textContent = ''; f.el.removeAttribute('aria-invalid'); } });
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    result.innerHTML = '';
    var firstBad = null;
    fields.forEach(function (f) {
      if (f.test(f.el)) { f.err.textContent = ''; f.el.removeAttribute('aria-invalid'); }
      else { f.err.textContent = f.msg; f.el.setAttribute('aria-invalid', 'true'); if (!firstBad) firstBad = f.el; }
    });
    if (firstBad) { firstBad.focus(); return; }

    submit.disabled = true;
    var label = submit.firstChild.textContent;
    submit.firstChild.textContent = 'Отправляю… ';
    setTimeout(function () {
      submit.disabled = false;
      submit.firstChild.textContent = label;
      result.innerHTML = '<div class="result ok" role="status"><strong>Заявка отправлена</strong><span>Я свяжусь с вами в течение рабочего дня. Спасибо!</span></div>';
      form.reset();
    }, 700);
  });
})();
