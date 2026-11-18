/* Sali — корзины (вход «от корзины»): список корзин, корзина из чека / поиска / списка, сравнение по сетям, «+ Новое». */
'use strict';

// ---------- хранение ----------
// корзина: {id, savedId?, title, src: 'receipt'|'manual', items: [...], receipts: [...], created, updated, cmp?}
// позиция: {id, barcode?, key?, name, he?, pack?, unit?, qty, kg?, paid?, chain?, src}
//   товар — barcode (+ key продукта для аналогов); общий продукт — key и qty в базовых единицах (г/мл/шт); без barcode и key — не сравнивается
app.carts = LS.get('sali.carts', []);
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cartById = id => app.carts.find(c => c.id === id);
function saveCarts() { LS.set('sali.carts', app.carts); }
function cartTouch(c) {
  c.updated = Date.now(); delete c.cmp; saveCarts();
  debounce('cart' + c.id, 1200, () => cloudSaveCart(c));
}
function newCart(src, title) {
  const d = new Date(), c = { id: newId('c'), src, title: title || `Корзина ${d.getDate()} ${MONTHS[d.getMonth()]}`, items: [], receipts: [], created: Date.now(), updated: Date.now() };
  app.carts.unshift(c); saveCarts(); return c;
}
async function cloudSaveCart(c) {
  if (!app.user || !cartById(c.id)) return;
  const st = { ...c }; delete st.cmp; delete st.savedId;
  if (c.savedId) {
    const { error } = await sb.from('user_baskets').update({ title: c.title, state: st, updated_at: new Date().toISOString() }).eq('id', c.savedId);
    if (error) console.warn('cart save', error);
  } else {
    const { data, error } = await sb.from('user_baskets').insert({ title: c.title, state: st }).select('id').single();
    if (error) { console.warn('cart save', error); return; }
    c.savedId = data.id; saveCarts();
  }
}
// после входа: корзины из аккаунта + выгрузка корзин этого устройства
async function cloudLoadCarts() {
  if (!app.user || timers.cartsLoaded) return false;
  timers.cartsLoaded = 1;
  const { data, error } = await sb.from('user_baskets').select('id,state,updated_at').order('updated_at', { ascending: false }).limit(60);
  if (error) { timers.cartsLoaded = 0; return false; }
  for (const row of data || []) {
    const loc = app.carts.find(c => c.savedId === row.id || c.id === row.state?.id);
    if (!loc) app.carts.push({ ...row.state, savedId: row.id });
    else if ((row.state?.updated || 0) > (loc.updated || 0)) Object.assign(loc, row.state, { savedId: row.id });
    else loc.savedId = row.id;
  }
  app.carts.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  saveCarts();
  for (const c of app.carts) if (!c.savedId) cloudSaveCart(c);
  return true;
}
async function deleteCart(c) {
  app.carts = app.carts.filter(x => x.id !== c.id); saveCarts();
  if (c.savedId && app.user) await sb.from('user_baskets').delete().eq('id', c.savedId);
}

// ---------- позиции ----------
const UNIT_STEP = { 'г': 100, 'мл': 250, 'шт': 1 };
const UNIT_DEF = { 'г': 500, 'мл': 1000, 'шт': 1 };
function itemQtyText(i) {
  if (i.kg) return amt(i.kg) + ' кг';
  if (i.barcode || !i.key) return i.qty > 1 ? i.qty + ' уп.' : '1 уп.';
  const u = i.unit || 'г';
  if (u === 'г' && i.qty >= 1000) return amt(i.qty / 1000) + ' кг';
  if (u === 'мл' && i.qty >= 1000) return amt(i.qty / 1000) + ' л';
  return amt(i.qty) + ' ' + u;
}
const packLabel = (a, k) => a ? `${amt(a >= 1000 && (k === 'г' || k === 'мл') ? a / 1000 : a)} ${a >= 1000 && k === 'г' ? 'кг' : a >= 1000 && k === 'мл' ? 'л' : k || ''}` : '';
const itemName = i => i.he ? trName(i.he) : i.name;
function itemFromGeneric(g, qty) {
  return { id: newId('i'), key: g.key, name: g.name_ru, unit: g.base_unit, qty: qty || UNIT_DEF[g.base_unit] || 1, img: g.img || null, icon: g.icon || null, src: 'search' };
}
function itemFromProduct(p, qty, kg) {
  return { id: newId('i'), barcode: p.barcode, key: p.ingredient || undefined, he: p.name, name: p.name, pack: packLabel(p.pack_amount, p.pack_kind),
    weighted: !!p.is_weighted, qty: qty || 1, kg: p.is_weighted ? (kg || 1) : undefined, src: 'search' };
}
function addItems(c, items) {
  for (const it of items) {
    const same = c.items.find(x => (it.barcode && x.barcode === it.barcode && !x.kg) || (!it.barcode && it.key && !x.barcode && x.key === it.key));
    if (same && !it.kg) { same.qty += it.qty; if (it.paid) same.paid = (same.paid || 0) + it.paid; }
    else c.items.push(it);
  }
  cartTouch(c);
}
const itemPic = i => i.img ? `<img src="${esc(i.img)}" alt="" loading="lazy">` : i.key && app.defs[i.key] ? iconOf(i.key) : (i.icon || '🛒');

