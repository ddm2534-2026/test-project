// Лендинги Sali: живые данные из базы (акции, цены, рецепты, счётчики) на русском, английском и иврите.
// Ключ — публичный (только чтение каталога), его подставляет scraper/build_site.py.
const SB_URL = '/*__SUPABASE_URL__*/'.replace(/\/$/, '');
const KEY = '/*__SUPABASE_KEY__*/';
const REST = SB_URL + '/rest/v1/';
const ST = SB_URL + '/storage/v1/object/public/recipe-images/';
const LP = window.LP || { lang: 'ru', app: '../app/', appRoot: '../app/' };
const LANG = LP.lang, APP = LP.app, APPR = LP.appRoot;
const LOCALE = { ru: 'ru-RU', en: 'en-US', he: 'he-IL' }[LANG] || 'ru-RU';
const H = { apikey: KEY };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat(LOCALE);
const cur = (n, min) => LANG === 'ru'
  ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: min, maximumFractionDigits: 2 }).format(+n) + ' ₪'
  : new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'ILS', minimumFractionDigits: min, maximumFractionDigits: 2 }).format(+n);
const money = n => cur(n, 2);                                    // цены — всегда с копейками
const moneyT = n => cur(n, Number.isInteger(+n) ? 0 : 2);        // «3 за 10 ₪»
// русский — три формы (1, 2–4, 5+), английский и иврит — две (1, остальное)
const plural = (n, f) => {
  if (f.length < 3) return n === 1 ? f[0] : f[f.length - 1];
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2];
};
const S = {
  ru: { forN: (q, t) => `${q} за ${t}`, each: o => `${o} шт`, free: (p, f) => `${p}+${f} бесплатно`, fromN: (q, pct) => `от ${q} шт. −${pct}%`, until: d => `до ${d}`,
        pricesOn: d => `цены на ${d}`, product: 'Товар', cheapest: 'дешевле всего', dearest: 'дороже всего', items: ['товар', 'товара', 'товаров'],
        together: (n, w) => `Эти ${n} ${w} вместе`, range: (n, w, a, b) => `Те же ${n} ${w}: от <b>${a}</b> до <b>${b}</b>`, min: 'мин' },
  en: { forN: (q, t) => `${q} for ${t}`, each: o => `${o} each`, free: (p, f) => `buy ${p}, get ${f} free`, fromN: (q, pct) => `${pct}% off ${q}+`, until: d => `until ${d}`,
        pricesOn: d => `prices as of ${d}`, product: 'Product', cheapest: 'cheapest', dearest: 'most expensive', items: ['product', 'products'],
        together: (n, w) => `These ${n} ${w} together`, range: (n, w, a, b) => `Same ${n} ${w}: from <b>${a}</b> to <b>${b}</b>`, min: 'min' },
  he: { forN: (q, t) => `${q} ב־${t}`, each: o => `${o} ליח׳`, free: (p, f) => `${p}+${f} מתנה`, fromN: (q, pct) => `${pct}% הנחה ב־${q} יח׳`, until: d => `עד ${d}`,
        pricesOn: d => `מחירים נכון ל־${d}`, product: 'מוצר', cheapest: 'הכי זול', dearest: 'הכי יקר', items: ['מוצר', 'מוצרים'],
        together: (n, w) => `${n} ה${w} האלה יחד`, range: (n, w, a, b) => `אותם ${n} ${w}: מ־<b>${a}</b> עד <b>${b}</b>`, min: 'דק׳' },
}[LANG];
const LOGO = { shufersal: 'shufersal.svg', ramilevy: 'ramilevy.png', victory: 'victory.png', tivtaam: 'tivtaam.png', yochananof: 'yochananof.png', osherad: 'osherad.png', keshet: 'keshet.png', yango: 'yango.png' };
const CHN = {
  ru: { shufersal: 'Шуферсаль', ramilevy: 'Рами Леви', victory: 'Виктори', tivtaam: 'Тив Таам', yochananof: 'Йоханаоф', osherad: 'Ошер Ад', keshet: 'Кешет Теамим', yango: 'Yango Deli' },
  en: { shufersal: 'Shufersal', ramilevy: 'Rami Levy', victory: 'Victory', tivtaam: 'Tiv Taam', yochananof: 'Yochananof', osherad: 'Osher Ad', keshet: 'Keshet Teamim', yango: 'Yango Deli' },
  he: { shufersal: 'שופרסל', ramilevy: 'רמי לוי', victory: 'ויקטורי', tivtaam: 'טיב טעם', yochananof: 'יוחננוף', osherad: 'אושר עד', keshet: 'קשת טעמים', yango: 'יאנגו דלי' },
}[LANG];
const base = ch => LOGO[ch] ? ch : String(ch).replace(/_.*$/, '');
const logo = ch => { const b = base(ch); return LOGO[b] ? `<img src="${APPR}logos/${LOGO[b]}" alt="${esc(CHN[b] || b)}" loading="lazy">` : esc(CHN[b] || b); };

