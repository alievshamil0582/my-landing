#!/usr/bin/env node
// Проверка перед релизом: node scripts/check.mjs [--release]
// Читает всё в public/ рекурсивно. С --release пометки [ВСТАВИТЬ…] считаются ошибкой.
// Только встроенные модули Node. Код выхода 1, если есть хотя бы одна ОШИБКА.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
const release = process.argv.includes('--release');

const counts = { ОШИБКА: 0, ПРЕДУПРЕЖДЕНИЕ: 0, ОК: 0 };
const say = (level, msg) => { counts[level]++; console.log(`${level} ${msg}`); };
const ok = (m) => say('ОК', m);
const warn = (m) => say('ПРЕДУПРЕЖДЕНИЕ', m);
const err = (m) => say('ОШИБКА', m);

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = existsSync(pub) ? walk(pub).sort() : [];
const ofType = (ext) => files.filter((f) => extname(f).toLowerCase() === ext);
const rel = (f) => relative(root, f).split(sep).join('/');
const read = (f) => readFileSync(f, 'utf8');
// Комментарии затираются пробелами, переводы строк остаются: номера строк не съезжают.
const blank = (m) => m.replace(/[^\n]/g, ' ');
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, blank);
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank);
const htmlPages = () => ofType('.html').map((f) => [f, stripHtml(read(f))]);
const attr = (tag, name) => {
  const m = tag?.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};