// ---------- сравнение по сетям ----------
async function cartCompare(c) {
  const items = c.items.filter(i => i.barcode || i.key).map(i => ({ id: i.id, barcode: i.barcode, key: i.key, qty: i.qty, kg: i.kg }));
  if (!items.length) return null;
  const shop = shopMode(), sig = JSON.stringify([shop, items]);
  if (c.cmp?.sig === sig && Date.now() - c.cmp.at < 6 * 3600e3) return c.cmp.data;
  const data = await fn('cart', { action: 'compare', items, chains: SHOP[shop] });
  c.cmp = { sig, at: Date.now(), data }; saveCarts();
  return data;
}

// ---------- 13. Список корзин ----------
route(/^#\/baskets$/, () => {
  const m = app.menu, r = m?.plan?.dishes?.length ? weekRange() : null;
  const menuCard = m?.plan?.dishes?.length ? `<a class="bk" href="#/basket"><span class="bk-ic">${ico('menu', 24, '#137A4B')}</span>
      <span class="oi"><b>Корзина меню</b><span>${esc(menuTitle(m))} · по рецептам</span></span>${r ? `<b class="num">от ${moneyR(r.from)}</b>` : ''}</a>` : '';
  const cards = app.carts.map(c => {
    const best = c.cmp?.data?.chains?.[0];
    return `<a class="bk" href="#/cart/${c.id}"><span class="bk-ic">${ico(c.src === 'receipt' ? 'camera' : 'cart', 24, '#137A4B')}</span>
      <span class="oi"><b>${esc(c.title)}</b><span>${c.items.length} ${plural(c.items.length, 'товар', 'товара', 'товаров')} · ${new Date(c.updated).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></span>
      ${best ? `<b class="num">от ${moneyR(best.total)}</b>` : ''}</a>`;
  }).join('');
  return `<div class="hd"><div><div class="sub">Сравним цены в 7 сетях</div><h1 class="h">Корзины</h1></div></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-top:14px">
      ${menuCard}${cards}
      ${!menuCard && !cards ? `<p class="mu" style="margin:0">Сфотографируйте чек, найдите товары или вставьте список — покажем, в какой сети эта корзина дешевле.</p>` : ''}
      <div class="sec-h" style="margin-top:8px">Новая корзина</div>
      ${newCartButtons()}
    </div>`;
}, {
  tab: 'basket',
  after(view) {
    bindNewCart(view, null);
    cloudLoadCarts().then(ch => { if (ch && location.hash === '#/baskets') render(); });
  },
});
function newCartButtons() {
  return `<div class="nb3">
    <button class="op" data-nc="receipt"><span class="bk-ic">${ico('camera', 24, '#137A4B')}</span><span class="oi"><b>Фото чека</b><span>Распознаем товары и цены</span></span></button>
    <button class="op" data-nc="search"><span class="bk-ic">${ico('search', 24, '#137A4B')}</span><span class="oi"><b>Найти товары</b><span>По-русски или на иврите</span></span></button>
    <button class="op" data-nc="text"><span class="bk-ic">${ico('text', 24, '#137A4B')}</span><span class="oi"><b>Списком</b><span>«молоко 3% 2, яйца 12…»</span></span></button></div>`;
}
// target — корзина, в которую добавляем; null — новая (для чека — спросим)
function bindNewCart(view, target) {
  $$('[data-nc]', view).forEach(b => b.onclick = () => {
    const k = b.dataset.nc;
    if (k === 'receipt') return pickReceipt(target);
    const c = target || newCart('manual');
    if (!target) go('#/cart/' + c.id);
    setTimeout(() => k === 'search' ? searchSheet(c) : textSheet(c), target ? 0 : 60);
  });
}