async function get(path) {
  const r = await fetch(REST + path, { headers: H });
  if (!r.ok) throw new Error(path + ': ' + r.status);
  return r.json();
}
async function rpc(name, args) {
  const r = await fetch(REST + 'rpc/' + name, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(name + ': ' + r.status);
  return r.json();
}
async function count(table) {
  const r = await fetch(`${REST}${table}?select=*&limit=1`, { method: 'HEAD', headers: { ...H, Prefer: 'count=exact' } });
  const n = +((r.headers.get('content-range') || '').split('/')[1]);
  return n > 0 ? n : null;
}
// фильтр PostgREST «in.(...)» для строк с кавычками, запятыми и скобками
const inList = vals => encodeURIComponent('(' + vals.map(v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')');
// английские названия товаров (иврит — оригинал из сети, русский приходит вместе с акциями)
async function enNames(names) {
  const want = [...new Set(names.filter(Boolean))];
  if (!want.length) return {};
  const rows = await get(`g_name_tr?select=src,tr&lang=eq.en&src=in.${inList(want)}`).catch(() => []);
  return Object.fromEntries(rows.map(r => [r.src, r.tr]));
}

// счётчики: <b data-count="deals" data-forms="акция|акции|акций">; без data-forms — только число
const COUNT_SRC = { items: 'g_items', deals: 'g_deal_cards_mv', recipes: 'menu_recipes' };
async function fillCounts() {
  const want = [...new Set($$('[data-count]').map(el => el.dataset.count))];
  await Promise.all(want.map(async k => {
    const n = await count(COUNT_SRC[k]).catch(() => null);
    if (!n) return;
    $$(`[data-count="${k}"]`).forEach(el => {
      const forms = el.dataset.forms ? el.dataset.forms.split('|') : null;
      el.textContent = nf.format(n) + (forms ? ' ' + plural(n, forms) : '');
    });
  }));
}

// ---------- акции
function dealPrice(d) {
  const q = +d.qty;
  if (q > 1 && +d.total > 0) return [S.forN(q, moneyT(+d.total)), S.each(money(+d.old))];
  if (q > 1 && +d.fraction > 0) {
    const paid = Math.round(q * d.fraction);
    if (paid >= 1 && paid < q) return [S.free(paid, q - paid), money(+d.old)];
  }
  if (q > 1) return [S.fromN(q, d.pct), money(+d.old)];
  return [money(+d.price), money(+d.old)];
}
const endTxt = e => e ? S.until(new Date(e).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }).replace(/\.$/, '')) : '';
function dealCard(p, nm) {
  const d = p.deal, [now, was] = dealPrice(d);
  return `<a class="dcard" href="${APP}#/deals"><div class="pic"><img src="${esc(p.img)}" alt="" loading="lazy">
    <span class="pct">−${d.pct}%</span><span class="chb">${logo(d.chain)}</span></div>
    <div class="body"><div class="nm">${esc(nm)}</div>
    <div class="price"><b>${esc(now)}</b><s>${esc(was)}</s></div><div class="ends">${esc(endTxt(d.ends))}</div></div></a>`;
}
async function loadDeals() {
  const box = $('#deals');
  if (!box) return;
  try {
    const rows = await rpc('g_deals', { p_sort: 'pct', p_limit: 500, p_offset: 0 });
    // разнообразие: один товар на ингредиент, одна позиция на акцию, не больше двух на сеть (если не набралось — до трёх)
    const soon = Date.now() + 2 * 864e5, seen = new Set(), promo = new Set(), perCh = {}, out = [];
    for (const cap of [2, 3]) for (const p of rows) {
      if (out.length >= 8) break;
      const d = p.deal;
      if (!d || !p.img || p.grp === 'grp_household' || +d.pct > 80) continue;
      if (d.ends && new Date(d.ends) < soon) continue;
      const k = p.ingredient || p.name, ch = base(d.chain), pr = d.text ? ch + '|' + d.text : null;
      if (seen.has(k) || (pr && promo.has(pr)) || (perCh[ch] || 0) >= cap) continue;
      seen.add(k); if (pr) promo.add(pr); perCh[ch] = (perCh[ch] || 0) + 1; out.push(p);
    }
    out.sort((a, b) => b.deal.pct - a.deal.pct);
    if (out.length % 2 && out.length > 1) out.pop();   // чётное число — сетка без дыр
    if (!out.length) throw new Error('empty');
    const en = LANG === 'en' ? await enNames(out.map(p => p.name)) : {};
    const nameOf = p => LANG === 'ru' ? (p.ru || p.name) : LANG === 'en' ? (en[p.name] || p.name) : p.name;
    box.innerHTML = out.map(p => dealCard(p, nameOf(p))).join('');
  } catch (e) { box.closest('.sec')?.classList.add('hide'); }
}