// (а) пометки [ВСТАВИТЬ…], [ПОДТВЕРДИТЬ…], [УТОЧНИТЬ…] в публичном тексте (.html без комментариев и .js)
function checkPlaceholders() {
  const re = /\[(?:ВСТАВИТЬ|ПОДТВЕРДИТЬ|УТОЧНИТЬ)[^\]]*\]/g;
  const report = release ? err : warn;
  let found = 0;
  for (const f of [...ofType('.html'), ...ofType('.js')]) {
    const text = extname(f) === '.html' ? stripHtml(read(f)) : read(f);
    for (const m of text.matchAll(re)) {
      found++;
      const line = text.slice(0, m.index).split('\n').length;
      report(`${rel(f)}:${line} пометка ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  if (!found) ok('пометок [ВСТАВИТЬ/ПОДТВЕРДИТЬ/УТОЧНИТЬ] нет');
}

// (б) размер после gzip: весь JS не более 60 КБ, весь CSS не более 30 КБ
function checkSizes() {
  for (const [ext, name, limit] of [['.js', 'JS', 60], ['.css', 'CSS', 30]]) {
    const size = ofType(ext).reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);
    const kb = (size / 1024).toFixed(1);
    if (size > limit * 1024) err(`${name} после gzip: ${kb} КБ, лимит ${limit} КБ`);
    else ok(`${name} после gzip: ${kb} КБ из ${limit} КБ`);
  }
}

// (в) в каждом .html есть lang="ru", <title>, meta description; в index.html ровно один <h1>
function checkHtml() {
  for (const [f, t] of htmlPages()) {
    const problems = [];
    if (!/^ru\b/i.test(attr(t.match(/<html\b[^>]*>/i)?.[0], 'lang') ?? '')) problems.push('нет lang="ru" на <html>');
    if (!t.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1].trim()) problems.push('нет или пустой <title>');
    const hasDescription = [...t.matchAll(/<meta\b[^>]*>/gi)].some(([tag]) =>
      attr(tag, 'name')?.toLowerCase() === 'description' && (attr(tag, 'content') ?? '').trim());
    if (!hasDescription) problems.push('нет meta description или он пустой');
    if (f === join(pub, 'index.html')) {
      const h1 = (t.match(/<h1\b/gi) ?? []).length;
      if (h1 !== 1) problems.push(`в index.html должен быть ровно один <h1>, найдено ${h1}`);
    }
    if (problems.length) problems.forEach((p) => err(`${rel(f)}: ${p}`));
    else ok(`${rel(f)}: lang, title, description${f.endsWith('index.html') ? ', один h1' : ''}`);
  }
  if (!existsSync(join(pub, 'index.html'))) err('нет public/index.html');
}

// (г) нет внешних скриптов, стилей, картинок и шрифтов (mc.yandex.ru грузится динамически из consent.js)
function checkExternal() {
  const isExt = (u) => /^\s*(https?:)?\/\//i.test(u ?? '');
  const anyExt = (u) => (u ?? '').split(',').some(isExt); // srcset: несколько адресов через запятую
  const before = counts.ОШИБКА;
  for (const [f, t] of htmlPages()) {
    for (const [tag] of t.matchAll(/<(?:script|link|img|source)\b[^>]*>/gi)) {
      const name = tag.match(/^<(\w+)/)[1].toLowerCase();
      const rels = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
      const loads = rels.some((r) => ['stylesheet', 'preload', 'modulepreload'].includes(r));
      const urls = name === 'script' ? [attr(tag, 'src')]
        : name === 'link' ? (loads ? [attr(tag, 'href')] : [])
          : [attr(tag, 'src'), attr(tag, 'srcset')];
      const url = urls.find(anyExt);
      if (url) err(`${rel(f)}: внешний ресурс <${name}> ${url}`);
    }
  }
  for (const f of ofType('.css')) {
    for (const m of stripCss(read(f)).matchAll(/url\(\s*["']?([^"')]+)|@import\s+["']([^"']+)/gi)) {
      if (isExt(m[1] ?? m[2])) err(`${rel(f)}: внешний ресурс ${(m[1] ?? m[2]).trim()}`);
    }
  }
  if (counts.ОШИБКА === before) ok('внешних скриптов, стилей, картинок и шрифтов нет');
}

// (д) контраст токенов из styles.css по WCAG: текст не менее 4,5:1, рамки полей не менее 3:1
const props = (body) => Object.fromEntries(
  [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const blocks = (css, re) => Object.assign({}, ...[...css.matchAll(re)].map((m) => props(m[1])));
const hex6 = (v) => {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v ?? '')?.[1];
  return h && (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
};
const luminance = (hex) => {
  const [r, g, b] = hex.match(/../g).map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const fmt = (r) => (Math.floor(r * 100) / 100).toFixed(2); // вниз, чтобы 4,499 не выглядело как 4,50
const PAIRS = [['--text', '--bg', 4.5], ['--muted', '--bg', 4.5], ['--accent', '--bg', 4.5],
  ['--on-accent', '--accent', 4.5], ['--field-border', '--bg', 3], ['--field-border', '--surface', 3]];

function checkContrast() {
  const cssFile = join(pub, 'assets/css/styles.css');
  if (!existsSync(cssFile)) return err('контраст: нет assets/css/styles.css');
  const css = stripCss(read(cssFile));
  const light = blocks(css, /:root\s*\{([^}]*)\}/g);
  const dark = blocks(css, /:root\[data-theme="dark"\]\s*\{([^}]*)\}/g);
  const media = blocks(css, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/g);
  const absent = Object.entries({ ':root': light, ':root[data-theme="dark"]': dark, '@media dark': media })
    .filter(([, b]) => !Object.keys(b).length).map(([n]) => n);
  if (absent.length) return err(`контраст: не найдены блоки токенов: ${absent.join(', ')}`);

  const drift = [...new Set([...Object.keys(dark), ...Object.keys(media)])].filter((k) => dark[k] !== media[k]);
  for (const k of drift) err(`тёмная тема расходится: ${k} = ${dark[k] ?? 'нет'} в [data-theme="dark"], ${media[k] ?? 'нет'} в @media`);
  if (!drift.length) ok('тёмная тема: токены в @media и в [data-theme="dark"] совпадают');

  for (const [name, tokens] of [['светлая тема', light], ['тёмная тема', { ...light, ...dark }]]) {
    const shown = [];
    let failed = false;
    for (const [fg, bg, min] of PAIRS) {
      const [a, b] = [hex6(tokens[fg]), hex6(tokens[bg])];
      if (!a || !b) { failed = true; err(`контраст, ${name}: ${fg} или ${bg} не задан в виде hex`); continue; }
      const r = ratio(a, b);
      if (r < min) { failed = true; err(`контраст, ${name}: ${fg} на ${bg} = ${fmt(r)}, нужно не менее ${min}`); }
      else shown.push(`${fg.slice(2)}/${bg.slice(2)} ${fmt(r)}`);
    }
    if (!failed) ok(`контраст, ${name}: ${shown.join(', ')}`);
  }
}

if (!files.length) {
  err('в public/ нет файлов или папки нет');
} else {
  checkPlaceholders();
  checkSizes();
  checkHtml();
  checkExternal();
  checkContrast();
}

const failed = counts.ОШИБКА > 0;
console.log(failed
  ? `ОШИБКА проверка не пройдена: ошибок ${counts.ОШИБКА}, предупреждений ${counts.ПРЕДУПРЕЖДЕНИЕ}`
  : `ОК проверка пройдена: предупреждений ${counts.ПРЕДУПРЕЖДЕНИЕ}${release ? '' : ' (без --release пометки не блокируют)'}`);
process.exitCode = failed ? 1 : 0;