// ---------- 14. Корзина ----------
route(/^#\/cart\/([\w-]+)$/, id => {
  const c = cartById(id);
  if (!c) { setTimeout(() => go('#/baskets')); return ''; }
  loadNameTr(c.items.filter(i => i.he).map(i => ({ n: i.he }))).then(ch => ch && location.hash === '#/cart/' + id && render()).catch(() => {});
  const n = c.items.length, paid = c.items.reduce((a, i) => a + (i.paid || 0), 0);
  const rc = (c.receipts || []).map(r => `${CHAINS[r.chain] || 'чек'}${r.date ? ' ' + new Date(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''}${r.total ? ' — ' + money(r.total, 1) : ''}`).join(' · ');
  const items = c.items.map(i => `<div class="ci">
      <span class="pic-ic" style="width:48px;height:48px;font-size:24px;background:#F4F1EA">${itemPic(i)}</span>
      <span class="oi"><b dir="auto">${esc(itemName(i))}</b><span>${[i.pack, i.he && trName(i.he) !== i.he ? i.he : '', !i.barcode && !i.key ? 'не нашли в базе — не сравнивается' : ''].filter(Boolean).map(esc).join(' · ')}</span>
        ${!i.barcode && !i.key ? `<button class="linkb" data-fix="${i.id}" style="align-self:flex-start">Найти замену</button>` : ''}</span>
      <span class="stp" role="group" aria-label="Количество"><button data-q="${i.id}.-1" aria-label="Меньше">−</button><b class="num" style="min-width:56px;font-size:13px">${esc(itemQtyText(i))}</b><button data-q="${i.id}.1" aria-label="Больше">+</button></span>
    </div>`).join('');
  return `<div class="hd"><div><div class="sub">${n} ${plural(n, 'товар', 'товара', 'товаров')}${rc ? ' · ' + esc(rc) : ''}</div><h1 class="h">${esc(c.title)}</h1></div>
      <span style="display:flex;gap:8px"><button class="ib" data-ren aria-label="Переименовать">${ico('pen')}</button><button class="ib" data-del aria-label="Удалить корзину">${ico('trash')}</button></span></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:14px;padding-top:12px">
      ${n ? `<div class="seg" role="tablist"><button data-shop="delivery" aria-pressed="${shopMode() === 'delivery'}">С доставкой</button><button data-shop="store" aria-pressed="${shopMode() === 'store'}">В магазине</button></div>
      <div id="cmp"><p class="mu" style="margin:0"><span class="spin"></span> Сравниваем цены…</p></div>` : ''}
      <div class="sec-h">Товары</div>
      ${items || `<p class="mu" style="margin:0">Пока пусто — добавьте товары.</p>`}
      <div class="sec-h" style="margin-top:6px">Добавить</div>
      ${newCartButtons()}
      ${paid ? `<p class="mu" style="margin:0;font-size:12px">По чекам заплачено ${money(paid, 1)} за распознанные товары.</p>` : ''}
    </div>`;
}, {
  tab: 'basket',
  after(view, id) {
    const c = cartById(id); if (!c) return;
    bindNewCart(view, c);
    $$('[data-q]', view).forEach(b => b.onclick = () => {
      const [iid, d] = b.dataset.q.split('.'), i = c.items.find(x => x.id === iid); if (!i) return;
      if (i.kg) i.kg = Math.max(0, Math.round((i.kg + 0.25 * +d) * 100) / 100);
      else i.qty = Math.max(0, i.qty + (i.barcode || !i.key ? 1 : UNIT_STEP[i.unit || 'г'] || 1) * +d);
      if (!(i.kg ?? i.qty)) c.items = c.items.filter(x => x !== i);
      cartTouch(c); render();
    });
    $$('[data-fix]', view).forEach(b => b.onclick = () => { const i = c.items.find(x => x.id === b.dataset.fix); searchSheet(c, i); });
    $$('[data-shop]', view).forEach(b => b.onclick = () => { app.profile.shop = b.dataset.shop; saveProfile(); render(); });
    const rn = $('[data-ren]', view); if (rn) rn.onclick = () => sheet('Название корзины', `<input class="inp" id="rn" value="${esc(c.title)}" maxlength="60"><button class="cta w" id="rnOk">Сохранить</button>`,
      (el, close) => { const f = () => { const v = $('#rn', el).value.trim(); if (v) { c.title = v; cartTouch(c); } close(); render(); }; $('#rnOk', el).onclick = f; $('#rn', el).onkeydown = e => e.key === 'Enter' && f(); });
    const dl = $('[data-del]', view); if (dl) dl.onclick = () => confirmSheet('Удалить корзину?', `«${c.title}» удалится${c.savedId ? ' и из аккаунта' : ''}.`, 'Удалить', async () => { await deleteCart(c); go('#/baskets'); });
    const box = $('#cmp', view); if (!box) return;
    cartCompare(c).then(d => { if ($('#cmp') === box) box.innerHTML = cmpHtml(c, d); bindCmp(box); })
      .catch(e => { if ($('#cmp') === box) box.innerHTML = `<div class="err">Цены не посчитались: ${esc(e.message)}</div>`; });
  },
});
function cmpHtml(c, d) {
  const n = c.items.filter(i => i.barcode || i.key).length;
  if (!d?.chains?.length) return `<p class="mu" style="margin:0">Нет товаров для сравнения.</p>`;
  const rows = d.chains.map(x => ({ ...x, fee: delivOf(x.chain)?.fee || 0 })).map(x => ({ ...x, sum: x.total + x.fee }))
    .sort((a, b) => b.have - a.have || a.sum - b.sum);
  const full = rows.filter(x => x.have === rows[0].have), best = full[0], worst = Math.max(...full.map(x => x.sum));
  const paidItems = c.items.filter(i => i.paid && (i.barcode || i.key)), paid = paidItems.reduce((a, i) => a + i.paid, 0);
  const bestOnPaid = paid ? (best.lines || []).filter(l => paidItems.some(i => i.id === l.id)).reduce((a, l) => a + Number(l.cost), 0) : 0;
  const nm = Object.fromEntries(c.items.map(i => [i.id, itemName(i)]));
  return `<div class="cmp-best"><span class="sub">Дешевле всего</span><b>${esc(CHAINS[best.chain] || best.chain)} — ${moneyR(best.sum)}</b>
      <span class="mu">${best.have < n ? `есть ${best.have} из ${n}` : `все ${n} ${plural(n, 'товар', 'товара', 'товаров')}`}${best.fee ? ` · с доставкой ${money(best.fee, 1)}` : ''}${worst - best.sum >= 1 ? ` · дешевле самой дорогой на ${moneyR(worst - best.sum)}` : ''}</span>
      ${paid && bestOnPaid && paid - bestOnPaid >= 1 ? `<span class="save">Те же товары, что в чеке: вы заплатили ${moneyR(paid)}, в ${esc(CHAINS[best.chain] || best.chain)} — ${moneyR(bestOnPaid)}</span>` : ''}</div>
    <div class="cmp-list">${rows.map(x => `<details class="cmp-r"><summary><span class="oi"><b>${esc(CHAINS[x.chain] || x.chain)}</b>
        <span>${x.have} из ${n}${x.exact < x.have ? ` · ${x.have - x.exact} ${plural(x.have - x.exact, 'аналог', 'аналога', 'аналогов')}` : ''}${x.fee ? ` · доставка ${money(x.fee, 1)}` : ''}</span></span><b class="num">${moneyR(x.sum)}</b></summary>
        <div class="cmp-ls">${(x.lines || []).map(l => `<div><span dir="auto">${esc(nm[l.id] || '')}${l.how !== 'exact' ? ` <i class="mu">→ ${esc(l.name || '')}${l.how === 'analog' ? ' (аналог)' : ''}</i>` : ''}</span><b class="num">${money(Number(l.cost), 1)}</b></div>`).join('')}
        ${(x.missing || []).map(id => `<div class="mu"><span>${esc(nm[id] || '')}</span><span>нет</span></div>`).join('')}</div></details>`).join('')}</div>`;
}
function bindCmp() {}