// ---------- сравнение цен
const PRODUCTS = [
  { bc: '7290019790259', img: ST + 'ingredients/milk-mwm42j70.jpg',
    nm: { ru: 'Молоко 4% «Рамат а-Голан», 1 л', en: 'Ramat HaGolan natural milk 4%, 1 L', he: 'חלב טבעי 4% רמת הגולן, 1 ליטר' } },
  { bc: '7290010429554', img: ST + 'ingredients/olive_oil-mwm47mbc.jpg',
    nm: { ru: 'Оливковое масло «Яд Мордехай», 750 мл', en: 'Yad Mordechai extra virgin olive oil, 750 ml', he: 'שמן זית כתית מעולה יד מרדכי, 750 מ״ל' } },
  { bc: '8000500426494', img: ST + 'ingredients/chocolate_spread-mwm315tv.jpg',
    nm: { ru: 'Nutella, 350 г', en: 'Nutella, 350 g', he: 'נוטלה, 350 גרם' } },
  { bc: '7622201139278', img: ST + 'ingredients/cream_cheese-mwm35134.jpg',
    nm: { ru: 'Сливочный сыр Philadelphia, 150 г', en: 'Philadelphia cream cheese, 150 g', he: 'גבינת שמנת פילדלפיה, 150 גרם' } },
];
const CH_ORDER = ['osherad', 'ramilevy', 'yochananof', 'victory', 'shufersal', 'keshet', 'tivtaam', 'yango'];
const r2 = n => Math.round(n * 100) / 100;
async function loadCompare() {
  const tbl = $('#ctable');
  if (!tbl) return;
  try {
    const rows = await get(`g_prices?select=chain_id,barcode,price,seen_at&barcode=in.(${PRODUCTS.map(p => p.bc).join(',')})&chain_id=in.(${CH_ORDER.join(',')})`);
    const fresh = Date.now() - 7 * 864e5, P = {};
    let last = 0;
    for (const r of rows) {
      if (!(+r.price > 0) || new Date(r.seen_at) < fresh) continue;
      (P[r.barcode] ||= {})[r.chain_id] = +r.price;
      last = Math.max(last, +new Date(r.seen_at));
    }
    const prods = PRODUCTS.filter(p => Object.keys(P[p.bc] || {}).length >= 2);
    const cols = CH_ORDER.filter(ch => prods.some(p => P[p.bc][ch]));
    if (prods.length < 2 || cols.length < 2) throw new Error('мало цен');
    const prodCell = p => `<div class="prod"><img src="${p.img}" alt="" loading="lazy"><span>${esc(p.nm[LANG] || p.nm.ru)}</span></div>`;
    tbl.innerHTML = `<table><thead><tr><th>${S.product}</th>${cols.map(ch => `<th>${logo(ch)}</th>`).join('')}</tr></thead><tbody>${prods.map(p => {
      const pr = P[p.bc], mn = Math.min(...Object.values(pr));
      return `<tr><td class="p">${prodCell(p)}</td>${cols.map(ch => pr[ch] == null ? '<td class="na">—</td>' : pr[ch] === mn ? `<td class="min"><b>${money(pr[ch])}</b></td>` : `<td>${money(pr[ch])}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table>`;
    $('#pcards').innerHTML = prods.map(p => {
      const s = Object.entries(P[p.bc]).sort((a, b) => a[1] - b[1]), lo = s[0], hi = s[s.length - 1];
      return `<div class="pcard">${prodCell(p)}<div class="two">
        <div class="lo"><small>${S.cheapest}</small><div class="v"><b>${money(lo[1])}</b><span>${logo(lo[0])}</span></div></div>
        <div class="hi"><small>${S.dearest}</small><div class="v"><b>${money(hi[1])}</b><span>${logo(hi[0])}</span></div></div></div></div>`;
    }).join('');
    if (last) $('#cdate').textContent = S.pricesOn(new Date(last).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }));
    // те же товары целиком — только сети, где есть все
    const full = cols.filter(ch => prods.every(p => P[p.bc][ch])).map(ch => [ch, prods.reduce((s, p) => s + P[p.bc][ch], 0)]).sort((a, b) => a[1] - b[1]);
    if (full.length >= 2) {
      const mx = full[full.length - 1][1], n = prods.length, w = plural(n, S.items);
      $('#sumh').textContent = S.together(n, w);
      $('#sumd').textContent = money(r2(mx - full[0][1]));
      $('#bars').innerHTML = full.map(([ch, v], i) => `<div class="bar${i ? '' : ' best'}"><span class="lg">${logo(ch)}</span><span class="tr"><i style="width:${(v / mx * 100).toFixed(1)}%"></i></span><b>${money(r2(v))}</b></div>`).join('');
      $$('[data-range]').forEach(el => { el.innerHTML = S.range(n, w, money(r2(full[0][1])), money(r2(mx))); });
    } else $('#sum').classList.add('hide');
  } catch (e) { tbl.closest('.sec')?.classList.add('hide'); $('#sum')?.classList.add('hide'); }
}

