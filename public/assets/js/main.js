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
    if (themeBtn) {
      themeBtn.setAttribute('aria-label', text);
      themeBtn.title = text;
    }
  }
  applyMode(root.dataset.mode || 'system', false);
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var next = modes[(modes.indexOf(root.dataset.mode) + 1) % modes.length];
    applyMode(next, true);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });

  /* Тень шапки после первого экрана */
  var header = document.getElementById('site-header');
  function onScroll() { if (header) header.classList.toggle('scrolled', window.scrollY > 8); }
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
  if (menu) menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { if (menu.hidePopover) menu.hidePopover(); });
  });
  /* Меню на весь экран не удерживает фокус: Tab из последнего пункта (или Shift+Tab из первого) увёл бы его
     на кнопки под меню, где его не видно (WCAG 2.4.11). Когда фокус уходит за пределы меню, оно закрывается. */
  if (menu && menu.hidePopover) menu.addEventListener('focusout', function (e) {
    if (e.relatedTarget && !menu.contains(e.relatedTarget)) menu.hidePopover();
  });

  /* Ссылки-заглушки href="#" не прокручивают страницу к началу */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#"]');
    if (a) e.preventDefault();
  });

  /* Цели Метрики: один делегированный обработчик. Отправляет их leadAnalytics.goal (consent.js),
     а он молчит, пока нет согласия. Если consent.js не загрузился, goal() просто ничего не делает. */
  function goal(name) {
    try {
      var la = window.leadAnalytics;
      if (la && typeof la.goal === 'function') la.goal(name);
    } catch (err) { /* аналитика не должна ломать страницу */ }
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var marked = t.closest('[data-goal]');
    if (marked) goal(marked.getAttribute('data-goal'));
    var a = t.closest('a[href]');
    if (!a) return;
    var href = (a.getAttribute('href') || '').trim().toLowerCase();
    /* Ссылка внутри .project считается только открытием проекта (в том числе демо-бота в Telegram);
       telegram_click измеряет связь с владельцем, поэтому только для ссылок вне .project. */
    if (a.closest('.project')) {
      if (href && href.charAt(0) !== '#') goal('project_open');
    } else if (href.indexOf('https://t.me/') === 0 || href.indexOf('tg://') === 0) {
      goal('telegram_click');
    }
  });

  /* Кнопки «Обсудить» подставляют услугу в форму */
  var select = document.getElementById('f-service');
  document.querySelectorAll('[data-service]').forEach(function (a) {
    a.addEventListener('click', function () { if (select) select.value = a.dataset.service; });
  });

  /* Форма заявки. Если на странице формы нет (политика, 404), блок ничего не делает.
     Без JavaScript форма не работает: кнопка отправки в разметке отключена, рядом <noscript> с запасными контактами.
     Без JavaScript работает и обычная проверка браузера, поэтому novalidate ставится здесь, а не в разметке. */
  var leadForm = document.getElementById('lead-form');
  if (leadForm) initLeadForm(leadForm);

  function initLeadForm(form) {
    form.noValidate = true;
    var result = document.getElementById('form-result');
    var submit = document.getElementById('f-submit');
    var elapsed = form.elements['elapsed_ms'];
    var label = submit.firstChild.textContent;
    var started = Date.now();
    var sending = false;
    submit.disabled = false;

    /* Поля в порядке на странице: по нему выбирается первое с ошибкой. key — имя поля в ответе сервера. */
    var fields = [
      { key: 'name', el: document.getElementById('f-name'), err: document.getElementById('e-name'), msg: 'Напишите, как к вам обращаться', test: function (el) { return el.value.trim().length > 0; } },
      { key: 'contact', el: document.getElementById('f-contact'), err: document.getElementById('e-contact'), msg: 'Укажите Telegram, телефон или email, чтобы я мог ответить', test: function (el) { return el.value.trim().length >= 3; } },
      { key: 'message', el: document.getElementById('f-msg'), err: document.getElementById('e-message'), msg: 'Сообщение слишком длинное', test: function (el) { return el.value.trim().length <= 4000; } },
      { key: 'consent', el: document.getElementById('f-consent'), err: document.getElementById('e-consent'), msg: 'Нужно согласие на обработку данных', test: function (el) { return el.checked; } }
    ];
    function setError(f, text) { f.err.textContent = text; f.el.setAttribute('aria-invalid', 'true'); }
    function clearError(f) { f.err.textContent = ''; f.el.removeAttribute('aria-invalid'); }
    fields.forEach(function (f) {
      f.el.addEventListener('input', function () { if (f.test(f.el)) clearError(f); });
      f.el.addEventListener('change', function () { if (f.test(f.el)) clearError(f); });
    });

    function setSending(on) {
      sending = on;
      submit.disabled = on;
      submit.firstChild.textContent = on ? 'Отправляю… ' : label;
      form.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    function show(kind, title, text) {
      var box = document.createElement('div');
      box.className = 'result ' + kind;
      box.setAttribute('role', kind === 'ok' ? 'status' : 'alert');
      var strong = document.createElement('strong');
      strong.textContent = title;
      var span = document.createElement('span');
      span.textContent = text;
      box.appendChild(strong);
      box.appendChild(document.createTextNode(' '));
      box.appendChild(span);
      result.innerHTML = '';
      result.appendChild(box);
    }
    function showFailure() {
      show('bad', 'Не удалось отправить', 'Напишите мне напрямую: Telegram [ВСТАВИТЬ] · email [ВСТАВИТЬ].');
    }

    /* Ответ сервера: 200 — готово, 400 — ошибки под полями и фокус на первое, 429 — слишком часто, остальное — сбой. */
    function showAnswer(r) {
      var data = r.data || {};
      if (r.status === 200 && data.ok === true) {
        show('ok', 'Заявка отправлена', 'Я свяжусь с вами в течение рабочего дня. Спасибо!');
        goal('form_submit');
        form.reset();
        return;
      }
      if (r.status === 400 && data.errors && typeof data.errors === 'object') {
        var firstBad = null;
        fields.forEach(function (f) {
          if (typeof data.errors[f.key] === 'string') { setError(f, data.errors[f.key]); if (!firstBad) firstBad = f.el; }
        });
        if (firstBad) { firstBad.focus(); return; }
      }
      if (r.status === 429) {
        show('bad', 'Слишком часто.', 'Попробуйте позже или напишите на email [ВСТАВИТЬ].');
        return;
      }
      showFailure();
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (sending) return;
      result.innerHTML = '';
      var firstBad = null;
      fields.forEach(function (f) {
        if (f.test(f.el)) clearError(f);
        else { setError(f, f.msg); if (!firstBad) firstBad = f.el; }
      });
      if (firstBad) { firstBad.focus(); return; }

      /* Время с загрузки страницы: сервер отбрасывает отправку быстрее 3 секунд как робота. */
      if (elapsed) elapsed.value = String(Math.round(window.performance && performance.now ? performance.now() : Date.now() - started));

      setSending(true);
      /* Тело urlencoded, не FormData напрямую: функция Vercel не разбирает multipart. */
      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form))
      }).then(function (res) {
        return res.json().then(function (data) { return data; }, function () { return null; })
          .then(function (data) { return { status: res.status, data: data }; });
      }).then(showAnswer).catch(showFailure).then(function () { setSending(false); });
    });
  }
})();
