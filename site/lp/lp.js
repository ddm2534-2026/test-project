// Лендинги Sali: живые данные из базы (акции, цены, рецепты, счётчики).
// Ключ — публичный (только чтение каталога), его подставляет scraper/build_site.py.
const SB_URL = '/*__SUPABASE_URL__*/'.replace(/\/$/, '');
const KEY = '/*__SUPABASE_KEY__*/';
const REST = SB_URL + '/rest/v1/';
const ST = SB_URL + '/storage/v1/object/public/recipe-images/';
const APP = '../app/';
const H = { apikey: KEY };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ru-RU');
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => nf2.format(+n) + ' ₪';                                   // цены — всегда с копейками
const moneyT = n => (Number.isInteger(+n) ? nf.format(+n) : nf2.format(+n)) + ' ₪'; // «3 за 10 ₪»
const plural = (n, [one, few, many]) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
const LOGO = { shufersal: 'shufersal.svg', ramilevy: 'ramilevy.png', victory: 'victory.png', tivtaam: 'tivtaam.png', yochananof: 'yochananof.png', osherad: 'osherad.png', keshet: 'keshet.png', yango: 'yango.png' };
const CHN = { shufersal: 'Шуферсаль', ramilevy: 'Рами Леви', victory: 'Виктори', tivtaam: 'Тив Таам', yochananof: 'Йоханаоф', osherad: 'Ошер Ад', keshet: 'Кешет Теамим', yango: 'Yango Deli' };
const base = ch => LOGO[ch] ? ch : String(ch).replace(/_.*$/, '');
const logo = (ch, cls = '') => { const b = base(ch); return LOGO[b] ? `<img${cls ? ` class="${cls}"` : ''} src="${APP}logos/${LOGO[b]}" alt="${esc(CHN[b] || b)}" loading="lazy">` : esc(CHN[b] || b); };

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

// счётчики на странице: <b data-count="deals" data-forms="акция|акции|акций">
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
  if (q > 1 && +d.total > 0) return [`${q} за ${moneyT(+d.total)}`, `${money(+d.old)} шт`];
  if (q > 1 && +d.fraction > 0) {
    const paid = Math.round(q * d.fraction);
    if (paid >= 1 && paid < q) return [`${paid}+${q - paid} бесплатно`, money(+d.old)];
  }
  if (q > 1) return [`от ${q} шт. −${d.pct}%`, money(+d.old)];
  return [money(+d.price), money(+d.old)];
}
const endTxt = e => e ? 'до ' + new Date(e).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') : '';
function dealCard(p) {
  const d = p.deal, [now, was] = dealPrice(d);
  return `<a class="dcard" href="${APP}#/deals"><div class="pic"><img src="${esc(p.img)}" alt="" loading="lazy">
    <span class="pct">−${d.pct}%</span><span class="chb">${logo(d.chain)}</span></div>
    <div class="body"><div class="nm">${esc(p.ru || p.name)}</div>
    <div class="price"><b>${esc(now)}</b><s>${esc(was)}</s></div><div class="ends">${esc(endTxt(d.ends))}</div></div></a>`;
}
async function loadDeals() {
  const box = $('#deals');
  if (!box) return;
  try {
    const rows = await rpc('g_deals', { p_sort: 'pct', p_limit: 300, p_offset: 0 });
    const soon = Date.now() + 2 * 864e5, seen = new Set(), perCh = {}, out = [];
    for (const p of rows) {
      const d = p.deal;
      if (!d || !p.img || p.grp === 'grp_household' || +d.pct > 80) continue;
      if (d.ends && new Date(d.ends) < soon) continue;
      const k = p.ingredient || p.name, ch = base(d.chain);
      if (seen.has(k) || (perCh[ch] || 0) >= 3) continue;
      seen.add(k); perCh[ch] = (perCh[ch] || 0) + 1; out.push(p);
      if (out.length >= 8) break;
    }
    if (!out.length) throw new Error('empty');
    box.innerHTML = out.map(dealCard).join('');
  } catch (e) { box.closest('.sec')?.classList.add('hide'); }
}

