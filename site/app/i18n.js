/* Sali — язык интерфейса (русский / English / עברית).
   Исходные строки в коде — русские. Для английского и иврита этот файл переводит всё, что попадает на страницу:
   текст и подписи (placeholder, title, aria-label, alt) — по словарю из i18n.<lang>.js.
   Перевод идёт «прогонами» — подряд идущими русскими словами между цифрами и латиницей; прогон переводится,
   только если словарь покрывает его целиком (иначе остаётся как есть — так не портятся названия рецептов). */
'use strict';
const UI_LANG = (() => {
  const ok = l => ['ru', 'en', 'he'].includes(l);
  try {
    const q = new URLSearchParams(location.search), l = q.get('lang');
    if (ok(l)) {   // ?lang=en — пришли с лендинга: запоминаем язык и убираем параметр из адреса
      localStorage.setItem('sali.lang', JSON.stringify(l));
      q.delete('lang');
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    }
    const s = JSON.parse(localStorage.getItem('sali.lang') || '"ru"');
    return ok(s) ? s : 'ru';
  } catch (e) { return 'ru'; }
})();
const LOCALE = { ru: 'ru-RU', en: 'en-GB', he: 'he-IL' }[UI_LANG];
document.documentElement.lang = UI_LANG;
document.documentElement.dir = UI_LANG === 'he' ? 'rtl' : 'ltr';
// словарь нужного языка грузится сразу, до основного кода (тот же сайт, синхронно)
if (UI_LANG !== 'ru') document.write(`<script src="i18n.${UI_LANG}.js?v=dev"><\/script>`);

const I18N = {
  dict: null, words: null,
  CYR: /[А-Яа-яЁё]/,
  RUN: /[А-Яа-яЁё](?:[А-Яа-яЁё\s,.:;!?«»"'’()\-–—…/+]*[А-Яа-яЁё.!?…»)])?/g,
  init() {
    if (this.dict || UI_LANG === 'ru') return !!this.dict;
    const d = window.I18N_DICT;
    if (!d) return false;
    this.dict = new Map(Object.entries(d));
    // для разбора длинных прогонов на известные части: самый длинный ключ в словах
    this.maxWords = Math.max(...[...this.dict.keys()].map(k => k.split(' ').length));
    return true;
  },
  // точное совпадение; без хвостовой пунктуации; с маленькой буквы («Нужно» → ключ «нужно»)
  look(p) {
    const D = this.dict;
    if (D.has(p)) return D.get(p);
    const m = p.match(/^(.*?)([,.:;!?…]*)$/), core = m[1], tail = m[2];
    if (tail && D.has(core)) return D.get(core) + tail;
    if (!core) return null;
    const low = core[0].toLowerCase() + core.slice(1);
    if (low !== core && D.has(low)) { const t = D.get(low); return (t ? t[0].toUpperCase() + t.slice(1) : t) + tail; }
    return null;
  },
  // один прогон целиком или по частям; null — если покрыть словарём не получилось
  one(run) {
    const whole = this.look(run);
    if (whole != null) return whole;
    const w = run.split(' ');
    if (w.length < 2) return null;
    const out = [];
    for (let i = 0; i < w.length;) {
      let hit = null;
      for (let j = Math.min(w.length, i + this.maxWords); j > i; j--) {
        const t = this.look(w.slice(i, j).join(' '));
        if (t != null) { hit = [t, j]; break; }
      }
      if (!hit) return null;
      out.push(hit[0]); i = hit[1];
    }
    return out.filter(Boolean).join(' ');
  },
  tr(s) {
    if (UI_LANG === 'ru' || !s || !this.CYR.test(s) || !this.init()) return s;
    return s.replace(this.RUN, r => { const t = this.one(r); return t == null ? r : t; });
  },
  ATTRS: ['placeholder', 'title', 'aria-label', 'alt'],
  node(n) {
    if (n.nodeType === 3) {
      const p = n.parentNode;
      if (!p || p.closest?.('[translate="no"],script,style')) return;
      const t = this.tr(n.data);
      if (t !== n.data) n.data = t;
    } else if (n.nodeType === 1) {
      if (n.closest('[translate="no"]')) return;
      for (const a of this.ATTRS) { const v = n.getAttribute(a); if (v && this.CYR.test(v)) { const t = this.tr(v); if (t !== v) n.setAttribute(a, t); } }
      if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
      const w = document.createTreeWalker(n, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let c;
      while ((c = w.nextNode())) {
        if (c.nodeType === 3) this.node(c);
        else for (const a of this.ATTRS) { const v = c.getAttribute(a); if (v && this.CYR.test(v)) { const t = this.tr(v); if (t !== v) c.setAttribute(a, t); } }
      }
    }
  },
  started: false,
  start() {
    if (this.started || UI_LANG === 'ru' || !this.init()) return;
    this.started = true;
    this.node(document.documentElement);
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'childList') m.addedNodes.forEach(x => this.node(x));
        else if (m.type === 'characterData') this.node(m.target);
        else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v && this.CYR.test(v)) { const t = this.tr(v); if (t !== v) m.target.setAttribute(m.attributeName, t); } }
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: this.ATTRS });
  },
};
// для текста, который уходит не на страницу (копирование списка, «Поделиться»)
const tr = s => I18N.tr(s);
// запуск — из файла словаря (он грузится сразу после этого), на всякий случай ещё и по готовности страницы
document.addEventListener('DOMContentLoaded', () => { if (!I18N.started) I18N.start(); });