// ---------- поиск товара ----------
function searchSheet(c, replace) {
  sheet(replace ? 'Найти замену' : 'Найти товар', `<input class="inp" id="q" placeholder="молоко 3%, חלב, штрихкод…" autocomplete="off" value="${esc(replace ? replace.name : '')}">
    <div id="res" class="sr"></div>`, (el, close) => {
    const q = $('#q', el), res = $('#res', el);
    let seq = 0;
    const run = async () => {
      const v = q.value.trim(), my = ++seq;
      if (v.length < 2) { res.innerHTML = ''; return; }
      res.innerHTML = `<p class="mu"><span class="spin"></span> Ищем…</p>`;
      try {
        const r = await rpc('g_cart_search', { p_q: v, p_limit: 12 });
        if (my !== seq) return;
        await loadNameTr((r.products || []).map(p => ({ n: p.name }))).catch(() => {});
        if (my !== seq) return;
        const g = (r.generic || []).map((x, k) => `<button class="op" data-g="${k}"><span class="pic-ic" style="width:44px;height:44px;font-size:22px;background:#F4F1EA">${x.img ? `<img src="${esc(x.img)}" alt="">` : esc(x.icon || '🛒')}</span>
            <span class="oi"><b>${esc(x.name_ru)}</b><span>любой товар — возьмём самый выгодный · ${esc(x.name_he || '')}</span></span>${ico('plus', 20, '#137A4B')}</button>`).join('');
        const p = (r.products || []).map((x, k) => `<button class="op" data-p="${k}"><span class="oi"><b dir="auto">${esc(trName(x.name))}</b>
            <span dir="auto">${[trName(x.name) !== x.name ? x.name : '', packLabel(x.pack_amount, x.pack_kind), x.price_from ? 'от ' + money(Number(x.price_from), 1) : ''].filter(Boolean).map(esc).join(' · ')}</span></span>${ico('plus', 20, '#137A4B')}</button>`).join('');
        res.innerHTML = (g ? `<div class="sec-h">Продукт</div>${g}` : '') + (p ? `<div class="sec-h">Конкретный товар</div>${p}` : '') || `<p class="mu">Ничего не нашли. Попробуйте иначе или на иврите.</p>`;
        const pick = it => {
          if (replace) { Object.assign(replace, it, { id: replace.id, paid: replace.paid, qty: replace.qty || it.qty }); cartTouch(c); close(); render(); return; }
          addItems(c, [it]); toast(`Добавили: ${itemName(it)}`); render();
        };
        $$('[data-g]', res).forEach(b => b.onclick = () => pick(itemFromGeneric(r.generic[+b.dataset.g])));
        $$('[data-p]', res).forEach(b => b.onclick = () => pick(itemFromProduct(r.products[+b.dataset.p])));
      } catch (e) { if (my === seq) res.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
    q.oninput = () => debounce('csearch', 350, run);
    if (q.value) run();
  });
}

// ---------- список текстом ----------
function parseLine(s) {
  const t = s.replace(/[•·\-–—*]+/g, ' ').trim(); if (!t) return null;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(кг|г|гр|л|мл|шт|уп)?\.?\s*$/i) || t.match(/^(\d+(?:[.,]\d+)?)\s*(кг|г|гр|л|мл|шт|уп)?\.?\s+/i);
  const n = m ? Number(m[1].replace(',', '.')) : null, u = m?.[2]?.toLowerCase() || null;
  const name = (m ? t.replace(m[0], ' ') : t).replace(/\s+/g, ' ').trim();
  return name.length >= 2 ? { raw: s.trim(), name, n, u } : null;
}
function lineToItem(l, r) {
  const g = r.generic?.[0], p = r.products?.[0];
  if (g && /[а-яё]/i.test(l.name)) {
    let qty = UNIT_DEF[g.base_unit] || 1;
    if (l.n) {
      if (l.u === 'кг') qty = l.n * 1000; else if (l.u === 'л') qty = l.n * 1000;
      else if (l.u === 'г' || l.u === 'гр' || l.u === 'мл') qty = l.n;
      else qty = g.base_unit === 'шт' ? l.n : l.n * (UNIT_DEF[g.base_unit] || 1);
    }
    return itemFromGeneric(g, qty);
  }
  if (p) return itemFromProduct(p, l.u === 'кг' ? 1 : l.n || 1, l.u === 'кг' ? l.n : undefined);
  if (g) return itemFromGeneric(g);
  return null;
}
function textSheet(c) {
  sheet('Список покупок', `<textarea class="inp" id="tl" rows="7" placeholder="молоко 3% 2&#10;яйца 12&#10;куриное филе 1 кг&#10;помидоры 1 кг&#10;хлеб"></textarea>
    <button class="cta w" id="tlGo">Найти товары</button><div id="tlRes"></div>`, (el, close) => {
    $('#tlGo', el).onclick = async () => {
      const lines = $('#tl', el).value.split(/\n|,|;/).map(parseLine).filter(Boolean).slice(0, 60);
      if (!lines.length) return;
      const box = $('#tlRes', el), btn = $('#tlGo', el); btn.disabled = true;
      box.innerHTML = `<p class="mu"><span class="spin"></span> Ищем ${lines.length} ${plural(lines.length, 'товар', 'товара', 'товаров')}…</p>`;
      const out = [];
      for (let k = 0; k < lines.length; k += 5) {
        const part = lines.slice(k, k + 5);
        const rs = await Promise.all(part.map(l => rpc('g_cart_search', { p_q: l.name, p_limit: 3 }).catch(() => ({}))));
        part.forEach((l, j) => out.push({ l, it: lineToItem(l, rs[j]) }));
      }
      btn.disabled = false;
      const ok = out.filter(x => x.it);
      box.innerHTML = `<div class="sr">${out.map((x, k) => `<label class="tlr"><input type="checkbox" data-k="${k}" ${x.it ? 'checked' : 'disabled'}>
          <span class="oi"><b>${esc(x.l.raw)}</b><span>${x.it ? '→ ' + esc(itemName(x.it)) + ' · ' + esc(itemQtyText(x.it)) : 'не нашли — добавьте через поиск'}</span></span></label>`).join('')}</div>
        ${ok.length ? `<button class="cta w" id="tlAdd">Добавить ${ok.length} ${plural(ok.length, 'товар', 'товара', 'товаров')}</button>` : ''}`;
      const add = $('#tlAdd', box); if (add) add.onclick = () => {
        const pick = $$('[data-k]', box).filter(i => i.checked).map(i => out[+i.dataset.k].it).filter(Boolean);
        addItems(c, pick); close(); render(); toast(`Добавили ${pick.length} ${plural(pick.length, 'товар', 'товара', 'товаров')}`);
      };
    };
  });
}

// ---------- чек ----------
// фото → куда добавить (новая корзина или существующая) → распознаём → проверка строк → в корзину
function pickReceipt(target) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files?.[0]; if (!f) return; target ? readReceiptInto(f, target) : askReceiptTarget(f); };
  inp.click();
}
function askReceiptTarget(file) {
  if (!app.carts.length) return readReceiptInto(file, null);
  sheet('Куда добавить чек?', `<button class="op" data-t="new"><span class="bk-ic">${ico('plus', 24, '#137A4B')}</span><span class="oi"><b>Новая корзина</b><span>Отдельная корзина из этого чека</span></span></button>
    <div class="sec-h">Добавить к корзине</div>
    ${app.carts.slice(0, 8).map(c => `<button class="op" data-t="${c.id}"><span class="bk-ic">${ico(c.src === 'receipt' ? 'camera' : 'cart', 24, '#137A4B')}</span><span class="oi"><b>${esc(c.title)}</b><span>${c.items.length} ${plural(c.items.length, 'товар', 'товара', 'товаров')} — например, несколько чеков за неделю или длинный чек частями</span></span></button>`).join('')}`,
    (el, close) => $$('[data-t]', el).forEach(b => b.onclick = () => { close(); readReceiptInto(file, b.dataset.t === 'new' ? null : cartById(b.dataset.t)); }));
}
function shrinkReceipt(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      // чек длинный и узкий: ограничиваем длинную сторону 2400 px, чтобы мелкий шрифт остался читаемым
      const k = Math.min(1, 2400 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      res({ mime: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.85).split(',')[1] });
    };
    img.onerror = () => rej(new Error('Не получилось открыть фото'));
    img.src = url;
  });
}
async function readReceiptInto(file, target) {
  const close = sheet('Читаем чек', `<p class="mu" style="margin:0"><span class="spin"></span> Распознаём товары и цены — обычно 15–40 секунд.</p>`);
  try {
    const img = await shrinkReceipt(file);
    const r = await fn('cart', { action: 'receipt', image: img.data, mime: img.mime });
    close();
    if (!r.lines?.length) { toast('Не получилось прочитать чек — попробуйте снять ровнее и ближе'); return; }
    app.ui.rc = { r, target: target?.id || null };
    go('#/receipt');
  } catch (e) { close(); toast('Чек не прочитался: ' + e.message, 5000); }
}
route(/^#\/receipt$/, () => {
  const s = app.ui.rc; if (!s) { setTimeout(() => go('#/baskets')); return ''; }
  const { r } = s, tgt = s.target && cartById(s.target);
  const found = r.lines.filter(l => l.match).length;
  loadNameTr(r.lines.filter(l => l.match).map(l => ({ n: l.match.name }))).then(ch => ch && location.hash === '#/receipt' && render()).catch(() => {});
  return `<div class="hd"><div><div class="sub">${esc([CHAINS[r.chain] || 'Сеть не определена', r.date ? new Date(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '', r.total ? money(r.total, 1) : ''].filter(Boolean).join(' · '))}</div>
      <h1 class="h">Товары из чека</h1></div></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:8px;padding-top:12px">
      <p class="mu" style="margin:0">Нашли ${found} из ${r.lines.length}. Отметьте, что добавить${tgt ? ` в «${esc(tgt.title)}»` : ' в новую корзину'}.</p>
      ${r.lines.map((l, k) => `<label class="tlr"><input type="checkbox" data-k="${k}" ${l.match ? 'checked' : ''}>
        <span class="oi"><b dir="auto">${esc(l.match ? trName(l.match.name) : l.name)}</b>
          <span dir="auto">${esc([l.match ? l.name : 'не нашли в базе', l.kg ? amt(l.kg) + ' кг' : l.qty > 1 ? l.qty + ' шт' : '', l.line_total ? money(l.line_total, 1) : ''].filter(Boolean).join(' · '))}</span></span></label>`).join('')}
      <button class="cta w" id="rcAdd" style="margin-top:8px">Добавить в корзину</button>
      <button class="ghost w" data-go="#/baskets">Отмена</button>
    </div>`;
}, {
  tab: 'basket',
  after(view) {
    const s = app.ui.rc; if (!s) return;
    $('#rcAdd', view).onclick = () => {
      const { r } = s, d = r.date ? new Date(r.date) : new Date();
      const c = (s.target && cartById(s.target)) || newCart('receipt', `Чек ${CHAINS[r.chain] || ''} ${d.getDate()} ${MONTHS[d.getMonth()]}`.replace(/\s+/g, ' '));
      const items = $$('[data-k]', view).filter(i => i.checked).map(i => r.lines[+i.dataset.k]).map(l => {
        const m = l.match, paid = l.line_total || (l.unit_price && (l.kg || l.qty || 1) * l.unit_price) || undefined;
        if (!m) return { id: newId('i'), name: l.name, he: l.name, qty: l.qty || 1, paid, src: 'receipt' };
        const w = m.is_weighted || !!l.kg;
        return { id: newId('i'), barcode: m.barcode, key: m.ingredient || undefined, he: m.name, name: m.name, pack: w ? '' : packLabel(m.pack_amount, m.pack_kind),
          weighted: w, qty: w ? 1 : (l.qty || 1), kg: w ? (l.kg || l.qty || 1) : undefined, paid, chain: r.chain, src: 'receipt' };
      });
      (c.receipts ||= []).push({ chain: r.chain, store: r.store, date: r.date, total: r.total, n: items.length, at: Date.now() });
      addItems(c, items);
      app.ui.rc = null;
      go('#/cart/' + c.id);
      toast(`Добавили ${items.length} ${plural(items.length, 'товар', 'товара', 'товаров')}`);
    };
  },
});

// ---------- «+ Новое» с главной ----------
function newSheet() {
  sheet('Создать', `<div class="sec-h">Меню</div>
    <button class="op" data-n="today"><span class="bk-ic">${ico('menu', 24, '#137A4B')}</span><span class="oi"><b>Меню на сегодня</b><span>Блюда на сегодня с рецептами и корзиной</span></span></button>
    <button class="op" data-n="week"><span class="bk-ic">${ico('cal', 24, '#137A4B')}</span><span class="oi"><b>Меню на неделю</b><span>Новое меню на 7 дней</span></span></button>
    <div class="sec-h">Корзина</div>${newCartButtons()}`, (el, close) => {
    $$('[data-n]', el).forEach(b => b.onclick = () => { close(); startPlan(b.dataset.n); });
    $$('[data-nc]', el).forEach(b => b.addEventListener('click', close, true));
    bindNewCart(el, null);
  });
}
document.addEventListener('click', e => { if (e.target.closest('[data-new]')) { e.preventDefault(); newSheet(); } });

boot();