// ---------- сравнение цен
const PRODUCTS = [
  { bc: '7290019790259', nm: 'Молоко 4% «Рамат а-Голан», 1 л', img: ST + 'ingredients/milk-mwm42j70.jpg' },
  { bc: '7290010429554', nm: 'Оливковое масло «Яд Мордехай», 750 мл', img: ST + 'ingredients/olive_oil-mwm47mbc.jpg' },
  { bc: '8000500426494', nm: 'Nutella, 350 г', img: ST + 'ingredients/chocolate_spread-mwm315tv.jpg' },
  { bc: '7622201139278', nm: 'Сливочный сыр Philadelphia, 150 г', img: ST + 'ingredients/cream_cheese-mwm35134.jpg' },
];
const CH_ORDER = ['osherad', 'ramilevy', 'yochananof', 'victory', 'shufersal', 'keshet', 'tivtaam', 'yango'];
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
    const prodCell = p => `<div class="prod"><img src="${p.img}" alt="" loading="lazy"><span>${esc(p.nm)}</span></div>`;
    tbl.innerHTML = `<table><thead><tr><th>Товар</th>${cols.map(ch => `<th>${logo(ch)}</th>`).join('')}</tr></thead><tbody>${prods.map(p => {
      const pr = P[p.bc], mn = Math.min(...Object.values(pr));
      return `<tr><td class="p">${prodCell(p)}</td>${cols.map(ch => pr[ch] == null ? '<td class="na">—</td>' : pr[ch] === mn ? `<td class="min"><b>${money(pr[ch])}</b></td>` : `<td>${money(pr[ch])}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table>`;
    $('#pcards').innerHTML = prods.map(p => {
      const s = Object.entries(P[p.bc]).sort((a, b) => a[1] - b[1]), lo = s[0], hi = s[s.length - 1];
      return `<div class="pcard">${prodCell(p)}<div class="two">
        <div class="lo"><small>дешевле всего</small><div class="v"><b>${money(lo[1])}</b><span>${logo(lo[0])}</span></div></div>
        <div class="hi"><small>дороже всего</small><div class="v"><b>${money(hi[1])}</b><span>${logo(hi[0])}</span></div></div></div></div>`;
    }).join('');
    if (last) $('#cdate').textContent = 'цены на ' + new Date(last).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    // те же товары целиком — только сети, где есть все
    const full = cols.filter(ch => prods.every(p => P[p.bc][ch])).map(ch => [ch, prods.reduce((s, p) => s + P[p.bc][ch], 0)]).sort((a, b) => a[1] - b[1]);
    if (full.length >= 2) {
      const mx = full[full.length - 1][1], n = prods.length;
      $('#sumh').textContent = `Эти ${n} ${plural(n, ['товар', 'товара', 'товаров'])} вместе`;
      $('#sumd').textContent = money(Math.round((mx - full[0][1]) * 100) / 100);
      $('#bars').innerHTML = full.map(([ch, v], i) => `<div class="bar${i ? '' : ' best'}"><span class="lg">${logo(ch)}</span><span class="tr"><i style="width:${(v / mx * 100).toFixed(1)}%"></i></span><b>${money(Math.round(v * 100) / 100)}</b></div>`).join('');
      $$('[data-range]').forEach(el => { el.innerHTML = `Те же ${n} ${plural(n, ['товар', 'товара', 'товаров'])}: от <b>${money(Math.round(full[0][1] * 100) / 100)}</b> до <b>${money(Math.round(mx * 100) / 100)}</b>`; });
    } else $('#sum').classList.add('hide');
  } catch (e) { tbl.closest('.sec')?.classList.add('hide'); $('#sum')?.classList.add('hide'); }
}

// ---------- рецепты
const RECIPE_IDS = ['589c7139-736c-4a21-a308-71a990887e89', '51e3b899-bc3d-4825-a3e7-1da8353c798c', '1929db47-e00a-460c-9a30-65830065e357', '1faa7d3a-f170-40d4-9aac-dc943970da75',
  'b7fbbc7c-bcd9-47eb-a76b-d94efb0aad80', '367fc616-ba20-44f0-874c-446fe1960cb0', '5d449339-f83e-4512-a384-7bfafb7f4b82', '2d0d5fa8-cf21-4bb7-86b4-11a61adefac5'];
const TAGS = [['быстро', 'Быстро'], ['вегетарианское', 'Вегетарианское'], ['для детей', 'Для детей'], ['рыба', 'Рыба'], ['израильское', 'Израильское'], ['в духовке', 'В духовке'], ['для сада', 'Для сада'], ['пятница', 'Пятница']];
async function loadRecipes() {
  const grid = $('#recipes');
  if (!grid) return;
  const tagBox = $('#tags');
  get('menu_recipes?select=tags').then(rows => {
    const c = {};
    rows.forEach(r => (r.tags || []).forEach(t => { c[t] = (c[t] || 0) + 1; }));
    tagBox.innerHTML = TAGS.filter(([t]) => c[t]).map(([t, label]) => `<a class="chip" href="${APP}#/recipes">${label}<span>${c[t]}</span></a>`).join('');
  }).catch(() => tagBox.classList.add('hide'));
  try {
    const rows = await get(`menu_recipes?select=id,name,cook_minutes,thumb_url&id=in.(${RECIPE_IDS.join(',')})`);
    const by = Object.fromEntries(rows.map(r => [r.id, r]));
    const list = RECIPE_IDS.map(id => by[id]).filter(r => r && r.thumb_url);
    if (!list.length) throw new Error('empty');
    grid.innerHTML = list.map(r => `<a class="rcard" href="${APP}#/r/${r.id}"><div class="ph"><img src="${esc(r.thumb_url)}" alt="" loading="lazy">${r.cook_minutes ? `<span class="t">${r.cook_minutes} мин</span>` : ''}</div><div class="nm">${esc(r.name)}</div></a>`).join('');
  } catch (e) { grid.closest('.sec')?.classList.add('hide'); }
}

fillCounts();
loadDeals();
loadCompare();
loadRecipes();