// ---------- рецепты (английские и ивритские названия — наш перевод)
const RECIPES = [
  ['589c7139-736c-4a21-a308-71a990887e89', 'Chickpea patties with yogurt sauce', 'קציצות חומוס ברוטב יוגורט'],
  ['51e3b899-bc3d-4825-a3e7-1da8353c798c', 'Teriyaki salmon with cucumber', 'סלמון טריאקי עם מלפפון'],
  ['1929db47-e00a-460c-9a30-65830065e357', 'Chickpea and spinach curry with coconut milk', 'קארי חומוס ותרד בחלב קוקוס'],
  ['1faa7d3a-f170-40d4-9aac-dc943970da75', 'Chicken schnitzel', 'שניצל עוף'],
  ['b7fbbc7c-bcd9-47eb-a76b-d94efb0aad80', 'Beef goulash', 'גולאש בקר'],
  ['367fc616-ba20-44f0-874c-446fe1960cb0', 'Meatballs in tomato sauce', 'קציצות ברוטב עגבניות'],
  ['5d449339-f83e-4512-a384-7bfafb7f4b82', 'Chakhokhbili: Georgian chicken stew', 'צ׳חוחבילי: תבשיל עוף גאורגי'],
  ['2d0d5fa8-cf21-4bb7-86b4-11a61adefac5', 'Fish in tahini with an almond crust', 'דג בטחינה בקרום שקדים'],
];
const TAGS = [['быстро', 'Быстро', 'Quick', 'מהיר'], ['вегетарианское', 'Вегетарианское', 'Vegetarian', 'צמחוני'], ['для детей', 'Для детей', 'For kids', 'לילדים'],
  ['рыба', 'Рыба', 'Fish', 'דגים'], ['израильское', 'Израильское', 'Israeli', 'ישראלי'], ['в духовке', 'В духовке', 'Oven-baked', 'בתנור'],
  ['для сада', 'Для сада', 'For kindergarten', 'לגן'], ['пятница', 'Пятница', 'Friday', 'שישי']];
const LI = { ru: 1, en: 2, he: 3 }[LANG] || 1;
async function loadRecipes() {
  const grid = $('#recipes');
  if (!grid) return;
  const tagBox = $('#tags');
  get('menu_recipes?select=tags').then(rows => {
    const c = {};
    rows.forEach(r => (r.tags || []).forEach(t => { c[t] = (c[t] || 0) + 1; }));
    tagBox.innerHTML = TAGS.filter(t => c[t[0]]).map(t => `<a class="chip" href="${APP}#/recipes">${t[LI]}<span>${nf.format(c[t[0]])}</span></a>`).join('');
  }).catch(() => tagBox.classList.add('hide'));
  try {
    const ids = RECIPES.map(r => r[0]);
    const rows = await get(`menu_recipes?select=id,name,cook_minutes,thumb_url&id=in.(${ids.join(',')})`);
    const by = Object.fromEntries(rows.map(r => [r.id, r]));
    const list = RECIPES.filter(([id]) => by[id] && by[id].thumb_url);
    if (!list.length) throw new Error('empty');
    grid.innerHTML = list.map(([id, en, he]) => {
      const r = by[id], nm = LANG === 'en' ? en : LANG === 'he' ? he : r.name;
      return `<a class="rcard" href="${APP}#/r/${r.id}"><div class="ph"><img src="${esc(r.thumb_url)}" alt="" loading="lazy">${r.cook_minutes ? `<span class="t">${nf.format(r.cook_minutes)} ${S.min}</span>` : ''}</div><div class="nm">${esc(nm)}</div></a>`;
    }).join('');
  } catch (e) { grid.closest('.sec')?.classList.add('hide'); }
}

fillCounts();
loadDeals();
loadCompare();
loadRecipes();
