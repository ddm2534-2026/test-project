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
  c.updated = Date.now(); delete c.cmp; delete c.cmpM; saveCarts();
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
const packLabel = (a, k) => a && k ? `${amt(a >= 1000 && (k === 'г' || k === 'мл') ? a / 1000 : a)} ${a >= 1000 && k === 'г' ? 'кг' : a >= 1000 && k === 'мл' ? 'л' : k || ''}` : '';
const itemName = i => i.he ? trName(i.he) : i.name;
function itemFromGeneric(g, qty) {
  return { id: newId('i'), key: g.key, name: g.name_ru, unit: g.base_unit, qty: qty || UNIT_DEF[g.base_unit] || 1, img: g.img || null, icon: g.icon || null, src: 'search' };
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

// ---------- корзина из рецепта («Найти в магазинах»): по названию рецепта, без привязки к меню ----------
function recipeNeedItems(r) {
  const by = new Map();
  for (const i of r.ingredients || []) {
    if (!i.key || i.unit === 'по вкусу') continue;
    const d = app.defs[i.key] || {}, q0 = toBase(i, d);
    if (!(q0 > 0)) continue;
    const x = by.get(i.key);
    if (x) { x.q += q0; continue; }
    by.set(i.key, { d, key: i.key, name: d.name_ru || i.name || i.key, q: q0, pantry: !!(i.pantry || d.pantry) });
  }
  return [...by.values()].map(({ d, key, name, q, pantry }) => {
    const qty = d.base_unit === 'шт' ? Math.ceil(q - 0.01) : q >= 100 ? Math.ceil(q / 10) * 10 : Math.max(5, Math.ceil(q / 5) * 5);
    return { id: newId('i'), key, name, unit: d.base_unit || 'г', qty, img: d.img || null, icon: d.icon || null, src: 'recipe', ...(pantry ? { have: true } : {}) };
  });
}
const recipeSig = r => JSON.stringify((r.ingredients || []).map(i => [i.key, i.amount, i.unit]));
function cartForRecipe(r, own) {
  const rid = (own ? 'own:' : 'lib:') + r.id, sig = recipeSig(r);
  let c = app.carts.find(x => x.recipeId === rid);
  if (!c) { c = newCart('recipe', r.name); c.recipeId = rid; }
  else if (c.recipeSig === sig) return c;
  // рецепт поменялся (или корзина новая) — продукты рецепта заново, добавленное вручную остаётся
  c.items = [...recipeNeedItems(r), ...c.items.filter(i => i.src !== 'recipe')];
  c.recipeSig = sig; c.title = r.name;
  cartTouch(c);
  return c;
}

// ---------- корзина из меню ----------
// продукты рецептов меню (как считала корзина меню): ключ + количество в базовых единицах
function menuNeedItems(m) {
  return withMenu(m, () => weekNeed().map(e => {
    const d = app.defs[e.key] || {};
    const qty = d.base_unit === 'шт' ? Math.ceil(e.qty - 0.01) : e.qty >= 100 ? Math.ceil(e.qty / 10) * 10 : Math.max(5, Math.ceil(e.qty / 5) * 5);
    return { id: newId('i'), key: e.key, name: d.name_ru || e.key, unit: d.base_unit || 'г', qty, img: d.img || null, icon: d.icon || null, src: 'menu', ...(m.have?.[e.key] ? { have: true } : {}) };
  }));
}
const menuNeedSig = m => { try { return JSON.stringify(withMenu(m, () => weekNeed().map(e => [e.key, Math.round(e.qty)]).sort())); } catch { return ''; } };
const menuByLid = lid => lid && (app.menu?.lid === lid ? app.menu : app.menus.find(x => x.lid === lid)) || null;
function cartForMenu(m, create) {
  ensureLid(m);
  let c = app.carts.find(x => x.menuLid === m.lid);
  if (!c && create) {
    c = newCart('menu', 'Корзина: ' + menuTitle(m));
    Object.assign(c, { menuLid: m.lid, menuSig: menuNeedSig(m), items: menuNeedItems(m) });
    saveMenu({ local: true }); cartTouch(c);
  }
  return c;
}
// обновить продукты из меню; добавленное вручную остаётся, «есть дома» — сохраняем
function refreshCartFromMenu(c, m) {
  const home = new Set(c.items.filter(i => i.src === 'menu' && i.have).map(i => i.key));
  const picked = new Set(c.items.filter(i => i.src === 'menu-pick' && i.key).map(i => i.key)); // выбранный вручную товар не трогаем и не дублируем
  const fresh = menuNeedItems(m).filter(i => !picked.has(i.key)).map(i => home.has(i.key) ? { ...i, have: true } : i);
  c.items = [...fresh, ...c.items.filter(i => i.src !== 'menu')];
  c.menuSig = menuNeedSig(m); c.title = c.title || 'Корзина: ' + menuTitle(m);
  cartTouch(c);
}
// «Корзина» из меню — это корзина, связанная с меню (создаём при первом открытии)
route(/^#\/basket(\?.*)?$/, () => {
  if (!app.menu?.plan?.dishes?.length) return needMenu();
  const have = cartForMenu(app.menu, false);
  if (have) { setTimeout(() => location.replace('#/cart/' + have.id)); return ''; }
  // справочник продуктов нужен для единиц (шт/г) — подгружаем, потом собираем корзину
  const keys = Object.values(app.menu.recipes || {}).flatMap(r => (r?.ingredients || []).map(i => i.key));
  loadDefs(keys).catch(() => {}).then(() => { if (!location.hash.startsWith('#/basket')) return; const c = cartForMenu(app.menu, true); location.replace('#/cart/' + c.id); });
  return `<p class="pad mu"><span class="spin"></span> Собираем корзину из меню…</p>`;
}, { tab: 'basket' });

// ---------- сравнение по сетям ----------
const cartItemsReq = c => c.items.filter(i => !i.have && (i.barcode || i.key)).map(i => ({ id: i.id, barcode: i.barcode, key: i.key, qty: i.qty, kg: i.kg }));
const CMP_V = 4; // поднять, когда меняется расчёт на сервере — сбросит кэш корзин у всех
const cartSig = (c, shop = shopMode()) => JSON.stringify([CMP_V, shop, cartItemsReq(c)]);
async function cartCompare(c, force) {
  const items = cartItemsReq(c);
  if (!items.length) return null;
  const shop = shopMode(), sig = cartSig(c);
  // кэш отдельно для «с доставкой» и «в магазине»: переключение режимов не пересчитывает заново
  const hit = c.cmpM?.[shop];
  if (!force && hit?.sig === sig && Date.now() - hit.at < 6 * 3600e3) { c.cmp = hit; return hit.data; }
  // если этот режим уже считается в фоне — ждём тот же запрос, а не запускаем второй
  const data = await (!force && cmpPending[c.id + sig] || cartFetch(items, shop, c.id + sig));
  c.cmpM = { ...(c.cmpM || {}), [shop]: { sig, at: Date.now(), data } }; c.cmp = c.cmpM[shop]; saveCarts();
  // второй режим считаем заранее, в фоне — чтобы переключение было мгновенным
  const other = shop === 'delivery' ? 'store' : 'delivery';
  if (!c.cmpM[other] || c.cmpM[other].sig !== cartSig(c, other)) setTimeout(() => cartFetch(items, other, c.id + cartSig(c, other)).then(d2 => {
    if (cartSig(c, shop) !== sig) return; // корзину успели изменить
    c.cmpM = { ...(c.cmpM || {}), [other]: { sig: cartSig(c, other), at: Date.now(), data: d2 } }; saveCarts();
  }).catch(() => {}), 300);
  return data;
}
// первый расчёт после простоя базы бывает медленным — одна повторная попытка
const cmpPending = {};
function cartFetch(items, shop, key) {
  const body = { action: 'compare', items, chains: shop === 'delivery' ? [...SHOP[shop], 'yango'] : SHOP[shop] }; // Yango — только доставка, в магазин к ним не прийти
  const p = fn('cart', body).catch(() => sleep(800).then(() => fn('cart', body)));
  if (key) { cmpPending[key] = p; p.finally(() => { if (cmpPending[key] === p) delete cmpPending[key]; }); }
  return p;
}

// ---------- 13. Список корзин ----------
// раздел «Товары»: сверху лента «Мои корзины» с плюсиком (как «Мои меню»), ниже — поиск товаров по сетям
function cartPics(c) { return [...new Set(c.items.map(i => i.img).filter(Boolean))].slice(0, 3); }
function cartCard(c) {
  const best = cartMin(c), n = c.items.length, pics = cartPics(c);
  const icons = !pics.length ? c.items.slice(0, 3).map(i => i.key && app.defs[i.key] ? null : i.icon).filter(Boolean) : [];
  return `<a class="mm" href="#/cart/${c.id}">${pics.length ? collage(pics, 'mm-pic', c.id) : `<span class="plates mm-pic" style="--bg:${plateBg(c.id)}"><span class="pl pl1 pl-empty">${ico(c.src === 'receipt' ? 'camera' : c.src === 'menu' ? 'menu' : c.src === 'recipe' ? 'book' : 'cart', 30, '#137A4B')}</span>${icons[0] ? `<span class="pl pl2 pl-empty" style="font-size:24px">${esc(icons[0])}</span>` : ''}</span>`}
    <span class="mm-tx"><b>${esc(c.title)}</b><span>${n} ${plural(n, 'товар', 'товара', 'товаров')}</span><span class="mu">${best ? 'от ' + moneyR(best.sum) : n ? '<span class="spin" style="width:12px;height:12px"></span>' : 'пустая'}</span></span>
    <button class="mm-x" data-delc="${c.id}" aria-label="Удалить корзину «${esc(c.title)}»">${ico('close', 14)}</button></a>`;
}
function newCartSheet(target) {
  sheet(target ? 'Добавить товары' : 'Новая корзина', `
    <button class="op" data-nc="search"><span class="bk-ic">${ico('search', 24, '#137A4B')}</span><span class="oi"><b>Искать в сетях</b><span>По-русски или на иврите, в 7 сетях сразу</span></span></button>
    <button class="op" data-nc="text"><span class="bk-ic">${ico('text', 24, '#137A4B')}</span><span class="oi"><b>Списком</b><span>«молоко 3% 2, яйца 12…»</span></span></button>
    <button class="op op-hot" data-nc="receipt"><span class="bk-ic">${ico('camera', 26, '#fff')}</span><span class="oi"><b>Сфотографировать чек</b><span>Распознаем товары и покажем, где та же корзина дешевле</span></span></button>`, (el, close) => {
    $$('[data-nc]', el).forEach(b => b.addEventListener('click', close, { capture: true }));
    bindNewCart(el, target || null);
  });
}
function cartsRow() {
  const m = app.menu, fromMenu = m?.plan?.dishes?.length && !cartForMenu(m, false);
  // вместо одной «+» — сразу три способа собрать корзину
  return `<div class="mm mm-acts" role="group" aria-label="Новая корзина">
          <span class="mma-h">${ico('plus', 14, '#137A4B', 2.6)}Новая корзина</span>
          <button class="mma mma-hot" data-nc="receipt">${ico('camera', 20, '#fff')}<span>Фото чека</span></button>
          <button class="mma" data-nc="text">${ico('text', 20, '#137A4B')}<span>Списком</span></button>
          <button class="mma" data-nc="search">${ico('search', 20, '#137A4B')}<span>Искать в сетях</span></button></div>
        ${fromMenu ? `<a class="mm mm-add mm-menu" href="#/basket"><span class="mm-plus">${ico('menu', 26, '#137A4B')}</span><b>Корзина из меню</b><span class="mu" style="font-size:12px;padding:0 10px;text-align:center">${esc(menuTitle(m))}</span></a>` : ''}
        ${app.carts.map(cartCard).join('')}`;
}
// ряд «Мои корзины» перерисовываем отдельно — чтобы не сбрасывать список товаров ниже
function bindCartsRow(view) {
  const row = $('#mmRow', view); if (!row) return;
  $$('[data-nc]', row).forEach(b => b.onclick = () => {
    const k = b.dataset.nc;
    if (k === 'receipt') return pickReceipt(null);
    if (k === 'text') { const c = newCart('manual'); go('#/cart/' + c.id); return setTimeout(() => textSheet(c), 60); }
    // каталог — на этой же странице: прокручиваем к поиску
    const q = $('#pq', view); if (q) { q.closest('.shop-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => q.focus({ preventScroll: true }), 300); }
  });
  $$('[data-delc]', row).forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const c = cartById(b.dataset.delc); if (!c) return;
    confirmSheet('Удалить корзину?', `«${c.title}» удалится${c.savedId ? ' и из аккаунта' : ''}.`, 'Удалить', async () => { await deleteCart(c); redrawCarts(view); });
  });
  const n = $('#mmN', view); if (n) n.textContent = app.carts.length || '';
}
function redrawCarts(view) {
  const row = $('#mmRow', view); if (!row || !row.isConnected) return;
  row.innerHTML = cartsRow(); bindCartsRow(view);
}
route(/^#\/baskets$/, () => {
  return `<div class="hd"><div><div class="sub">Сравним цены в 7 сетях</div><h1 class="h">Товары</h1></div></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:12px;padding-top:6px">
      <div class="sec-h">Мои корзины<small id="mmN">${app.carts.length || ''}</small></div>
      <div class="mm-row" id="mmRow">${cartsRow()}</div>
      <div class="sec-h" style="margin:6px 0 -6px">Все товары</div>
    </div>
    ${prodBrowser(null, null)}`;
}, {
  tab: 'basket',
  after(view) {
    bindCartsRow(view);
    bindProdBrowser(view, null, null, false);
    cloudLoadCarts().then(ch => { if (ch) redrawCarts(view); });
    // цены «от» для корзин без свежего сравнения — считаем по очереди и перерисовываем ряд
    (async () => {
      let ch = false;
      for (const c of app.carts.filter(c => c.items.length && !cartMin(c))) {
        if (!view.isConnected || location.hash !== '#/baskets') return;
        try { await cartCompare(c); ch = true; } catch {}
      }
      if (ch) redrawCarts(view);
    })();
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
    if (k === 'search') return go(target ? '#/products?cart=' + target.id : '#/products');
    const c = target || newCart('manual');
    if (!target) go('#/cart/' + c.id);
    setTimeout(() => textSheet(c), target ? 0 : 60);
  });
}

// ---------- 14. Корзина ----------
route(/^#\/cart\/([\w-]+)$/, id => {
  const c = cartById(id);
  if (!c) { setTimeout(() => go('#/baskets')); return ''; }
  loadNameTr(c.items.filter(i => i.he).map(i => ({ n: i.he }))).then(ch => ch && location.hash === '#/cart/' + id && render()).catch(() => {});
  const n = c.items.length, paid = c.items.reduce((a, i) => a + (i.paid || 0), 0);
  const rc = (c.receipts || []).map(r => `${CHAINS[r.chain] || 'чек'}${r.date ? ' ' + new Date(r.date).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }) : ''}${r.total ? ' — ' + money(r.total, 1) : ''}`).join(' · ');
  return `<div class="cc-top"><a class="ib" href="#/baskets" aria-label="Ко всем корзинам">${ico('back')}</a>
      <span style="display:flex;gap:8px"><button class="ib" data-ren aria-label="Переименовать">${ico('pen')}</button><button class="ib" data-del aria-label="Удалить корзину">${ico('trash')}</button></span></div>
    <div class="cc-title"><div class="sub">${n} ${plural(n, 'товар', 'товара', 'товаров')}${rc ? ' · ' + esc(rc) : ''}</div><h1 class="h">${esc(c.title)}</h1>
      ${(mm => c.menuLid ? (mm ? `<div class="cc-menu">Из меню «${esc(menuTitle(mm))}»${menuNeedSig(mm) !== c.menuSig ? ` · <b>меню изменилось</b> <button class="linkb" data-mupd>Обновить корзину</button>` : ''}</div>` : `<div class="cc-menu mu">Меню, из которого собрана корзина, удалено</div>`) : '')(menuByLid(c.menuLid))}</div>
    <div class="pad" style="display:flex;flex-direction:column;gap:12px;padding-top:12px">
      ${n ? `<button class="sub-btn" data-sub>${ico('bell', 18)}<span>${subFor('cart', c.savedId) ? 'Подписка на корзину · настроить' : 'Подписаться на корзину'}</span></button>` : ''}
      ${n ? `<div class="seg" role="tablist"><button data-shop="delivery" aria-pressed="${shopMode() === 'delivery'}">С доставкой</button><button data-shop="store" aria-pressed="${shopMode() === 'store'}">В магазине</button></div>
      <div class="cc-chipsw"><div class="cc-chips" id="ccChips"><span class="mu"><span class="spin"></span> Сравниваем цены…</span></div><button class="cc-more" type="button" aria-label="Показать другие сети" hidden><span style="display:grid;transform:rotate(180deg)">${ico('back', 18)}</span></button><button class="cc-more cc-less" type="button" aria-label="Назад к первым сетям" hidden><span style="display:grid">${ico('back', 18)}</span></button></div>
` : ''}
      <div id="ccList">${n ? cartListHtml(c, null, null) : `<p class="mu" style="margin:0">Пока пусто — добавьте товары.</p>`}</div>
      <div class="sec-h" style="margin-top:6px">Добавить</div>
      ${newCartButtons()}
      ${paid ? `<p class="mu" style="margin:0;font-size:12px">По чекам заплачено ${money(paid, 1)} за распознанные товары.</p>` : ''}
    </div>
    ${n ? `<div class="shop-bar cc-bar" id="ccBar" hidden></div>` : ''}`;
}, {
  tab: 'basket',
  after(view, id) {
    const c = cartById(id); if (!c) return;
    bindNewCart(view, c);
    $$('[data-shop]', view).forEach(b => b.onclick = () => { app.profile.shop = b.dataset.shop; saveProfile(); render(); });
    const mu = $('[data-mupd]', view), mm = menuByLid(c.menuLid);
    if (mu && mm) mu.onclick = () => { refreshCartFromMenu(c, mm); toast('Корзина обновлена по меню'); render(); };
    const rn = $('[data-ren]', view); if (rn) rn.onclick = () => sheet('Название корзины', `<input class="inp" id="rn" value="${esc(c.title)}" maxlength="60"><button class="cta w" id="rnOk">Сохранить</button>`,
      (el, close) => { const f = () => { const v = $('#rn', el).value.trim(); if (v) { c.title = v; cartTouch(c); } close(); render(); }; $('#rnOk', el).onclick = f; $('#rn', el).onkeydown = e => e.key === 'Enter' && f(); });
    const sbb = $('[data-sub]', view); if (sbb) sbb.onclick = () => subCart(c);
    if (app.user && !app.subs) loadSubs().then(() => { if (location.hash === '#/cart/' + c.id) render(); });
    const dl = $('[data-del]', view); if (dl) dl.onclick = () => confirmSheet('Удалить корзину?', `«${c.title}» удалится${c.savedId ? ' и из аккаунта' : ''}.`, 'Удалить', async () => { await deleteCart(c); go('#/baskets'); });
    const chips = $('#ccChips', view), list = $('#ccList', view), bar = $('#ccBar', view);
    // ряд сетей крутится вбок: справа затухание и кнопка-стрелка, пока есть что листать
    const more = $('.cc-more', view);
    const edge = () => { if (!chips || !more) return; const sl = Math.abs(chips.scrollLeft), rest = chips.scrollWidth - chips.clientWidth - sl; chips.parentNode.classList.toggle('has-more', rest > 8); chips.parentNode.classList.toggle('has-less', sl > 8); more.hidden = rest <= 8; const less = $('.cc-less', chips.parentNode); if (less) less.hidden = sl <= 8; };
    if (chips && more) { chips.addEventListener('scroll', edge, { passive: true }); addEventListener('resize', edge); more.onclick = () => chips.scrollBy({ left: RTLX * chips.clientWidth * 0.7, behavior: 'smooth' }); const less = $('.cc-less', chips.parentNode); if (less) less.onclick = () => chips.scrollBy({ left: -RTLX * chips.clientWidth * 0.7, behavior: 'smooth' }); new MutationObserver(() => requestAnimationFrame(edge)).observe(chips, { childList: true }); }
    let d = null, seq = 0;
    const selKey = c.id + ':' + shopMode();
    const draw = () => {
      const rows = d?.chains?.length ? cartRows(d) : [];
      let sel = (app.ui.cartSel ||= {})[selKey];
      if (!rows.some(r => r.chain === sel)) sel = rows[0]?.chain || null; // по умолчанию — самая выгодная одна сеть
      const row = rows.find(r => r.chain === sel) || null, n = c.items.filter(i => !i.have && (i.barcode || i.key)).length;
      if (chips && rows.length) { const top = rows.filter(r => r.chain !== 'yango').sort((a, b) => b.have - a.have || a.sum - b.sum)[0], ord = [...rows.filter(r => r.parts), ...rows.filter(r => !r.parts && r.chain !== 'yango'), ...rows.filter(r => r.chain === 'yango')];
        chips.innerHTML = ord.map(r => `<button class="cc-chip${r.chain === sel ? ' on' : ''}${r.parts ? ' cc-combo' : ''}${r.chain === 'yango' ? ' cc-yango' : ''}" data-cs="${r.chain}"><b class="cc-lgs" title="${esc(r.parts ? rowName(r, true) : CHAINS[r.chain] || r.chain)}">${r.chain === 'yango' ? ico('bolt', 13) : ''}${(r.parts || [r]).map(x => chipLogo(x.chain)).join('<em>+</em>')}</b><span>${moneyR(r.sum)}${r.have < n ? ` · ${r.have}/${n}` : ''}${!r.parts && r.chain === modeChain(app.profile.chain) ? ' · ваша' : ''}</span>${r === top ? '<i>дешевле</i>' : r.chain === 'yango' ? '<i class="cc-yi">экспресс</i>' : ''}</button>`).join(''); }
      list.innerHTML = cartListHtml(c, row, sel);
      // значок «i» у товаров, по которым есть карточка (состав, аллергены) — по штрихкоду, в любой сети
      // иконка и название — карточка товара (цены по сетям, состав); замена — только «Другие варианты»
      $$('[data-card]', list).forEach(b => b.onclick = () => { const i = c.items.find(x => x.id === b.dataset.card); if (!i) return; const l = (row?.lines || []).find(x => x.id === i.id); cartItemCard(i, l, l?.ch || sel); });
      if (row && (row.chain === 'yango' || row.parts?.some(x => x.chain === 'yango'))) loadYangoSlugs((row.lines || []).map(l => l.barcode)).then(ch => { if (ch && list.isConnected) draw(); });
      if (bar) {
        if (!row) bar.hidden = true;
        else { bar.hidden = false; bar.innerHTML = `<span class="oi"><b>${esc(rowName(row))} — ${moneyR(row.sum)}</b><span>${row.parts ? row.parts.length + (shopMode() === 'delivery' ? ' заказа' : ' магазина') + ' · ' : ''}${row.fee ? 'товары ' + money(row.total, 1) + ' + доставка ' + money(row.fee, 1) : row.have + ' из ' + n + ' ' + plural(n, 'товара', 'товаров', 'товаров')}${row.have < n ? ' · ' + (n - row.have) + ' нет' : ''}</span></span><button class="cta sm cc-send" data-send>${ico('share', 18, '#fff')} Отправить</button>`;
          $('[data-send]', bar).onclick = () => sendCartSheet(c, d, sel); }
      }
      $$('[data-cs]', chips || view).forEach(b => b.onclick = () => { app.ui.cartSel[selKey] = b.dataset.cs; draw(); });
      $$('[data-q]', list).forEach(b => b.onclick = () => {
        const [iid, dd] = b.dataset.q.split('.'), i = c.items.find(x => x.id === iid); if (!i) return;
        const sl = (row?.lines || []).find(l => l.id === iid);
        let before, after;
        if ((!i.barcode || sl?.how === 'analog') && sl?.barcode && (sl.packs || sl.kg || i.barcode)) {
          // «молоко 3% 2 л» или аналог → товар, который показан в этой сети, целыми упаковками (или на вес): +/− меняет его упаковки, без пересчёта
          // упаковок аналога сервер не отдаёт, если продукт в корзине несколькими строками — тогда берём текущее количество
          before = sl.packs || sl.kg || i.qty;
          Object.assign(i, { need: i.need || (i.barcode ? undefined : { qty: i.qty, unit: i.unit }), barcode: sl.barcode, he: sl.name, name: trName(sl.name), src: i.src === 'menu' ? 'menu-pick' : i.src });
          delete i.unit; delete i.pack; // размер упаковки старого товара здесь уже не верен
          if (sl.kg && !sl.packs) { i.weighted = true; i.kg = Math.max(0, Math.round((sl.kg + 0.25 * +dd) * 100) / 100); i.qty = 1; after = i.kg; }
          else { i.qty = Math.max(0, (sl.packs || i.qty || 1) + +dd); delete i.kg; delete i.weighted; after = i.qty; }
        } else {
          before = i.kg ?? i.qty;
          if (i.kg) i.kg = Math.max(0, Math.round((i.kg + 0.25 * +dd) * 100) / 100);
          else i.qty = Math.max(0, i.qty + (i.barcode || !i.key ? 1 : UNIT_STEP[i.unit || 'г'] || 1) * +dd);
          after = i.kg ?? i.qty;
        }
        if (!after) c.items = c.items.filter(x => x !== i);
        cartTouch(c);
        if (!c.items.length) return render();
        // цены пересчитываем сразу у себя (пропорционально количеству), точный расчёт с акциями и упаковками — следом с сервера
        if (d?.chains && before > 0) {
          for (const ch of d.chains) {
            const ix = (ch.lines || []).findIndex(l => l.id === iid); if (ix < 0) continue;
            if (!after) { ch.lines.splice(ix, 1); ch.have--; } else ch.lines[ix] = { ...ch.lines[ix], cost: Math.round(Number(ch.lines[ix].cost) * after / before * 100) / 100 };
            ch.total = ch.lines.reduce((a, l) => a + Number(l.cost || 0), 0);
          }
          if (!after) d.chains.forEach(ch => ch.missing = (ch.missing || []).filter(x => x !== iid));
        }
        draw(); debounce('ccmp' + c.id, 700, () => load(true));
      });
      $$('[data-want]', list).forEach(a => a.addEventListener('click', () => { const [cc, bc] = a.dataset.want.split('|'); rpc('storai_want', { p_chain: cc, p_barcode: bc }).catch(() => {}); }));
      $$('[data-fix]', list).forEach(b => b.onclick = () => { const i = c.items.find(x => x.id === b.dataset.fix); app.ui.pq = i ? itemName(i) : ''; go('#/products?cart=' + c.id + (i ? '&replace=' + i.id : '')); });
      $$('[data-var]', list).forEach(b => b.onclick = () => {
        const i = c.items.find(x => x.id === b.dataset.var); if (!i) return;
        const l = (row?.lines || []).find(x => x.id === i.id), cc = l?.ch || sel;
        if (!cc) return toast('Подождите — считаем цены');
        variantsSheet(c, i, cc, l, () => { draw(); load(true); });
      });
      $$('[data-hv]', list).forEach(b => b.onclick = () => {
        const i = c.items.find(x => x.id === b.dataset.hv); if (!i) return;
        i.have ? delete i.have : i.have = true;
        // «есть дома» — сразу убираем из сумм; точный пересчёт — следом с сервера
        if (i.have && d?.chains) for (const ch of d.chains) {
          const n0 = (ch.lines || []).length;
          ch.lines = (ch.lines || []).filter(l => l.id !== i.id); if (ch.lines.length < n0) ch.have--;
          ch.missing = (ch.missing || []).filter(x => x !== i.id);
          ch.total = ch.lines.reduce((a, l) => a + Number(l.cost || 0), 0);
        }
        cartTouch(c); draw(); debounce('ccmp' + c.id, 500, () => load(true));
      });
    };
    const exp = $('#ccExp', view);
    const load = force => {
      const my = ++seq;
      cartCompare(c, force).then(x => { if (my !== seq || !list.isConnected) return; d = x; if (!d?.chains?.length && chips) chips.innerHTML = '<span class="mu">Нет товаров для сравнения.</span>'; draw();

        loadNameTr((d?.chains || []).flatMap(r => r.lines || []).filter(l => l.name).map(l => ({ n: l.name }))).then(ch => { if (ch && my === seq && list.isConnected) draw(); }).catch(() => {}); })
        .catch(e => { if (my === seq && chips?.isConnected) chips.innerHTML = `<div class="err">Цены не посчитались: ${esc(e.message)}</div>`; });
    };
    if (c.items.length) load();
  },
});
// список товаров корзины в выбранной сети (или наборе сетей): цена, что именно берём, ссылка на сайт сети
function cartListHtml(c, row, ch) {
  const lines = Object.fromEntries((row?.lines || []).map(l => [l.id, l])), miss = new Set(row?.missing || []);
  const html = i => {
    const l = i.have ? null : lines[i.id], lc = l ? l.ch || ch : ch, gone = !i.have && row && (miss.has(i.id) || (!l && (i.barcode || i.key)));
    const u = l ? lineLink(lc, l) : null, srch = u && linkIsSearch(lc, l.barcode);
    const what = l && l.how !== 'exact' ? trName(l.name || '') : '';
    const where = what ? esc(what) + (l.how === 'analog' ? ' (аналог)' : '') : ''; // сеть выбрана сверху — не повторяем
    const sub = [i.pack ? esc(i.pack) : '', where, !i.barcode && !i.key ? 'не нашли в базе — не сравнивается' : ''].filter(Boolean);
    // две строки: [фото | название, что берём | цена], под ними [действия … количество]
    return `<div class="ci ci2${gone ? ' ci-miss' : ''}${i.have ? ' ci-have' : ''}">
      <span class="pic-ic ci-pic" data-card="${i.id}" role="button" tabindex="0" aria-label="Карточка товара «${esc(itemName(i))}»" style="width:48px;height:48px;font-size:24px;background:#F4F1EA;cursor:pointer">${itemPic(i)}</span>
      <span class="oi" data-card="${i.id}" role="button" tabindex="0" style="cursor:pointer"><b dir="auto">${esc(itemName(i))}</b>${(sb => sb.length ? `<span dir="auto">${sb.join(' · ')}</span>` : '')(sub)}
        ${gone ? `<span class="ci-warn">Нет ${row?.parts ? 'ни в одной из сетей' : 'в ' + esc(CHAINS[ch] || ch)}</span>` : ''}</span>
      <b class="num ci-pr">${l ? money(Number(l.cost), 1) : ''}</b>
      <span class="ci-bot">
        <span class="ci-act">${!i.barcode && !i.key ? `<button class="linkb" data-fix="${i.id}">Найти товар</button>` : ''}
          ${u ? `<a class="linkb ci-site" href="${esc(u)}" target="_blank" rel="noopener"${srch && /^(tivtaam|keshet)$/.test(baseChain(lc)) ? ` data-want="${esc(baseChain(lc))}|${esc(l.barcode)}"` : ''}>${ico('link', 14)} ${srch ? 'Найти на сайте' : 'На сайте'}</a>` : ''}
          ${!i.have && !gone && l && (i.barcode || i.key) ? `<button class="linkb" data-var="${i.id}">Другие варианты</button>` : ''}
          <button class="linkb mu-b" data-hv="${i.id}">${i.have ? 'Вернуть в покупки' : 'Есть дома'}</button></span>
        ${i.have ? '' : `<span class="stp" role="group" aria-label="Количество"><button data-q="${i.id}.-1" aria-label="Меньше">−</button><b class="num" style="min-width:44px;font-size:13px">${esc((!i.barcode || l?.how === 'analog') && l && (l.packs || l.kg) ? (l.packs ? l.packs + ' уп.' : amt(l.kg) + ' кг') : itemQtyText(i))}</b><button data-q="${i.id}.1" aria-label="Больше">+</button></span>`}
      </span></div>`;
  };
  const homeHtml = (hs => hs.length ? `<div class="cc-grp"><b>Есть дома</b><span>${hs.length} ${plural(hs.length, 'товар', 'товара', 'товаров')} · не покупаем</span></div>` + hs.map(html).join('') : '')(c.items.filter(i => i.have));
  const isGone = i => row && (miss.has(i.id) || (!lines[i.id] && (i.barcode || i.key)));
  // порядок: чего нет — сначала, потом что есть, потом «есть дома»
  if (!row?.parts) { const buy = c.items.filter(i => !i.have); return [...buy.filter(isGone), ...buy.filter(i => !isGone(i))].map(html).join('') + homeHtml; }
  // набор из нескольких сетей: чего нет нигде — сначала, потом товары каждой сети по очереди
  const chOf = i => lines[i.id] ? lines[i.id].ch || ch : null;
  return [null, ...row.parts].map(cc => {
    const its = c.items.filter(i => !i.have && chOf(i) === cc);
    if (!its.length) return '';
    const sum = cc ? its.reduce((a, i) => a + Number(lines[i.id]?.cost || 0), 0) : 0, fee = cc ? delivOf(cc)?.fee || 0 : 0;
    return `<div class="cc-grp"><b>${cc ? esc(CHAINS[cc] || cc) : 'Нет ни в одной из сетей'}</b>${cc ? `<span>${its.length} ${plural(its.length, 'товар', 'товара', 'товаров')} · ${money(sum, 1)}${fee ? ' + доставка ' + money(fee, 1) : ''}</span>` : ''}</div>` + its.map(html).join('');
  }).join('') + homeHtml;
}
// «Варианты в этой сети»: похожие товары (тот же продукт справочника) с ценами; выбранный встаёт на место позиции
// Экспресс-доставка (Yango Deli): отдельным блоком под корзиной. Время не пишем — у них оно всё время меняется.
const EXPRESS_MIN = 99;
async function expressBlock(el, c) {
  const items = cartItemsReq(c);
  if (!items.length) { el.innerHTML = ''; return; }
  let x;
  try {
    const sig = cartSig(c, 'yango'); // экспресс-доставка не зависит от режима «с доставкой / в магазине»
    if (c.exp?.sig === sig && Date.now() - c.exp.at < 6 * 3600e3) x = c.exp.data;
    else {
      // та же сборка, что и для сетей, но только по Yango Deli: подходящие товары справочника, целыми упаковками
      const r = await fn('cart', { action: 'compare', items, chains: ['yango'] });
      const row = r?.chains?.find(ch => ch.chain === 'yango');
      const lines = (row?.lines || []).filter(l => l.barcode && Number(l.cost) > 0);
      const offers = lines.length ? await rpc('g_yango_offers', { p_barcodes: lines.map(l => l.barcode) }) : [];
      x = { lines, offers, n: items.length };
      c.exp = { sig, at: Date.now(), data: x }; saveCarts();
    }
  } catch { el.innerHTML = ''; return; }
  const by = new Map(x.offers.map(o => [o.barcode, o]));
  const lines = x.lines.filter(l => by.has(l.barcode)).map(l => ({ l, o: by.get(l.barcode), i: c.items.find(i => i.id === l.id) })).filter(z => z.i);
  if (!lines.length) { el.innerHTML = ''; return; }
  await loadNameTr(lines.map(z => ({ n: z.o.name }))).catch(() => {});
  const sum = lines.reduce((a, z) => a + Number(z.l.cost), 0), n = x.n;
  el.innerHTML = `<section class="cc-exp">
    <div class="cc-exp-h"><span class="cc-exp-ic">${ico('bolt', 18, '#fff')}</span><span class="oi"><b>Нужно прямо сейчас? Экспресс-доставка</b><span>Yango Deli привозит в течение часа · есть ${lines.length} из ${n} ${plural(n, 'товара', 'товаров', 'товаров')}</span></span><b class="num">${moneyR(sum)}</b></div>
    ${sum < EXPRESS_MIN ? `<p class="mu" style="margin:0;font-size:12px">Минимальный заказ у них — ${EXPRESS_MIN} ₪.</p>` : ''}
    <details><summary>Что есть у них</summary><div class="cc-exp-l">${lines.map(({ l, o, i }) => `<a href="https://deli.yango.com/he-il/good/${encodeURIComponent(o.slug)}" target="_blank" rel="noopener"><span dir="auto">${esc(itemName(i))}</span><span class="mu">${esc(trName(o.name))}${o.amount_text ? `, <bdi dir="rtl">${esc(o.amount_text)}</bdi>` : ''}${l.packs > 1 ? ` · ${l.packs} уп. × ${money(o.price, 1)}` : ''}${o.in_stock === false ? ' · может не быть' : ''}</span><b class="num">${o.old_price ? `<s class="mu" style="font-weight:400">${money(o.old_price * (l.packs || 1), 1)}</s> ` : ''}${money(l.cost, 1)}</b></a>`).join('')}</div>
      <p class="mu" style="margin:6px 0 0;font-size:12px">Корзину в Yango Deli собираете сами по ссылкам. Наличие зависит от вашего адреса.</p></details>
  </section>`;
}
function variantsSheet(c, i, chain, cur, done) {
  const title = i.key && app.defs[i.key]?.name_ru || itemName(i);
  sheet(`Варианты в ${CHAINS[chain] || chain}`, `<p class="mu" style="margin:0">${esc(title)}${cur ? ` · сейчас: ${esc(trName(cur.name || ''))}` : ''}</p><div id="vars"><p class="mu"><span class="spin"></span> Ищем…</p></div>`, async (el, close) => {
    const box = $('#vars', el);
    try {
      let list;
      if (i.key) list = (await rpc('g_ingredient_variants', { p_key: i.key, p_chain: chain }).catch(() => rpc('g_ingredient_variants', { p_key: i.key, p_chain: chain }))).filter(o => o.price > 0);
      else list = (await rpc('g_product_search', { p_q: itemName(i), p_chains: [chain], p_limit: 20 })).map(p => ({ barcode: p.barcode, name: p.name, price: Number(p.prices?.[chain]), is_weighted: p.is_weighted, pack: p.pack_amount, pack_unit: p.pack_kind })).filter(o => o.price > 0);
      const seen = new Set(); list = list.filter(o => !seen.has(o.barcode) && seen.add(o.barcode)).sort((a, b) => (a.barcode === cur?.barcode ? -1 : b.barcode === cur?.barcode ? 1 : 0) || a.price - b.price).slice(0, 30);
      await loadNameTr(list.map(o => ({ n: o.name }))).catch(() => {});
      if (!list.length) { box.innerHTML = '<p class="mu">В этой сети подходящих товаров не нашли.</p>'; return; }
      box.innerHTML = `<div class="mlist">${list.map((o, k) => `<button class="op" data-k="${k}"${o.barcode === cur?.barcode ? ' aria-current="true" style="border:2px solid #137A4B"' : ''}>
          <span class="pic-ic" style="width:44px;height:44px;font-size:22px;background:#F4F1EA">${itemPic(i)}</span>
          <span class="oi"><b dir="auto">${esc(trName(o.name))}</b><span>${o.is_weighted ? 'на вес' : o.pack ? esc(packLabel(o.pack, o.pack_unit)) : ''}${o.barcode === cur?.barcode ? ' · выбран сейчас' : ''}</span></span>
          <span class="dl num">${o.deal_price ? `<s class="mu" style="font-weight:400">${money(o.price, 1)}</s><br><span style="color:#B3261E">${money(o.deal_price, 1)}</span>` : money(o.price, 1)}${o.is_weighted ? '<small>/кг</small>' : ''}</span></button>`).join('')}</div>
        ${i.barcode && i.need ? '<button class="ghost w" data-any>Вернуть «любой подходящий» (самый выгодный)</button>' : ''}`;
      $$('[data-k]', box).forEach(b => b.onclick = () => {
        const o = list[+b.dataset.k];
        if (o.barcode === cur?.barcode && i.barcode === o.barcode) return close();
        const packs = i.barcode ? i.qty : (cur?.packs || 1), kg = i.barcode ? i.kg : cur?.kg;
        Object.assign(i, { need: i.need || (i.barcode ? undefined : { qty: i.qty, unit: i.unit }), barcode: o.barcode, he: o.name, name: trName(o.name), pack: o.pack ? packLabel(o.pack, o.pack_unit) : undefined, src: i.src === 'menu' ? 'menu-pick' : i.src });
        delete i.unit;
        // пересчёт упаковок под новый размер: было 4 × 6 яиц → 2 × 12 яиц (сравниваем общее количество в одной единице)
        const was = list.find(x => x.barcode === (cur?.barcode || i.barcode)), base = was && !was.is_weighted && was.pack > 0 ? { amt: was.pack * (packs || 1), unit: was.pack_unit } : null;
        const fit = !o.is_weighted && o.pack > 0 && base && base.unit === o.pack_unit ? Math.max(1, Math.ceil(base.amt / o.pack - 1e-6)) : null;
        if (o.is_weighted) { i.weighted = true; i.kg = kg || (base && /^(г|мл)$/.test(base.unit) ? Math.round(base.amt / 10) / 100 : 1); i.qty = 1; } else { delete i.weighted; delete i.kg; i.qty = fit || Math.max(1, packs || 1); }
        cartTouch(c); close(); toast(fit && fit !== packs ? `Товар заменён · ${fit} уп.` : 'Товар заменён'); done();
      });
      const any = $('[data-any]', box);
      if (any) any.onclick = () => {
        Object.assign(i, { qty: i.need.qty, unit: i.need.unit, name: app.defs[i.key]?.name_ru || i.name });
        for (const k of ['barcode', 'he', 'pack', 'weighted', 'kg', 'need']) delete i[k];
        cartTouch(c); close(); done();
      };
    } catch (e) { box.innerHTML = `<div class="err">Не загрузилось: ${esc(e.message)}</div>`; }
  });
}
function sendCartSheet(c, d, ch) {
  const text = chainCartText(c, d, ch), r = cartRows(d).find(x => x.chain === ch);
  sheet(`Корзина: ${r ? rowName(r) : CHAINS[ch] || ch}`, `<a class="cta w" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Отправить в WhatsApp</a>
    <div style="display:flex;gap:10px">${navigator.share ? '<button class="ghost" style="flex:1" data-share>Поделиться…</button>' : ''}<button class="ghost" style="flex:1" data-copy>Скопировать</button></div>
    <textarea class="inp" readonly style="min-height:220px;font-size:13px" aria-label="Текст корзины">${esc(text)}</textarea>`, el => {
    $('[data-copy]', el).onclick = () => navigator.clipboard.writeText(tr(text)).then(() => toast('Корзина скопирована'), () => { $('textarea', el).select(); toast('Выделили — скопируйте'); });
    const s = $('[data-share]', el); if (s) s.onclick = () => navigator.share({ title: c.title, text: tr(text) }).catch(() => {});
  });
}
// «от» для карточки корзины: самый выгодный вариант среди тех, где есть больше всего товаров (кэш сравнения на 6 ч)
function cartMin(c) {
  const d = c.cmp && c.cmp.sig === cartSig(c) && Date.now() - c.cmp.at < 6 * 3600e3 ? c.cmp.data : null;
  if (!d?.chains?.length) return null;
  return cartRows(d).sort((a, b) => b.have - a.have || a.sum - b.sum)[0];
}
function cmpRows(d) {
  return d.chains.map(x => ({ ...x, fee: delivOf(x.chain)?.fee || 0 })).map(x => ({ ...x, sum: x.total + x.fee }))
    .sort((a, b) => b.have - a.have || a.sum - b.sum);
}
// сети + лучшие наборы из 2 и 3 сетей: каждый товар берём там, где дешевле (с учётом доставки каждой сети)
function cartRows(d) {
  // Yango Deli (экспресс) — в общем ряду, но последним, без наборов и без «дешевле»
  const all = cmpRows(d), yg = all.filter(r => r.chain === 'yango'), singles = all.filter(r => r.chain !== 'yango');
  if (singles.length < 2) return [...singles, ...yg];
  const by = singles.map(r => ({ r, m: Object.fromEntries((r.lines || []).map(l => [l.id, l])) }));
  const ids = [...new Set(singles.flatMap(r => [...(r.lines || []).map(l => l.id), ...(r.missing || [])]))];
  const out = [...singles]; let prev = singles[0];
  for (const k of [2, 3]) {
    let best = null;
    const pick = (start, acc) => {
      if (acc.length === k) {
        const lines = [], miss = [], used = new Set();
        for (const id of ids) {
          let b = null;
          for (const x of acc) { const l = x.m[id]; if (l && (!b || Number(l.cost) < Number(b.cost))) b = { ...l, ch: x.r.chain }; }
          b ? (lines.push(b), used.add(b.ch)) : miss.push(id);
        }
        if (used.size < k) return;
        const total = lines.reduce((a, l) => a + Number(l.cost), 0), fee = acc.reduce((a, x) => a + x.r.fee, 0);
        const row = { chain: 'combo' + k, parts: acc.map(x => x.r.chain), lines, missing: miss, have: lines.length, total, fee, sum: total + fee };
        if (!best || row.have > best.have || (row.have === best.have && row.sum < best.sum)) best = row;
        return;
      }
      for (let i = start; i < by.length; i++) pick(i + 1, [...acc, by[i]]);
    };
    pick(0, []);
    // показываем, только если выгоднее предыдущего варианта хотя бы на 3 ₪ (или покрывает больше товаров)
    if (best && (best.have > prev.have || (best.have === prev.have && best.sum < prev.sum - 3))) { out.push(best); prev = best; }
  }
  return [...out, ...yg];
}
const rowName = (r, short) => r.parts ? r.parts.map(c => short ? (CHAINS[c] || c).split(' ')[0] : CHAINS[c] || c).join(' + ') : CHAINS[r.chain] || r.chain;
const lineLink = (chain, l) => productLink(chain, l.barcode, /:/.test(l.barcode || ''), l.name);
// текст корзины (одна сеть или набор сетей): для WhatsApp / копирования
function chainCartText(c, d, ch) {
  const x = cartRows(d).find(r => r.chain === ch); if (!x) return '';
  const byId = Object.fromEntries(c.items.map(i => [i.id, i]));
  const line = (l, cc) => {
    const i = byId[l.id] || {}, he = l.name || i.he || '', ru = trName(he) !== he ? trName(he) : itemName(i), u = lineLink(cc, l);
    const q = i.kg ? amt(i.kg) + ' кг' : i.barcode ? '× ' + (i.qty || 1) : itemQtyText(i);
    return `▫️ ${ru}${he && he !== ru ? ' (' + he + ')' : ''} ${q} — ${money(Number(l.cost), 1)}${u ? '\n     ' + u : ''}`;
  };
  const parts = x.parts || [x.chain];
  const blocks = parts.map(cc => {
    const ls = (x.lines || []).filter(l => (l.ch || x.chain) === cc), fee = delivOf(cc)?.fee || 0;
    const sub = ls.reduce((a, l) => a + Number(l.cost), 0) + fee;
    return (parts.length > 1 ? `*${CHAINS[cc] || cc}* — ${moneyR(sub)}\n` : '') + ls.map(l => line(l, cc)).join('\n') + (fee ? `\n▫️ Доставка — ${money(fee, 1)}` : '');
  });
  const miss = (x.missing || []).map(id => `▫️ ${itemName(byId[id] || {})} — ${parts.length > 1 ? 'нет ни в одной' : 'нет в этой сети'}`);
  return `🛒 ${c.title} — ${parts.length > 1 ? parts.length + ' сети' : '*' + (CHAINS[x.chain] || x.chain) + '*'} (Sali)\n\n` + blocks.join('\n\n') + (miss.length ? '\n\n' + miss.join('\n') : '') + `\n\nИтого: ${moneyR(x.sum)}`;
}

// ---------- товары: поиск по сетям ----------
// выбранные сети для поиска товаров — свои для «с доставкой» и «в магазине» (по умолчанию все)
// выбранная сеть для магазина: 'all' или одна сеть; своя для «с доставкой» и «в магазине»
const prodChain = () => { const v = app.profile.prodChain?.[shopMode()]; return v && (SHOP[shopMode()].includes(v) || (v === 'yango' && shopMode() === 'delivery')) ? v : 'all'; };
const prodChains = () => prodChain() === 'all' ? SHOP[shopMode()] : [prodChain()];
function itemFromProduct(p, qty, kg) {
  return { id: newId('i'), barcode: p.barcode, key: p.ingredient || undefined, he: p.name, name: pName(p), pack: packLabel(p.pack_amount, p.pack_kind),
    weighted: !!p.is_weighted, qty: qty || 1, kg: p.is_weighted ? (kg || 1) : undefined, img: p.img || null, icon: p.icon || null, pr: p.prices || null, src: 'search' };
}
const searchProducts = (q, limit = 30) => rpc('g_product_search', { p_q: q, p_chains: prodChains(), p_limit: limit });
// цена товара: в выбранной сети или минимальная по сетям
function prodPrice(pr) {
  if (!pr) return null;
  const ch = prodChain();
  if (ch !== 'all') return pr[ch] != null ? { p: Number(pr[ch]), ch } : null;
  let best = null;
  for (const [c, v] of Object.entries(pr)) if (prodChains().includes(c) && (!best || Number(v) < best.p)) best = { p: Number(v), ch: c };
  return best;
}
// корзина, в которую кладём из магазина: из адреса, иначе последняя открытая
const shopCart = cid => cartById(cid) || cartById(app.ui.shopCart) || null;
const inCart = (c, bc) => c?.items.find(x => x.barcode === bc);
// какие товары (по штрихкоду) имеют карточку с составом — кэш на сессию
const infoKnown = new Map();
const infoHas = bc => infoKnown.get(bc) === true;
async function infoCheck(codes) {
  const ask = [...new Set(codes.filter(b => b && /^\d{5,14}$/.test(b) && !infoKnown.has(b)))].slice(0, 150);
  if (!ask.length) return false;
  ask.forEach(b => infoKnown.set(b, false));
  try {
    const r = await fetch(`${REST}g_item_info?select=barcode&found=is.true&barcode=in.(${ask.join(',')})`, { headers: { apikey: KEY } });
    const got = await r.json(); let any = false;
    for (const x of got || []) { infoKnown.set(x.barcode, true); any = true; }
    return any;
  } catch { ask.forEach(b => infoKnown.delete(b)); return false; }
}
// плашка под цвет фона иллюстрации: у картинок фон чуть разный, берём средний цвет по краям самой картинки
const tileBgCache = {};
function tileBg(img) {
  const set = col => { if (col && img.parentElement) img.parentElement.style.background = col; };
  if (tileBgCache[img.src]) return set(tileBgCache[img.src]);
  try {
    const cv = document.createElement('canvas'), n = 24; cv.width = cv.height = n;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, n, n);
    const d = cx.getImageData(0, 0, n, n).data; let r = 0, g = 0, b = 0, k = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) { const i = (y * n + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; }
    set(tileBgCache[img.src] = `rgb(${Math.round(r / k)},${Math.round(g / k)},${Math.round(b / k)})`);
  } catch { /* картинка без CORS — остаётся цвет по умолчанию */ }
}
window.tileBg = tileBg;
function prodCard(p, k, c) {
  const nm = pName(p), pp = p.deal ? { p: +p.deal.price, ch: p.deal.chain } : prodPrice(p.prices), it = inCart(c, p.barcode);
  // в карточке акции — ссылка на товар на сайте сети (у Ошер Ад интернет-магазина нет — ссылки не будет)
  const shop = p.deal ? productLink(p.deal.chain, p.barcode, p.is_weighted, p.name) : null;
  const more = prodChain() === 'all' ? Object.keys(p.prices || {}).length - 1 : 0;
  return `<div class="sp">
    <div class="sp-img" data-info="${k}" role="button" tabindex="0" aria-label="${p.deal ? 'Подробнее об акции' : 'Подробнее о товаре'}">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" crossorigin="anonymous" onload="tileBg(this)">` : `<span>${esc(p.icon || '🛒')}</span>`}${p.info || p.deal ? `<i class="sp-i">${ico('info', 18, '#137A4B', 2.2)}</i>` : ''}${p.deal ? dealOverlay(p.deal) : ''}</div>
    <div class="sp-pr">${pp ? `<b${p.deal ? ' class="sp-deal"' : ''}>${money(pp.p, 1)}</b>${p.deal?.old > pp.p ? ` <s class="mu">${money(+p.deal.old, 1)}</s>` : ''}${p.is_weighted ? '<small> / кг</small>' : ''}` : '<small>нет цены</small>'}</div>
    ${pp && !p.deal && prodChain() === 'all' ? `<div class="sp-ch">${esc(CHAINS[pp.ch] || pp.ch)}${more > 0 ? ` · и ещё в ${more} ${plural(more, 'сети', 'сетях', 'сетях')}` : ''}</div>` : ''}
    <div class="sp-nm sp-info" title="${esc(p.name)}" data-info="${k}">${esc(nm)}</div>
    <div class="sp-pk" dir="auto">${esc([packLabel(p.pack_amount, p.pack_kind), p.name !== nm ? p.name : ''].filter(Boolean).join(' · '))}</div>
    ${shop ? `<a class="sp-shop" href="${esc(shop)}" target="_blank" rel="noopener">${ico('link', 13)} ${linkIsSearch(p.deal.chain, p.barcode) ? 'Найти на сайте' : 'На сайте'}</a>` : ''}
    ${it ? `<span class="stp sp-stp" role="group" aria-label="Количество"><button data-pm="${k}.-1" aria-label="Меньше">−</button><b class="num">${esc(it.kg ? amt(it.kg) + ' кг' : it.qty)}</b><button data-pm="${k}.1" aria-label="Больше">+</button></span>`
      : `<button class="sp-add" data-pa="${k}">В корзину</button>`}
  </div>`;
}
// карточка товара с сайта сети: состав, аллергены, пищевая ценность (тексты на иврите, подписи и частые слова — по-русски)
const NUT_RU = { 'אנרגיה': 'Энергия', 'חלבונים': 'Белки', 'פחמימות': 'Углеводы', 'סוכרים מתוך פחמימות': 'из них сахара', 'שומנים': 'Жиры',
  'מתוכם שומן רווי': 'из них насыщенные', 'חומצות שומן טרנס': 'Трансжиры', 'כולסטרול': 'Холестерин', 'נתרן': 'Натрий', 'סיבים תזונתיים': 'Клетчатка',
  'כפיות סוכר': 'Чайных ложек сахара', 'סידן': 'Кальций', 'ברזל': 'Железо', 'אשלגן': 'Калий', 'מגנזיום': 'Магний', 'אבץ': 'Цинк', 'זרחן': 'Фосфор',
  'יוד': 'Йод', 'סלניום': 'Селен', 'חומצה פולית': 'Фолиевая кислота', 'קרניטין': 'Карнитин', 'סוכרים': 'Сахара', 'סיבים תזונתים': 'Клетчатка',
  'שומן רווי': 'Насыщенные жиры', 'חומצות שומן רווי': 'Насыщенные жиры', 'שומן טרנס': 'Трансжиры', 'אומגה 3': 'Омега-3' };
const NUT_ORDER = ['אנרגיה', 'חלבונים', 'פחמימות', 'סוכרים מתוך פחמימות', 'כפיות סוכר', 'שומנים', 'מתוכם שומן רווי', 'חומצות שומן טרנס', 'כולסטרול', 'סיבים תזונתיים', 'נתרן'];
const UNIT_RU = { 'גרם': 'г', 'גר': 'г', 'מג': 'мг', 'מ"ג': 'мг', 'מקג': 'мкг', 'מק"ג': 'мкг', 'מיקרוגרם': 'мкг', 'קל': 'ккал', 'קלוריות': 'ккал', 'מ"ל': 'мл', 'מל': 'мл' };
const ALG_RU = { 'גלוטן': 'глютен', 'גלוטן חיטה': 'глютен (пшеница)', 'גלוטן שיפון': 'глютен (рожь)', 'גלוטן שעורה': 'глютен (ячмень)', 'גלוטן שיבולת שועל': 'глютен (овёс)',
  'חיטה': 'пшеница', 'ביצים': 'яйца', 'סויה': 'соя', 'חלב': 'молоко', 'שומשום': 'кунжут', 'בוטנים': 'арахис', 'אגוזי לוז': 'фундук', 'אגוזי מלך': 'грецкие орехи',
  'שקדים': 'миндаль', 'פיסטוק': 'фисташки', 'אגוזי קוקוס': 'кокос', 'קוקוס': 'кокос', 'קשיו': 'кешью', 'אגוזי קשיו': 'кешью', 'פקאן': 'пекан', 'אגוזי פקאן': 'пекан',
  'אגוזי ברזיל': 'бразильский орех', 'אגוזי מקדמיה': 'макадамия', 'צנובר': 'кедровые орехи', 'אגוזים': 'орехи', 'סולפיט': 'сульфиты', 'סולפיטים': 'сульфиты',
  'סלרי': 'сельдерей', 'חרדל': 'горчица', 'דגים': 'рыба', 'סרטנים': 'ракообразные', 'רכיכות': 'моллюски', 'תורמוס': 'люпин' };
const NUT_EN = { 'אנרגיה': 'Energy', 'חלבונים': 'Protein', 'פחמימות': 'Carbohydrates', 'סוכרים מתוך פחמימות': 'of which sugars', 'שומנים': 'Fat',
  'מתוכם שומן רווי': 'of which saturated', 'חומצות שומן טרנס': 'Trans fat', 'כולסטרול': 'Cholesterol', 'נתרן': 'Sodium', 'סיבים תזונתיים': 'Fiber',
  'כפיות סוכר': 'Teaspoons of sugar', 'סידן': 'Calcium', 'ברזל': 'Iron', 'אשלגן': 'Potassium', 'מגנזיום': 'Magnesium', 'אבץ': 'Zinc', 'זרחן': 'Phosphorus',
  'יוד': 'Iodine', 'סלניום': 'Selenium', 'חומצה פולית': 'Folic acid', 'קרניטין': 'Carnitine', 'סוכרים': 'Sugars', 'סיבים תזונתים': 'Fiber',
  'שומן רווי': 'Saturated fat', 'חומצות שומן רווי': 'Saturated fat', 'שומן טרנס': 'Trans fat', 'אומגה 3': 'Omega-3' };
// «ויטמין C» / «C ויטמין» → «Витамин C» / «Vitamin C»
const nutName = (n, lang) => { const v = n.match(/^(?:ויטמין\s*([A-Z]\d*)|([A-Z]\d*)\s*ויטמין)$/); if (v) return (lang === 'en' ? 'Vitamin ' : 'Витамин ') + (v[1] || v[2]); return (lang === 'en' ? NUT_EN : NUT_RU)[n]; };
const UNIT_EN = { 'גרם': 'g', 'גר': 'g', 'מג': 'mg', 'מ"ג': 'mg', 'מקג': 'mcg', 'מק"ג': 'mcg', 'מיקרוגרם': 'mcg', 'קל': 'kcal', 'קלוריות': 'kcal', 'מ"ל': 'ml', 'מל': 'ml' };
const KOSHER_TYPE = { 'בשרי': 'мясное', 'חלבי': 'молочное', 'פרווה': 'парве' };
const algRu = s => s ? s.split(/\s*,\s*/).map(x => (APP_LANG === 'ru' && ALG_RU[x.trim()]) || x.trim()).filter(Boolean) : [];
async function prodInfoSheet(p) {
  const nm = pName(p);
  sheet('О товаре', `<p class="pi-nm"><b>${esc(nm)}</b><span dir="rtl">${esc(p.name)}</span></p><div id="pinfo"><p class="mu"><span class="spin"></span> Загружаем…</p></div>`, async el => {
    const box = $('#pinfo', el);
    try { box.innerHTML = (await infoBody(p.barcode)) || '<p class="mu">Подробной информации по этому товару пока нет.</p>'; }
    catch (e) { box.innerHTML = `<div class="err">Не загрузилось: ${esc(e.message)}</div>`; }
  });
}
// разделы карточки «состав, аллергены, пищевая ценность, прочее» — html или null, если данных нет
async function infoBody(barcode) {
  const p = { barcode };
  {
    {
      const r = await fetch(`${REST}g_item_info?barcode=eq.${encodeURIComponent(p.barcode)}&select=*`, { headers: { apikey: KEY } });
      const x0 = (await r.json())?.[0];
      if (!x0?.found) return null;
      // перевод карточки на выбранный язык (если уже готов), иначе — как на сайте, на иврите
      const t = APP_LANG === 'he' ? null : (await fetch(`${REST}g_item_info_tr?barcode=eq.${encodeURIComponent(p.barcode)}&lang=eq.${APP_LANG}&select=*`, { headers: { apikey: KEY } }).then(r => r.json()).catch(() => []))?.[0];
      const x = t ? { ...x0, ingredients: t.ingredients ?? x0.ingredients, contains: t.contains, may_contain: t.may_contain, features: t.features, health_marks: t.health_marks, remark: t.remark, data: { ...(x0.data || {}), ...(t.data || {}) } } : x0;
      const isHe = s => /[\u0590-\u05ff]/.test(s || '');
      // короткие значения на иврите (страна, производитель, кашрут, отметки) — через общий словарь переводов, один раз на все устройства
      const d0 = x.data || {}, short = [...Object.values(d0), ...(x.health_marks || []), ...(x.features ? x.features.split(/\s*,\s*/) : [])].filter(v => isHe(v) && v.length < 80);
      if (APP_LANG !== 'he' && short.length) await loadNameTr(short.map(n => ({ n }))).catch(() => {});
      // сети и «без бренда» словарь названий выкидывает — подставляем сами
      const FIX = APP_LANG === 'en' ? { 'שופרסל': 'Shufersal', 'רמי לוי': 'Rami Levy', 'ויקטורי': 'Victory', 'יוחננוף': 'Yochananof', 'טיב טעם': 'Tiv Taam', 'אושר עד': 'Osher Ad', 'כללי': 'no brand' }
        : { 'שופרסל': 'Шуферсаль', 'רמי לוי': 'Рами Леви', 'ויקטורי': 'Виктори', 'יוחננוף': 'Йохананоф', 'טיב טעם': 'Тив Таам', 'אושר עד': 'Ошер Ад', 'כללי': 'без бренда' };
      const he = s => { const t = APP_LANG !== 'he' && FIX[s?.trim()] || (isHe(s) ? trName(s) : s); return isHe(t) ? `<span dir="rtl" lang="he">${esc(t)}</span>` : esc(t); };
      const sec = (t, body) => body ? `<section class="pi-s"><h3>${t}</h3>${body}</section>` : '';
      const alg = (a => a.length ? `<p>${a.map(w => `<span class="pi-tag">${esc(w)}</span>`).join('')}</p>` : '')(algRu(x.contains));
      const may = (a => a.length ? `<p class="mu">${esc(a.join(', '))}</p>` : '')(algRu(x.may_contain));
      const items = (x.nutrition?.items || []).slice().sort((a, b) => ((i => i < 0 ? 99 : i)(NUT_ORDER.indexOf(a.name))) - ((i => i < 0 ? 99 : i)(NUT_ORDER.indexOf(b.name))));
      const nut = items.length ? `<table class="pi-nut">${items.map(n => `<tr class="${/^(סוכרים מתוך|מתוכם|כפיות)/.test(n.name) ? 'sub' : ''}"><td>${(t => t ? esc(t) : he(n.name))(APP_LANG === 'he' ? null : nutName(n.name, APP_LANG))}</td><td class="num">${esc(String(n.value || '').replace(/^פחות מ\s*/, '< '))} ${esc(APP_LANG === 'he' ? n.unit || '' : (APP_LANG === 'en' ? UNIT_EN : UNIT_RU)[n.unit] || n.unit || '')}</td></tr>`).join('')}</table>` : '';
      const per = x.nutrition?.per ? ` <small class="mu">на ${esc(x.nutrition.per.replace(/גרם|גר/, 'г').replace(/מ"ל|מל/, 'мл'))}</small>` : '';
      const d = x.data || {}, kos = [d['כשרות'], d['רבנות מקומית'] && d['רבנות מקומית'] !== d['כשרות'] ? d['רבנות מקומית'] : null].filter(Boolean);
      const facts = [
        d['חלבי/בשרי/פרווה'] && ['Тип', APP_LANG === 'ru' && KOSHER_TYPE[d['חלבי/בשרי/פרווה']] ? esc(KOSHER_TYPE[d['חלבי/בשרי/פרווה']]) : he(d['חלבי/בשרי/פרווה'])],
        kos.length && ['Кашрут', he(kos.join(' · '))],
        d['פסח'] && ['Песах', he(d['פסח'])],
        d['מותג/יצרן'] && ['Производитель', he(d['מותג/יצרן'])],
        d['ארץ ייצור'] && ['Страна', he(d['ארץ ייצור'])],
        x.unit_kg && ['Примерный вес', `≈ ${x.unit_kg < 1 ? Math.round(x.unit_kg * 1000) + ' г' : amt(+x.unit_kg) + ' кг'}`],
      ].filter(Boolean);
      const marks = [...(x.health_marks || []), ...(x.features ? x.features.split(/\s*,\s*/) : [])].filter(Boolean);
      return sec('Аллергены', alg + (may ? '<p class="pi-may">Может содержать следы:</p>' + may : ''))
        + sec('Пищевая ценность' + per, nut)
        + sec('Состав', x.ingredients ? `<p class="pi-txt">${he(x.ingredients)}</p>` : '')
        + sec('Отметки', marks.length ? `<p>${marks.map(m => `<span class="pi-tag pi-ok">${he(m)}</span>`).join('')}</p>` : '')
        + sec('Прочее', facts.length ? `<dl class="pi-dl">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '')
        + `<p class="mu pi-src">Данные с сайта ${esc(CHAINS.shufersal || 'Шуферсаль')}. Перед покупкой сверяйтесь с упаковкой.</p>`;
    }
  }
}
// каталог: поиск, доставка/магазин, сеть, категория и сетка товаров — на «Товарах» и при добавлении в корзину
function prodBrowser(cid, rid) {
  const mode = shopMode(), ch = prodChain();
  const rc = cid && cartById(cid), ri = rid && rc?.items.find(x => x.id === rid);
  return `${ri ? `<div class="cc-repl"><a class="ib" href="#/cart/${rc.id}" aria-label="Назад к корзине">${ico('back')}</a><span>Замена для «<b>${esc(itemName(ri))}</b>» — выберите товар</span></div>` : ''}<div class="shop-top">
      <div class="shop-row"><input class="inp" id="pq" type="search" placeholder="Поиск товаров: хумус, молоко 3%, חלב…" autocomplete="off" value="${esc(app.ui.pq || '')}"></div>
      <div class="shop-row"><div class="seg shop-seg" role="tablist"><button data-shop="delivery" aria-pressed="${mode === 'delivery'}">Доставка</button><button data-shop="store" aria-pressed="${mode === 'store'}">Магазин</button></div>
        <button type="button" class="inp shop-sel ch-pick" id="pch" aria-label="Сеть" aria-haspopup="dialog">${chainPickLabel(ch)}${ico('down', 18)}</button></div>
      <div class="shop-row">${catBtn('pcat', app.ui.prodCat)}</div>
    </div>
    <div class="pad"><div id="pres"></div></div>
    <a class="shop-bar" id="pbar" hidden></a>`;
}
function bindProdBrowser(view, cid, rid, focus) {
  {
    if (cid && cartById(cid)) app.ui.shopCart = cid;
    const q = $('#pq', view), res = $('#pres', view), bar = $('#pbar', view);
    let seq = 0, list = [], page = 1, more = false, mode = 'search';
    const PAGE = 20;
    const cart = () => shopCart(cid);
    const drawBar = () => {
      const c = cart(); if (!c || !c.items.length) { bar.hidden = true; return; }
      let sum = 0, priced = 0;
      for (const i of c.items) { const pp = prodPrice(i.pr); if (pp) { sum += pp.p * (i.kg || i.qty); priced++; } }
      bar.hidden = false; bar.href = '#/cart/' + c.id;
      bar.innerHTML = `<span class="sb-ic">${ico('cart', 22, '#fff')}<i>${c.items.length}</i></span><span class="oi"><b>${esc(c.title)}</b><span>${priced ? '≈ ' + money(sum) + (priced < c.items.length ? ' · без ' + (c.items.length - priced) + ' поз.' : '') : 'Открыть и сравнить сети'}</span></span><span class="sb-go">Сравнить ›</span>`;
    };
    const draw = () => {
      const c = cart();
      // основные товары, затем отдельными блоками виды, где слово запроса в середине («шоколадные яйца с сюрпризом»)
      const idx = list.map((p, k) => [p, k]), main = idx.filter(([p]) => !p.alt), alts = [...new Set(idx.filter(([p]) => p.alt).map(([p]) => p.alt))];
      const grid = xs => `<div class="sgrid">${xs.map(([p, k]) => prodCard(p, k, c)).join('')}</div>`;
      res.innerHTML = (main.length ? grid(main) : '') + alts.map(a => `<h3 class="sh-alt">Ещё: ${esc(a)}</h3>` + grid(idx.filter(([p]) => p.alt === a))).join('')
        + (more ? `<button class="ghost w sh-more" data-more>Загрузить ещё</button>` : '');
      const mb = $('[data-more]', res); if (mb) mb.onclick = () => { mb.disabled = true; mb.innerHTML = '<span class="spin"></span>'; page++; run(true); };
      $$('[data-pa]', res).forEach(b => b.onclick = () => put(list[+b.dataset.pa]));
      $$('[data-info]', res).forEach(b => { const open = () => openProd(list[+b.dataset.info], () => { draw(); drawBar(); }, put); b.onclick = open; b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }; });
      $$('[data-pm]', res).forEach(b => b.onclick = () => {
        const [k, d] = b.dataset.pm.split('.'), c = cart(), it = inCart(c, list[+k].barcode); if (!it) return;
        if (it.kg) it.kg = Math.max(0, Math.round((it.kg + 0.5 * +d) * 10) / 10); else it.qty = Math.max(0, it.qty + +d);
        if (!(it.kg || it.qty)) c.items = c.items.filter(x => x !== it);
        cartTouch(c); draw(); drawBar();
      });
    };
    const put = p => {
      // замена позиции корзины: ставим выбранный товар на её место и возвращаемся в корзину
      const rc = rid && cartById(cid), ix = rc ? rc.items.findIndex(x => x.id === rid) : -1;
      if (ix >= 0) { const old = rc.items[ix]; rc.items[ix] = { ...itemFromProduct(p), key: p.ingredient || old.key, src: old.src === 'menu' ? 'menu-pick' : old.src }; cartTouch(rc); toast('Заменили'); return go('#/cart/' + rc.id); }
      let c = cart();
      if (!c) { c = newCart('manual'); app.ui.shopCart = c.id; }
      addItems(c, [itemFromProduct(p)]); draw(); drawBar();
    };
    // пустой запрос — все товары выбранных сетей (сначала самые ходовые, разделы вперемешку); иначе поиск; по 20, дальше «Загрузить ещё»
    const run = async (next) => {
      const v = q.value.trim(), my = ++seq; app.ui.pq = v;
      if (!next) { page = 1; more = false; }
      const cat = app.ui.prodCat || null;
      mode = cat ? 'cat' : v.length < 2 ? 'top' : 'search';
      if (!next && !list.length) res.innerHTML = `<p class="mu"><span class="spin"></span> ${mode === 'top' ? 'Загружаем товары…' : 'Ищем…'}</p>`;
      try {
        let got;
        if (mode === 'cat') {
          // раздел справочника (и поиск внутри него): по 20 товаров, сначала те, что есть в большем числе сетей
          const part = await rpc('g_cat_products', { p_grp: cat, p_chains: prodChains(), p_q: v.length >= 2 ? v : null, p_limit: PAGE, p_offset: (page - 1) * PAGE });
          if (my !== seq) return;
          got = next ? [...list, ...part] : part; more = part.length === PAGE;
        } else if (mode === 'top') {
          const part = await rpc('g_top_products', { p_chains: prodChains(), p_limit: PAGE, p_offset: (page - 1) * PAGE });
          if (my !== seq) return;
          got = next ? [...list, ...part] : part; more = part.length === PAGE;
        } else {
          got = await searchProducts(v, PAGE * page + 1);
          if (my !== seq) return;
          more = got.length > PAGE * page; got = got.slice(0, PAGE * page);
        }
        list = got;
        if (!list.length) { res.innerHTML = `<p class="mu">Ничего не нашли${prodChain() === 'all' ? '' : ' в ' + esc(CHAINS[prodChain()])}${cat ? ' в этой категории' : ''}. Попробуйте иначе или на иврите.</p>`; return; }
        draw();
        loadNameTr(list.filter(needTr).map(p => ({ n: p.name }))).then(ch => { if (ch && my === seq && res.isConnected) draw(); }).catch(() => {});
      } catch (e) { if (my === seq) res.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
    q.oninput = () => debounce('psearch', 300, run);
    $$('[data-shop]', view).forEach(b => b.onclick = () => { app.profile.shop = b.dataset.shop; saveProfile(); render(); });
    const pcat = $('#pcat', view); catBtnSync(pcat, app.ui.prodCat);
    pcat.onclick = () => catSheet(app.ui.prodCat || null, [], v => { app.ui.prodCat = v; list = []; render(); });
    $('#pch', view).onclick = () => chainPickSheet(shopMode(), prodChain(), v => { (app.profile.prodChain ||= {})[shopMode()] = v; saveProfile(); $('#pch', view).innerHTML = chainPickLabel(v) + ico('down', 18); list = []; run(); drawBar(); });
    run(); drawBar(); if (focus && !q.value) setTimeout(() => q.focus(), 30);
  }
}
route(/^#\/products(?:\?cart=([\w-]+)(?:&replace=([\w-]+))?)?$/, (cid, rid) => prodBrowser(cid, rid), {
  tab: 'basket',
  after(view, cid, rid) { bindProdBrowser(view, cid, rid, true); },
});

// плашка сети в корзине: логотип (если есть) + формат магазина у Шуферсаля; иначе — название
const CHAIN_FMT = { shufersal_deal: 'Дил', shufersal_sheli: 'Шели', shufersal_express: 'Экспресс' };
const chipLogo = ch => chainLogo(ch) ? `<img class="cc-lg" src="${chainLogo(ch)}" alt="${esc(CHAINS[ch] || ch)}">${CHAIN_FMT[ch] ? `<small class="cc-fmt">${CHAIN_FMT[ch]}</small>` : ''}` : esc(CHAINS[ch] || ch);
// выбор сети с логотипами (вместо обычного списка — в нём картинки не показать)
const chainPickLabel = ch => ch === 'all' ? '<span class="cp-nm">Все сети</span>' : `${chainLogo(ch) ? `<img class="cp-lg" src="${chainLogo(ch)}" alt="">` : ''}<span class="cp-nm">${esc(CHAINS[ch] || ch)}</span>`;
function chainPickSheet(mode, cur, pick, list) {
  const opts = ['all', ...(list || [...SHOP[mode], ...(mode === 'delivery' ? ['yango'] : [])])];
  sheet('Сеть', `<div class="cp-list">${opts.map(x => `<button class="cp-opt" data-ch="${x}" aria-pressed="${cur === x}">
      <span class="cp-l">${x === 'all' ? ico('cart', 22) : chainLogo(x) ? `<img src="${chainLogo(x)}" alt="">` : ''}</span>
      <span class="cp-t">${x === 'all' ? 'Все сети' : esc(CHAINS[x] || x)}${x === 'yango' ? ' <small>⚡ экспресс</small>' : ''}</span>${cur === x ? ico('check', 18, '#137A4B', 2.4) : ''}</button>`).join('')}</div>`,
    (el, close) => $$('[data-ch]', el).forEach(b => b.onclick = () => { close(); if (b.dataset.ch !== cur) pick(b.dataset.ch); }));
}
// ---------- фильтр категорий: разделы и подразделы справочника (для «Акций» и «Товаров») ----------
let catTreeP = null;
const catNames = {};
function catTree() {
  const c = LS.get('sali.cats', null);
  if (c && c.v === 1 && c.t > Date.now() - 864e5 && Array.isArray(c.nodes)) { c.nodes.forEach(n => { catNames[n.key] = n; }); return Promise.resolve(c.nodes); }
  return catTreeP ||= rpc('g_cat_tree').then(nodes => { LS.set('sali.cats', { v: 1, t: Date.now(), nodes }); nodes.forEach(n => { catNames[n.key] = n; }); return nodes; }).finally(() => { catTreeP = null; });
}
// название раздела на языке интерфейса, без пояснений в скобках
function catName(n) {
  if (!n) return '';
  const full = APP_LANG === 'he' ? (n.he || n.ru) : APP_LANG === 'en' ? tr(n.ru) : n.ru;
  const s = String(full || '').replace(/\s*\([^)]*\)/g, '').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
const catBtnLabel = key => key ? (catNames[key] ? catName(catNames[key]) : '…') : 'Все категории';
const catBtn = (id, key) => `<button type="button" class="inp shop-sel cat-btn${key ? ' on' : ''}" id="${id}" aria-haspopup="dialog" aria-label="Категория">${ico('menu', 18)}<span class="cp-nm">${esc(catBtnLabel(key))}</span>${ico('down', 18)}</button>`;
// подпись на кнопке, когда справочник догрузился
function catBtnSync(btn, key) { if (!btn || !key) return; catTree().then(() => { const n = btn.querySelector('.cp-nm'); if (n) n.textContent = catBtnLabel(key); }).catch(() => {}); }
function catSheet(cur, exclude, pick) {
  catTree().then(nodes => {
    const roots = nodes.filter(n => !n.parent && !exclude.includes(n.key));
    const kids = k => nodes.filter(n => n.parent === k);
    const curRoot = cur ? (catNames[cur]?.parent || cur) : null;
    sheet('Категории', `<div class="cat-list"><button class="cat-all" data-cat="" aria-pressed="${!cur}">${ico('menu', 18)}Все категории</button>
      ${roots.map(r => `<div class="cat-g${r.key === curRoot ? ' open' : ''}"><button class="cat-r" data-open aria-expanded="${r.key === curRoot}"><span>${esc(catName(r))}</span>${ico('down', 18)}</button>
        <div class="cat-kids"><button class="pill" data-cat="${r.key}" aria-pressed="${cur === r.key}">Все: ${esc(catName(r))}</button>${kids(r.key).map(k => `<button class="pill" data-cat="${k.key}" aria-pressed="${cur === k.key}">${esc(catName(k))}</button>`).join('')}</div></div>`).join('')}</div>`,
      (el, close) => {
        $$('[data-open]', el).forEach(b => b.onclick = () => {
          const g = b.parentNode, open = !g.classList.contains('open');
          $$('.cat-g', el).forEach(x => { x.classList.remove('open'); x.firstElementChild.setAttribute('aria-expanded', 'false'); });
          if (open) { g.classList.add('open'); b.setAttribute('aria-expanded', 'true'); b.scrollIntoView({ block: 'nearest' }); }
        });
        $$('[data-cat]', el).forEach(b => b.onclick = () => { close(); const v = b.dataset.cat || null; if (v !== cur) pick(v); });
      });
  }).catch(e => toast('Категории не загрузились: ' + e.message));
}
// ---------- Акции: все сети, сортировка, два баннера с самыми большими скидками ----------
const DEAL_SORTS = [['save', 'По сумме выгоды'], ['pct', 'По % скидки'], ['ends', 'По сроку действия']];
// фон баннера — по разделу справочника, к которому относится товар
const GRP_BG = {
  grp_produce: ['#E3F4D6', '#9FD487', '#2F6B1F'], grp_dairy: ['#EAF4FF', '#B4D6F4', '#1F4F7A'], grp_meat: ['#FFE6DE', '#F2A28E', '#7A2B1C'],
  grp_fish: ['#DDF4F4', '#8DD0D3', '#1C5E62'], grp_bakery: ['#FFF1D8', '#F0C27A', '#6E4A12'], grp_grocery: ['#FFF6DC', '#F2D27C', '#6B5312'],
  grp_drinks: ['#ECE8FF', '#B5AAF2', '#3F338A'], grp_frozen: ['#E7F7FF', '#A4DAF4', '#1D5675'], grp_household: ['#F2EEF8', '#CBBFE0', '#4B3B6B'],
};
const GRP_DEF = ['#F6F1E7', '#E3D6BD', '#5A4A2C'];
// цвета сетей для плашки с названием (логотипы подставятся из site/app/logos/<сеть>.svg, если положить файлы)
const CHAIN_COLOR = { shufersal: '#E30613', ramilevy: '#0C4DA2', victory: '#D7141A', tivtaam: '#1A1A1A', yochananof: '#F08A00', osherad: '#F2C200', keshet: '#6A2C8F', yango: '#FFCC00' };
// логотипы сетей (site/app/logos); для магазинных вариантов (shufersal_deal…) — логотип основной сети
const CHAIN_LOGOS = { shufersal: 'logos/shufersal.svg', ramilevy: 'logos/ramilevy.png', victory: 'logos/victory.png', tivtaam: 'logos/tivtaam.png', yochananof: 'logos/yochananof.png',
  osherad: 'logos/osherad.png', keshet: 'logos/keshet.png', yango: 'logos/yango.png' };
const chainLogo = ch => CHAIN_LOGOS[ch] || CHAIN_LOGOS[String(ch).replace(/_.*$/, '')];
const chainBadge = ch => chainLogo(ch) ? `<span class="ch-lg"><img src="${chainLogo(ch)}" alt="${esc(CHAINS[ch] || ch)}"></span>`
  : `<span class="ch-badge" style="--c:${CHAIN_COLOR[ch] || '#333'}">${esc((CHAINS[ch] || ch).replace(/ Онлайн$/, ''))}</span>`;
// условия акции коротко, по-русски
function dealTerms(d) {
  const out = [];
  if (+d.qty > 1 && +d.total > 0) out.push(`${+d.qty} за ${money(+d.total, 1)}`);
  else if (+d.qty > 1) out.push(`от ${+d.qty} шт. — скидка ${d.pct}%`);
  else out.push(`${money(+d.price, 1)} вместо ${money(+d.old, 1)}`);
  if (+d.min_purchase > 0) out.push(`при покупке от ${money(+d.min_purchase, 0)}`);
  if (+d.max_units > 0) out.push(`не больше ${+d.max_units} шт.`);
  if (d.ends) out.push('до ' + new Date(d.ends).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }));
  return out;
}
// на картинке акционного товара: скидка, сеть, срок
const dealOverlay = d => `${d.pct ? `<b class="sp-pct">−${d.pct}%</b>` : ''}<span class="sp-dl">${chainBadge(d.chain)}${d.ends ? `<span class="sp-end">до ${new Date(d.ends).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }).replace('.', '')}</span>` : ''}</span>`;
const openProd = (p, after, add) => p.deal ? dealSheet(p, after) : productSheet(p, after, add);
// карточка товара: иллюстрация в круге, цены в сетях, ссылка в магазин, состав (где есть), «В корзину»
function productSheet(p, after, add, opt = {}) {
  const [a, b, ink] = GRP_BG[p.grp] || GRP_DEF, nm = pName(p), sel = opt.chain || prodChain();
  const prices = Object.entries(p.prices || {}).map(([ch, pr]) => [ch, +pr]).filter(([, pr]) => pr > 0).sort((x, y) => x[1] - y[1]);
  const main = prices.find(([ch]) => ch === sel) || prices[0], unit = p.is_weighted ? '<small>/ кг</small>' : '';
  const pack = packLabel(p.pack_amount, p.pack_kind);
  sheet('Товар', `<div class="dc pc" style="--a:${a};--b:${b};--ink:${ink}">
      <div class="dc-pic pc-pic">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span>${esc(p.icon || '🛒')}</span>`}</div>
      <h3 class="dc-nm">${esc(nm)}</h3>
      ${nm !== p.name ? `<p class="dc-he" dir="rtl">${esc(p.name)}</p>` : ''}${pack && !p.is_weighted ? `<p class="pc-pack">${esc(pack)}</p>` : ''}
      ${main ? `<div class="dc-prices"><b class="dc-new pc-new">${money(main[1], 2)}</b>${unit}</div><div class="pc-at">${chainBadge(main[0])}</div>` : '<p class="mu">Цены сейчас нет</p>'}
      ${opt.have ? `<p class="pc-pack" style="margin-top:6px">${esc(opt.have)}</p>` : ''}
    </div>
    ${prices.length > 1 ? `<section class="pi-s pc-ps"><h3>Цены в сетях</h3>${prices.map(([ch, pr], i) => `<div class="pc-row${ch === main?.[0] ? ' on' : ''}"><span class="pc-l">${chipLogo(ch)}</span><span class="pc-v">${money(pr, 2)}${unit}${i === 0 ? ' <i>дешевле</i>' : ''}</span></div>`).join('')}</section>` : ''}
    <div class="dc-act">${add ? `<button class="cta" data-padd>${ico('cart', 18, '#fff')} В корзину</button>` : ''}${main ? `<a class="ghost" href="${esc(productLink(main[0], p.barcode, p.is_weighted, p.name))}" target="_blank" rel="noopener">${ico('link', 18)} ${linkIsSearch(main[0], p.barcode) ? 'Найти на сайте' : 'На сайте'}</a>` : ''}</div>
    ${p.barcode ? `<button class="sub-btn" data-psub>${ico('bell', 18)}<span>${subFor('product', p.barcode) ? 'Подписка на товар · настроить' : 'Подписаться на товар'}</span></button>` : ''}
    <div id="pcinfo"></div>`, async (el, close) => {
    const ad = $('[data-padd]', el); if (ad) ad.onclick = () => { close(); add(p); after && after(); };
    const ps = $('[data-psub]', el); if (ps) ps.onclick = () => { close(); subSheet({ kind: 'product', ref: p.barcode, title: pName(p) }); };
    const box = $('#pcinfo', el);
    if (p.info !== false) { box.innerHTML = '<p class="mu" style="margin-top:12px"><span class="spin"></span> Состав…</p>'; try { box.innerHTML = (await infoBody(p.barcode)) || ''; } catch { box.innerHTML = ''; } }
  });
}
// карточка товара из корзины: тот товар, что взяли в выбранной сети (или сам товар позиции), со всеми ценами и составом
async function cartItemCard(i, l, ch) {
  const bc = l?.barcode || i.barcode;
  let p = null;
  if (bc) try { p = await rpc('g_product_card', { p_barcode: bc, p_chains: [...new Set([...SHOP[shopMode()], 'yango', ...(ch ? [ch] : [])])] }); } catch (e) { console.warn(e); }
  // у весового товара цена за кг; если в сети цены нет в базе — хотя бы цена из расчёта корзины
  if (p && l && ch && !p.prices?.[ch] && Number(l.cost) > 0) (p.prices ||= {})[ch] = l.kg ? Number(l.cost) / l.kg : l.packs ? Number(l.cost) / l.packs : Number(l.cost);
  if (!p) p = { barcode: bc || '', name: l?.name || itemName(i), prices: {}, img: i.img || null, icon: i.icon || null, info: bc ? undefined : false };
  if (!p.img && i.img) p.img = i.img;
  if (!p.icon && i.icon) p.icon = i.icon;
  await loadNameTr([{ n: p.name }]).catch(() => {});
  productSheet(p, null, null, { chain: ch || null, have: l ? `В корзине: ${(l.packs ? l.packs + ' уп.' : l.kg ? amt(l.kg) + ' кг' : itemQtyText(i))} · ${money(Number(l.cost), 2)}` : '' });
}
// карточка акции: фото в круге, цены, экономия, срок, условия; в корзину / поделиться
function dealSheet(p, after) {
  const d = p.deal, [a, b, ink] = GRP_BG[p.grp] || GRP_DEF, nm = pName(p);
  const per = +d.qty > 1 && +d.total > 0 ? +d.total / +d.qty : +d.price;
  const ends = d.ends ? new Date(d.ends).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }) : '';
  const left = d.ends ? Math.ceil((new Date(d.ends) - Date.now()) / 864e5) : null;
  const shop = productLink(d.chain, p.barcode, p.is_weighted, p.name); // у Ошер Ад интернет-магазина нет — ссылки не будет
  sheet('Акция', `<div class="dc" style="--a:${a};--b:${b};--ink:${ink}">
      <div class="dc-top">${chainBadge(d.chain)}${d.pct ? `<b class="dc-pct">−${d.pct}%</b>` : ''}</div>
      <div class="dc-pic">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span>${esc(p.icon || '🛒')}</span>`}</div>
      <h3 class="dc-nm">${esc(nm)}</h3>
      ${nm !== p.name ? `<p class="dc-he" dir="rtl">${esc(p.name)}</p>` : ''}
      <div class="dc-prices"><b class="dc-new">${money(per, 2)}</b><s class="dc-old">${money(+d.old, 2)}</s>${p.is_weighted ? '<small>/ кг</small>' : ''}</div>
      <div class="dc-save">Экономия ${money(+d.save, 2)}${+d.qty > 1 && +d.total > 0 ? ` на ${+d.qty} шт.` : +d.qty > 1 ? ' на штуке' : ''}${d.pct ? ` · ${d.pct}%` : ''}</div>
      <ul class="dc-terms">${dealTerms({ ...d, ends: null }).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      ${ends ? `<div class="dc-ends">${ico('clock', 16)} Действует до ${esc(ends)}${left != null && left <= 3 ? ` · ${left <= 1 ? 'последний день' : 'осталось ' + left + ' ' + plural(left, 'день', 'дня', 'дней')}` : ''}</div>` : ''}
    </div>
    <div class="dc-act"><button class="cta" data-dadd>${ico('cart', 18, '#fff')} В корзину</button><button class="ghost" data-dshare>${ico('share', 18)} Поделиться</button>${shop ? `<a class="ghost dc-site" href="${esc(shop)}" target="_blank" rel="noopener">${ico('link', 18)} ${linkIsSearch(d.chain, p.barcode) ? 'Найти на сайте' : 'На сайте'}</a>` : ''}</div>
    ${p.info ? `<button class="linkb dc-info" data-dinfo>Состав и пищевая ценность</button>` : ''}
    <button class="sub-btn" data-psub>${ico('bell', 18)}<span>${subFor('product', p.barcode) ? 'Подписка на товар · настроить' : 'Подписаться на товар'}</span></button>`, (el, close) => {
    $('[data-psub]', el).onclick = () => { close(); subSheet({ kind: 'product', ref: p.barcode, title: pName(p) }); };
    $('[data-dadd]', el).onclick = () => {
      let c = shopCart(); if (!c) { c = newCart('manual'); app.ui.shopCart = c.id; }
      const it = { ...itemFromProduct(p) }; if (+d.qty > 1 && !p.is_weighted) it.qty = +d.qty; // сразу под условие «N за …»
      addItems(c, [it]); close(); toast('Добавили в корзину'); after && after();
    };
    $('[data-dshare]', el).onclick = async () => {
      const text = `${nm} — ${money(per, 2)} вместо ${money(+d.old, 2)}${d.pct ? ` (−${d.pct}%)` : ''} в ${(CHAINS[d.chain] || d.chain).replace(/ Онлайн$/, '')}${ends ? `, до ${ends}` : ''}`;
      const url = location.href.split('#')[0] + '#/deals';
      try { if (navigator.share) await navigator.share({ title: tr('Акция'), text: tr(text), url }); else { await navigator.clipboard.writeText(tr(text) + '\n' + url); toast('Скопировали — можно вставить в сообщение'); } } catch { /* отменили */ }
    };
    const inf = $('[data-dinfo]', el); if (inf) inf.onclick = () => { close(); prodInfoSheet(p); };
  });
}
function dealBanner(p) {
  const d = p.deal, [a, b, ink] = GRP_BG[p.grp] || GRP_DEF;
  return `<a class="dl-ban" style="--a:${a};--b:${b};--ink:${ink}" data-bk="${esc(p.barcode)}">
    <span class="dl-ban-tx">
      <span class="dl-ban-top">${chainBadge(d.chain)}</span>
      <b class="dl-ban-pct">−${d.pct}%</b>
      <span class="dl-ban-nm">${esc(pName(p))}</span>
      <span class="dl-ban-terms">${dealTerms(d).map(esc).join(' · ')}</span>
    </span>
    <i class="sp-i dl-ban-i">${ico('info', 18, '#137A4B', 2.2)}</i>
    <span class="dl-ban-pic">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : `<span>${esc(p.icon || '🛒')}</span>`}</span>
  </a>`;
}
// акции — из файлов сетей, одинаковые для доставки и магазина; поэтому только выбор сети, без переключателя
const DEAL_CHAINS = ['shufersal', 'ramilevy', 'victory', 'tivtaam', 'keshet', 'yochananof', 'osherad'];
// выбор сети живёт только до закрытия приложения: при каждом открытии — все сети
const dealChain = () => DEAL_CHAINS.includes(app.ui.dealChain) ? app.ui.dealChain : 'all';
const dealChains = () => dealChain() === 'all' ? null : [dealChain()];
// ссылки с лендинга: #/deals?sort=pct&chain=shufersal — применяем и убираем из адреса
route(/^#\/deals\?(.*)$/, (qs) => {
  const p = new URLSearchParams(qs);
  if (DEAL_SORTS.some(([k]) => k === p.get('sort'))) app.ui.dealSort = p.get('sort');
  if (p.has('chain')) app.ui.dealChain = p.get('chain');
  setTimeout(() => { history.replaceState(null, '', location.pathname + location.search + '#/deals'); render(); });
  return '';
});
route(/^#\/deals$/, () => {
  const sort = app.ui.dealSort || 'save';
  return `<div class="pad dl-title"><h1 class="h">Акции</h1></div>
    <div class="shop-top">
      <div class="shop-row"><input class="inp" id="dq" type="search" placeholder="Поиск по акциям" autocomplete="off" value="${esc(app.ui.dq || '')}"></div>
      <div class="shop-row"><button type="button" class="inp shop-sel ch-pick" id="dch" aria-label="Сеть" aria-haspopup="dialog">${chainPickLabel(dealChain())}${ico('down', 18)}</button></div>
      <div class="shop-row">${catBtn('dcat', app.ui.dealCat)}<select class="inp shop-sel dl-sort" id="dsort" aria-label="Сортировка">${DEAL_SORTS.map(([k, t]) => `<option value="${k}"${sort === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div class="pad"><div class="dl-bansw"><div class="dl-bans" id="dbans"></div><button class="dl-arr dl-prev" aria-label="Назад">${ico('back', 18)}</button><button class="dl-arr dl-next" aria-label="Ещё акции">${ico('back', 18)}</button></div><div id="dres"><p class="mu"><span class="spin"></span> Загружаем акции…</p></div></div>
    <a class="shop-bar" id="pbar" hidden></a>`;
}, {
  tab: 'deals',
  after(view) {
    const res = $('#dres', view), bans = $('#dbans', view), bar = $('#pbar', view), PAGE = 20;
    let list = [], page = 1, more = false, seq = 0, top = [];
    const sort = () => app.ui.dealSort || 'save';
    const drawBar = () => {
      const c = shopCart(); if (!c || !c.items.length) { bar.hidden = true; return; }
      bar.hidden = false; bar.href = '#/cart/' + c.id;
      bar.innerHTML = `<span class="sb-ic">${ico('cart', 22, '#fff')}<i>${c.items.length}</i></span><span class="oi"><b>${esc(c.title)}</b><span>Перейти в корзину</span></span>`;
    };
    const put = p => { let c = shopCart(); if (!c) { c = newCart('manual'); app.ui.shopCart = c.id; } addItems(c, [itemFromProduct(p)]); draw(); drawBar(); toast('Добавили в корзину'); };
    const draw = () => {
      const c = shopCart();
      bans.innerHTML = top.map(dealBanner).join('');
      $$('[data-bk]', bans).forEach(b => b.onclick = e => { e.preventDefault(); const p = top.find(x => x.barcode === b.dataset.bk); if (p) dealSheet(p, () => { draw(); drawBar(); }); });
      res.innerHTML = `<div class="sgrid">${list.map((p, k) => prodCard(p, k, c)).join('')}</div>` + (more ? `<button class="ghost w sh-more" data-more>Загрузить ещё</button>` : '');
      $$('[data-pa]', res).forEach(b => b.onclick = () => put(list[+b.dataset.pa]));
      $$('[data-info]', res).forEach(b => b.onclick = () => openProd(list[+b.dataset.info], () => { draw(); drawBar(); }, put));
      $$('[data-pm]', res).forEach(b => b.onclick = () => {
        const [k, d] = b.dataset.pm.split('.'), c = shopCart(), it = inCart(c, list[+k].barcode); if (!it) return;
        if (it.kg) it.kg = Math.max(0, Math.round((it.kg + 0.5 * +d) * 10) / 10); else it.qty = Math.max(0, it.qty + +d);
        if (!(it.kg || it.qty)) c.items = c.items.filter(x => x !== it);
        cartTouch(c); draw(); drawBar();
      });
      const mb = $('[data-more]', res); if (mb) mb.onclick = () => { mb.disabled = true; mb.innerHTML = '<span class="spin"></span>'; page++; load(true); };
    };
    const load = async next => {
      const my = ++seq; if (!next) { page = 1; list = []; }
      try {
        const q = ($('#dq', view)?.value || '').trim();
        const part = await rpc('g_deals_cat', { p_sort: sort(), p_limit: PAGE, p_offset: (page - 1) * PAGE, p_q: q.length >= 2 ? q : null, p_grp: app.ui.dealCat || null, p_chains: dealChains() });
        if (my !== seq) return;
        list = next ? [...list, ...part] : part; more = part.length === PAGE;
        if (!list.length) { res.innerHTML = `<p class="mu">${($('#dq', view)?.value || '').trim().length >= 2 ? 'По этому запросу акций нет.' : app.ui.dealCat ? 'В этой категории акций сейчас нет.' : 'Сейчас акций не нашли.'}</p>`; return; }
        draw();
        loadNameTr([...list, ...top].filter(needTr).map(p => ({ n: p.name }))).then(ch => { if (ch && my === seq && res.isConnected) draw(); }).catch(() => {});
        for (const ch of ['tivtaam', 'keshet']) { const bs = list.filter(p => baseChain(p.deal?.chain) === ch).map(p => p.barcode); if (bs.length) loadStoraiIds(ch, bs).then(got => { if (got && my === seq && res.isConnected) draw(); }).catch(() => {}); }
        const ys = list.filter(p => baseChain(p.deal?.chain) === 'yango').map(p => p.barcode); if (ys.length) loadYangoSlugs(ys).then(got => { if (got && my === seq && res.isConnected) draw(); }).catch(() => {});
        // Виктори: адрес страницы строится из названия в её собственном прайсе
        const vs = list.filter(p => baseChain(p.deal?.chain) === 'victory').map(p => p.barcode); if (vs.length) loadChainNames('victory', vs).then(got => { if (got && my === seq && res.isConnected) draw(); }).catch(() => {});
      } catch (e) { if (my === seq) res.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
    // баннеры: две самые большие скидки в разных сетях
    rpc('g_deals_cat', { p_sort: 'pct', p_limit: 60, p_offset: 0, p_grp: app.ui.dealCat || null, p_chains: dealChains() }).then(xs => {
      const seen = new Set(), food = xs.filter(p => p.grp && p.grp !== 'grp_household'); // в баннеры — продукты, а не салфетки
      top = (food.length >= 5 ? food : xs).filter(p => !seen.has(p.deal.chain) && seen.add(p.deal.chain)).slice(0, 5);
      if (top.length < 5) top = [...top, ...food.filter(p => !top.includes(p))].slice(0, 5); // сетей меньше пяти — добираем следующими
      const paint = () => { if (res.isConnected && list.length) draw(); else bans.innerHTML = top.map(dealBanner).join(''); };
      paint();
      // баннеры приходят позже списка — их названия переводим отдельно
      loadNameTr(top.filter(needTr).map(p => ({ n: p.name }))).then(ch => ch && paint()).catch(() => {});
      for (const ch of ['tivtaam', 'keshet']) { const bs = top.filter(p => baseChain(p.deal?.chain) === ch).map(p => p.barcode); if (bs.length) loadStoraiIds(ch, bs).catch(() => {}); }
    }).catch(() => {});
    $('#dsort', view).onchange = e => { app.ui.dealSort = e.target.value; res.innerHTML = '<p class="mu"><span class="spin"></span> Загружаем…</p>'; load(); };
    const dcat = $('#dcat', view); catBtnSync(dcat, app.ui.dealCat);
    $('#dch', view).onclick = () => chainPickSheet(null, dealChain(), v => { app.ui.dealChain = v; render(); }, DEAL_CHAINS);
    // в акциях нет раздела «личная гигиена» — косметику туда не берём
    dcat.onclick = () => catSheet(app.ui.dealCat || null, ['grp_personal_care'], v => { app.ui.dealCat = v; render(); });
    // крутилка баннеров: тени и стрелки показывают, что есть ещё слева/справа
    const bw = $('.dl-bansw', view), bedge = () => { const sl = Math.abs(bans.scrollLeft), rest = bans.scrollWidth - bans.clientWidth - sl; bw.classList.toggle('has-more', rest > 8); bw.classList.toggle('has-less', sl > 8); };
    bans.addEventListener('scroll', bedge, { passive: true }); addEventListener('resize', bedge);
    new MutationObserver(() => requestAnimationFrame(bedge)).observe(bans, { childList: true });
    const step = () => (bans.firstElementChild?.offsetWidth || bans.clientWidth) + 12;
    $('.dl-next', view).onclick = () => bans.scrollBy({ left: RTLX * step(), behavior: 'smooth' });
    $('.dl-prev', view).onclick = () => bans.scrollBy({ left: -RTLX * step(), behavior: 'smooth' });
    const dq = $('#dq', view);
    dq.oninput = () => { app.ui.dq = dq.value; debounce('dsearch', 350, () => { if (dq.value.trim().length === 1) return; res.innerHTML = '<p class="mu"><span class="spin"></span> Ищем…</p>'; load(); }); };
    load(); drawBar();
  },
});

// ---------- список текстом → конкретные товары ----------
function parseLine(s) {
  const t = s.replace(/[•·\-–—*]+/g, ' ').trim(); if (!t) return null;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(кг|г|гр|л|мл|шт|уп)?\.?\s*$/i) || t.match(/^(\d+(?:[.,]\d+)?)\s*(кг|г|гр|л|мл|шт|уп)?\.?\s+/i);
  const n = m ? Number(m[1].replace(',', '.')) : null, u = m?.[2]?.toLowerCase() || null;
  const name = (m ? t.replace(m[0], ' ') : t).replace(/\s+/g, ' ').trim();
  return name.length >= 2 ? { raw: s.trim(), name, n, u } : null;
}
// сколько брать: вес — в кг для развесного или в упаковках; «яйца 12» при упаковке 12 шт — одна упаковка
function lineQty(l, p) {
  if (!l.n) return { qty: 1, kg: p.is_weighted ? 1 : undefined };
  const grams = l.u === 'кг' || l.u === 'л' ? l.n * 1000 : l.u === 'г' || l.u === 'гр' || l.u === 'мл' ? l.n : null;
  if (p.is_weighted) return { qty: 1, kg: grams != null ? grams / 1000 : (l.u === 'шт' ? Math.max(0.2, l.n * 0.15) : l.n) };
  if (grams != null && p.pack_amount && (p.pack_kind === 'г' || p.pack_kind === 'мл')) return { qty: Math.max(1, Math.ceil(grams / p.pack_amount - 0.05)) };
  if (p.pack_kind === 'шт' && p.pack_amount > 1 && l.n >= p.pack_amount) return { qty: Math.ceil(l.n / p.pack_amount - 0.05) };
  return { qty: Math.max(1, Math.round(l.n)) };
}
function textSheet(c) {
  sheet('Список покупок', `<textarea class="inp" id="tl" rows="7" placeholder="молоко 3% 2&#10;яйца 12&#10;куриное филе 1 кг&#10;помидоры 1 кг&#10;хлеб"></textarea>
    <p class="mu" style="margin:0;font-size:12px">Ищем в сетях: ${esc(prodChains().map(x => CHAINS[x] || x).join(', '))} (${shopMode() === 'delivery' ? 'с доставкой' : 'в магазине'}).</p>
    <button class="cta w" id="tlGo">Найти товары</button><div id="tlRes"></div>`, (el, close) => {
    $('#tlGo', el).onclick = async () => {
      const lines = $('#tl', el).value.split(/\n|,|;/).map(parseLine).filter(Boolean).slice(0, 60);
      if (!lines.length) return;
      const box = $('#tlRes', el), btn = $('#tlGo', el); btn.disabled = true;
      box.innerHTML = `<p class="mu"><span class="spin"></span> Ищем ${lines.length} ${plural(lines.length, 'товар', 'товара', 'товаров')}…</p>`;
      const out = [];
      for (let k = 0; k < lines.length; k += 5) {
        const part = lines.slice(k, k + 5);
        const rs = await Promise.all(part.map(l => searchProducts(l.name, 5).catch(() => [])));
        part.forEach((l, j) => out.push({ l, opts: rs[j] || [], pick: 0 }));
      }
      await loadNameTr(out.flatMap(x => x.opts).filter(needTr).map(p => ({ n: p.name }))).catch(() => {});
      btn.disabled = false;
      const nm = pName;
      const minp = p => Math.min(...Object.values(p.prices || {}).map(Number));
      box.innerHTML = `<div class="rlist">${out.map((x, k) => `<div class="tlr"><input type="checkbox" data-k="${k}" ${x.opts.length ? 'checked' : 'disabled'}>
          <span class="oi"><b>${esc(x.l.raw)}</b>${x.opts.length ? `<select class="inp tl-sel" data-s="${k}">${x.opts.map((p, i) => `<option value="${i}">${esc(nm(p))}${p.pack_amount ? ' · ' + esc(packLabel(p.pack_amount, p.pack_kind)) : ''} · от ${money(minp(p), 1)}</option>`).join('')}</select>` : `<span>не нашли — добавьте через «Найти товары»</span>`}</span></div>`).join('')}</div>
        ${out.some(x => x.opts.length) ? `<button class="cta w" id="tlAdd">Добавить в корзину</button>` : ''}`;
      $$('[data-s]', box).forEach(sl => sl.onchange = () => { out[+sl.dataset.s].pick = +sl.value; });
      const add = $('#tlAdd', box); if (add) add.onclick = () => {
        const pick = $$('[data-k]', box).filter(i => i.checked).map(i => out[+i.dataset.k]).filter(x => x.opts.length)
          .map(x => { const p = x.opts[x.pick], q = lineQty(x.l, p); return itemFromProduct(p, q.qty, q.kg); });
        addItems(c, pick); close(); render(); toast(`Добавили ${pick.length} ${plural(pick.length, 'товар', 'товара', 'товаров')}`);
      };
    };
  });
}

// ---------- чек ----------
// фото → куда добавить (новая корзина или существующая) → распознаём → проверка строк → в корзину
function pickReceipt(target) {
  // input в документе: на телефоне откроется системный выбор «Камера / Фото» (без capture — можно и из галереи)
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(inp);
  inp.onchange = () => { const f = inp.files?.[0]; inp.remove(); if (!f) return; target ? readReceiptInto(f, target) : askReceiptTarget(f); };
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
  return `<div class="hd"><div><div class="sub">${esc([CHAINS[r.chain] || 'Сеть не определена', r.date ? new Date(r.date).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }) : '', r.total ? money(r.total, 1) : ''].filter(Boolean).join(' · '))}</div>
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
    // новое меню — всегда отдельное (текущее уходит в «Мои меню»), даже на ту же дату или неделю
    $$('[data-n]', el).forEach(b => b.onclick = () => { close(); archiveMenu(); app.menu = null; LS.set('sali.menu', null); startPlan(b.dataset.n); });
    $$('[data-nc]', el).forEach(b => b.addEventListener('click', close, true));
    bindNewCart(el, null);
  });
}
document.addEventListener('click', e => { if (e.target.closest('[data-new]')) { e.preventDefault(); newSheet(); } });


// ---------- Меню: мои меню (лента) + планы питания ----------
// планы питания — готовые меню на неделю из библиотеки рецептов, ни к кому не привязаны (таблица meal_plans);
// «взять себе» = копия плана становится обычным меню пользователя на выбранную неделю
let mealPlansP = null;
function loadMealPlans() {
  return mealPlansP ||= fetch(`${REST}meal_plans?select=slug,title,subtitle,description,tags,meals,pics,plan&order=sort`, { headers: { apikey: KEY } })
    .then(r => { if (!r.ok) throw new Error('meal_plans ' + r.status); return r.json(); })
    .catch(e => { mealPlansP = null; throw e; });
}
// обложка: блюда в кружках-тарелках на цветном фоне (вместо сетки из фото со столами)
const PLATE_BG = ['#F6E6CC', '#E2EFE5', '#F4E0D8', '#E4E8F4', '#EFE8D2', '#E3EFF0'];
const plateBg = key => PLATE_BG[[...String(key || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % PLATE_BG.length];
function collage(pics, cls = 'mp-pic', key = '', more = 0) {
  const p = pics.filter(Boolean).slice(0, 3);
  return `<span class="plates ${cls}" style="--bg:${plateBg(key || p[0])}">${p.map((u, i) => `<span class="pl pl${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></span>`).join('')}${!p.length ? `<span class="pl pl1 pl-empty">${ico('menu', 30, '#137A4B')}</span>` : ''}${more > 0 ? `<span class="pl-more">+${more}</span>` : ''}</span>`;
}
const planSlots = pl => pl.plan.days.flatMap(d => d.meals || []);
function menuPics(m) { return (m.plan?.dishes || []).map(d => d.recipe_id && m.images?.[d.recipe_id]?.thumb).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4); }
function myMenuCard(m) {
  const cur = m === app.menu, ws = m.weekStart, now = weekStartFor('this'), nd = m.plan?.dishes?.length || 0;
  const when = ws === now ? 'эта неделя' : ws === weekStartFor('next') ? 'следующая неделя' : ws < now ? 'прошлое' : '';
  return `<a class="mm" href="#" data-ml="${m.lid}">${collage(menuPics(m), 'mm-pic', m.lid)}
    <span class="mm-tx"><b>${esc(m.fromPlanTitle || `Меню${m.num ? ' ' + m.num : ''}`)}</b><span>${esc(weekLabel(ws))}</span><span class="mu">${nd} ${plural(nd, 'блюдо', 'блюда', 'блюд')}${when ? ' · ' + when : ''}</span></span>
    ${cur ? '<em class="mm-on">открыто</em>' : ''}</a>`;
}
function planCard(pl) {
  const n = pl.plan.dishes.length;
  return `<a class="mp" href="#/plan/${esc(pl.slug)}">${collage(pl.pics || [], 'mp-pic', pl.slug, n - 3)}
    <span class="mp-tx"><b>${esc(pl.title)}</b><span>${esc(pl.subtitle || '')}</span>
    <span class="mp-tags">${(pl.tags || []).map(t => `<i>${esc(t)}</i>`).join('')}</span>
    <span class="mu" style="font-size:12px">${n} ${plural(n, 'блюдо', 'блюда', 'блюд')} · ${pl.meals.map(x => MEAL_SHORT[x] || x).join(', ')}</span></span></a>`;
}
route(/^#\/menu$/, () => {
  const loc = [app.menu, ...app.menus].filter(Boolean).map(ensureLid).sort((a, b) => (b.weekStart || '').localeCompare(a.weekStart || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
  return `<div class="hd"><div><div class="sub">Меню на неделю</div><h1 class="h">Меню</h1></div></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:12px;padding-top:6px">
      <div class="sec-h">Мои меню${loc.length ? `<small>${loc.length}</small>` : ''}</div>
      <div class="mm-row" id="mmRow">
        <button class="mm mm-add" id="mmAdd" aria-label="Новое меню"><span class="mm-plus">${ico('plus', 30, '#137A4B')}</span><b>Новое меню</b></button>
        ${loc.map(myMenuCard).join('')}<span id="mmCloud" style="display:contents"></span>
      </div>
      ${!app.user && loc.length ? `<p class="mu" style="margin:-4px 0 0;font-size:13px">Меню хранятся на этом устройстве. <a href="#" id="lg" class="linkb">Войдите</a> — будут на всех.</p>` : ''}
      <div class="sec-h" style="margin-top:10px" id="plansH">Планы питания</div>
      <p class="mu" style="margin:-6px 0 0">Готовые меню на неделю: возьмите себе на нужную неделю — блюда потом можно менять, корзину и цены посчитаем.</p>
      <div class="mp-grid" id="mpList"><p class="mu"><span class="spin"></span> Загружаем…</p></div>
    </div>`;
}, {
  tab: 'menu',
  async after(view) {
    const lg = $('#lg', view); if (lg) lg.onclick = e => { e.preventDefault(); login('#/menu'); };
    $('#mmAdd', view).onclick = () => sheet('Новое меню', `
      <button class="op" data-n="week"><span class="bk-ic">${ico('cal', 24, '#137A4B')}</span><span class="oi"><b>Собрать под нас на неделю</b><span>Учтём, сколько вас, что любите и сколько времени</span></span></button>
      <button class="op" data-n="today"><span class="bk-ic">${ico('menu', 24, '#137A4B')}</span><span class="oi"><b>Меню на сегодня</b><span>Блюда на сегодня с рецептами и корзиной</span></span></button>
      <button class="op" data-pl><span class="bk-ic">${ico('book', 24, '#137A4B')}</span><span class="oi"><b>Взять готовый план</b><span>Планы питания на неделю — ниже на этой странице</span></span></button>`, (el, close) => {
      $$('[data-n]', el).forEach(b => b.onclick = () => { close(); archiveMenu(); app.menu = null; LS.set('sali.menu', null); startPlan(b.dataset.n); });
      el.querySelector('[data-pl]').onclick = () => { close(); $('#plansH')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    });
    const bind = () => {
      $$('[data-ml]', view).forEach(a => a.onclick = e => { e.preventDefault(); const lid = a.dataset.ml; if (app.menu?.lid === lid) return go('#/today'); if (takeMenu(lid)) { renderChrome(); go('#/today'); } });
      $$('[data-cm]', view).forEach(a => a.onclick = e => { e.preventDefault(); openMenu(a.dataset.cm); });
    };
    bind();
    // картинок у меню может ещё не быть (собрано давно) — подтянем у открытого
    if (app.menu && !menuPics(app.menu).length) refreshImages().then(() => { const c = $(`[data-ml="${app.menu?.lid}"] .mm-pic`, view); if (c) c.outerHTML = collage(menuPics(app.menu), 'mm-pic', app.menu.lid); }).catch(() => {});
    loadMealPlans().then(list => { const box = $('#mpList', view); if (box) box.innerHTML = list.map(planCard).join('') || '<p class="mu">Планов пока нет.</p>'; })
      .catch(e => { const box = $('#mpList', view); if (box) box.innerHTML = `<div class="err">Не загрузилось: ${esc(e.message)}</div>`; });
    if (!app.user) return;
    // меню из аккаунта, которых нет на этом устройстве
    try {
      const { data } = await sb.from('user_menus').select('id,title,updated_at,ws:state->>weekStart,img:state->images,n:state->plan->dishes').order('updated_at', { ascending: false }).limit(30);
      const have = new Set([app.menu, ...app.menus].filter(Boolean).map(m => m.savedId).filter(Boolean));
      const box = $('#mmCloud', view); if (!box || !data) return;
      box.innerHTML = data.filter(m => !have.has(m.id) && m.ws).map(m => {
        const pics = [...new Set(Object.values(m.img || {}).map(x => x.thumb).filter(Boolean))].slice(0, 4), n = (m.n || []).length;
        return `<a class="mm" href="#" data-cm="${m.id}">${collage(pics, 'mm-pic', m.id)}<span class="mm-tx"><b>${esc((m.title || 'Меню').split(' · ')[0])}</b><span>${esc(weekLabel(m.ws))}</span><span class="mu">${n} ${plural(n, 'блюдо', 'блюда', 'блюд')} · в аккаунте</span></span></a>`;
      }).join('');
      bind();
    } catch (e) { console.warn(e); }
  },
});

// план питания: по дням, «Взять себе»
route(/^#\/plan\/([\w-]+)$/, () => `<p class="pad mu" style="padding-top:20px"><span class="spin"></span> Загружаем план…</p>`, {
  tab: 'menu',
  async after(view, slug) {
    let pl;
    try { pl = (await loadMealPlans()).find(x => x.slug === slug); } catch (e) { view.innerHTML = `<div class="pad"><div class="err">Не загрузилось: ${esc(e.message)}</div></div>`; return; }
    if (!pl) { view.innerHTML = `<div class="pad"><p class="mu">Такого плана нет.</p><a class="cta" href="#/menu">Ко всем меню</a></div>`; return; }
    const dish = id => pl.plan.dishes.find(d => d.id === id);
    const imgs = {};
    const render2 = () => {
      const cookN = pl.plan.dishes.length, mins = Math.round(pl.plan.dishes.reduce((a, d) => a + (d.cook_minutes || 0), 0) / Math.max(1, cookN));
      view.innerHTML = `<div class="hd"><div><div class="sub">План питания · 7 дней</div><h1 class="h">${esc(pl.title)}</h1></div><button class="ib" onclick="history.length > 1 ? history.back() : go('#/menu')" aria-label="Назад">${ico('back')}</button></div>
        <div class="pad" style="display:flex;flex-direction:column;gap:14px;padding-top:6px">
          ${collage(pl.pics || [], 'mp-pic mp-hero', pl.slug, pl.plan.dishes.length - 3)}
          <p style="margin:0">${esc(pl.description || '')}</p>
          <div class="mp-tags">${(pl.tags || []).map(t => `<i>${esc(t)}</i>`).join('')}</div>
          <div class="row2"><div class="fact"><span>Блюд</span><b>${cookN}</b></div><div class="fact"><span>В среднем готовить</span><b>${mins} мин</b></div></div>
          <button class="cta w" id="take">Взять себе</button>
          ${pl.plan.days.map((d, i) => `<div class="pd"><div class="pd-h">${esc(DAYS_FULL[i][0].toUpperCase() + DAYS_FULL[i].slice(1))}</div>
            ${(d.meals || []).map(s => { const x = dish(s.dish_id); if (!x) return ''; const im = imgs[x.recipe_id];
              return `<a class="pd-r" href="#/r/${x.recipe_id}">${im ? `<img src="${esc(im)}" alt="" loading="lazy">` : `<span class="pd-t" style="background:${MEAL_COLOR[s.meal] || '#7A6A50'}">${esc(x.name[0])}</span>`}
                <span class="pd-tx"><span class="mu">${esc(MEAL_SHORT[s.meal] || s.meal)}${s.leftovers ? ' · остатки' : ''}</span><b>${esc(x.name)}</b></span></a>`; }).join('')}</div>`).join('')}
          <button class="cta w" id="take2" style="margin-bottom:20px">Взять себе</button>
        </div>`;
      $('#take', view).onclick = $('#take2', view).onclick = () => takePlanSheet(pl);
    };
    render2();
    try {
      const rows = await rpc('menu_images', { p_ids: [...new Set(pl.plan.dishes.map(d => d.recipe_id))] });
      for (const r of rows) if (r.thumb_url) imgs[r.id] = r.thumb_url;
      if (location.hash === '#/plan/' + slug) render2();
    } catch (e) { console.warn(e); }
  },
});

// на какую неделю взять план
function takePlanSheet(pl) {
  const ws = [weekStartFor('this'), weekStartFor('next')];
  sheet('На какую неделю?', `
    <button class="op" data-ws="${ws[0]}"><span class="bk-ic">${ico('cal', 24, '#137A4B')}</span><span class="oi"><b>Эта неделя</b><span>${esc(weekLabel(ws[0]))}</span></span></button>
    <button class="op" data-ws="${ws[1]}"><span class="bk-ic">${ico('cal', 24, '#137A4B')}</span><span class="oi"><b>Следующая неделя</b><span>${esc(weekLabel(ws[1]))}</span></span></button>
    <label class="lbl">Или с другой недели — выберите любой день<input class="inp" type="date" id="pwd" min="${ws[0]}"></label>
    <p class="mu" style="margin:0;font-size:13px">Порции посчитаем на ${eaters()} ${plural(eaters(), 'человека', 'человек', 'человек')} — как в настройках меню. Текущее меню останется в «Мои меню».</p>`, (el, close) => {
    $$('[data-ws]', el).forEach(b => b.onclick = () => { close(); applyPlan(pl, b.dataset.ws); });
    const d = $('#pwd', el); d.onchange = () => { if (!d.value) return; const t = new Date(d.value + 'T12:00:00'); t.setDate(t.getDate() - t.getDay()); close(); applyPlan(pl, isoDate(t)); };
  });
}
// копия плана → обычное меню пользователя: рецепты из библиотеки (без модели), картинки, цены
async function applyPlan(pl, weekStart) {
  const p = JSON.parse(JSON.stringify(app.profile));
  for (const meal of MEAL_ORDER) {
    const days = pl.plan.days.map((d, i) => (d.meals || []).some(s => s.meal === meal) ? i : -1).filter(i => i >= 0);
    p.meals[meal] = { ...(p.meals[meal] || {}), on: days.length > 0, days };
  }
  const plan = JSON.parse(JSON.stringify(pl.plan));
  const slots = plan.days.flatMap(d => d.meals || []);
  // порции: на всех едоков (коробочки — на детей), а блюдо «на два дня» — сразу на оба дня
  for (const d of plan.dishes) {
    const mine = slots.filter(s => s.dish_id === d.id), cooks = Math.max(1, mine.filter(s => !s.leftovers).length);
    const per = mine.some(s => s.meal === 'в школу') ? boxes(p) : eaters(p);
    d.portions = Math.max(1, Math.round(per * mine.length / cooks));
  }
  const b = app.build = { step: 1, done: 0, total: plan.dishes.length, error: null, msg: `План «${pl.title}» · ${plan.dishes.length} ${plural(plan.dishes.length, 'блюдо', 'блюда', 'блюд')}`, scope: 'week' };
  go('#/building');
  const upd = () => { if (location.hash === '#/building') render(); };
  try {
    const params = toParams(p);
    const m = { v: 1, createdAt: Date.now(), weekStart, profile: p, params, plan, recipes: {}, images: {}, have: {}, chain: p.chain || '', fromPlan: pl.slug, fromPlanTitle: pl.title };
    fixSideRuns(m);
    for (let i = 0; i < plan.dishes.length; i += 20) {
      const r = await fn('menu', { action: 'recipes', params, dishes: plan.dishes.slice(i, i + 20) });
      for (const x of r.result.recipes || []) m.recipes[x.dish_id] = x;
      b.done = Object.keys(m.recipes).length; upd();
    }
    archiveMenu(); app.menu = ensureLid(m); app.ui.day = null;
    b.step = 2; upd();
    await refreshImages();
    try { await refreshPrices(); } catch (e) { console.warn('prices', e); }
    b.step = 4; saveMenu(); app.build = null;
    go('#/today');
    toast(`План «${pl.title}» — ваше меню на ${weekLabel(weekStart)}`);
  } catch (e) { b.error = e.message || String(e); upd(); }
}


// ---------- подписки: скидки на корзину, акции на товар ----------
// хранятся в user_subs (нужен вход); раз в день сервер (subs-check) пересчитывает корзины по сетям и смотрит акции
const SUB_DEF = { pct_on: true, pct: 10, ils_on: true, ils: 50, deals_on: true, deals: 3 };
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function loadSubs() {
  if (!app.user) return Promise.resolve([]);
  return sb.from('user_subs').select('*').order('created_at', { ascending: false }).then(({ data, error }) => { if (error) throw error; app.subs = data || []; return app.subs; });
}
const subFor = (kind, ref) => ref && (app.subs || []).find(x => x.kind === kind && x.ref === String(ref)) || null;
// пуш: разрешение, подписка браузера, сохранить в push_subs
async function ensurePush() {
  if (!pushOk()) throw new Error('Этот браузер не умеет пуш-уведомления — установите Sali как приложение');
  if (Notification.permission === 'denied') throw new Error('Уведомления запрещены в настройках браузера для Sali');
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new Error('Без разрешения на уведомления пуши не придут');
  const reg = await navigator.serviceWorker.ready;
  let ps = await reg.pushManager.getSubscription();
  if (!ps) {
    const { vapid } = await fetch(FN + 'subs-check?vapid=1').then(r => r.json());
    const raw = atob(vapid.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - vapid.length % 4) % 4));
    ps = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
  }
  const j = ps.toJSON();
  const { error } = await sb.from('push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
  if (error) throw error;
}
async function subCart(c) {
  if (!app.user) return askLogin('Подписка на корзину', 'Подписки хранятся в аккаунте — войдите через Google, и мы будем следить за ценами каждый день.', location.hash);
  if (!c.savedId) { await cloudSaveCart(c); if (!c.savedId) return toast('Корзина ещё не сохранилась в аккаунт — попробуйте через минуту'); }
  subSheet({ kind: 'cart', ref: c.savedId, title: c.title });
}
async function subSheet({ kind, ref, title }) {
  if (!app.user) return askLogin(kind === 'cart' ? 'Подписка на корзину' : 'Подписка на товар', 'Подписки хранятся в аккаунте — войдите через Google.', location.hash);
  if (!app.subs) { try { await loadSubs(); } catch (e) { return toast('Не загрузилось: ' + e.message); } }
  const ex = subFor(kind, ref), cd = { ...SUB_DEF, ...(ex?.cond || {}) };
  const email = app.user.email || '';
  const rng = (k, min, max, step, lab) => `<div class="sub-c"><label class="gen-ck"><input type="checkbox" class="chk" data-on="${k}" ${cd[k + '_on'] ? 'checked' : ''}><span>${lab(`<b data-v="${k}">${cd[k]}</b>`)}</span></label>
    <input type="range" class="sub-r" data-r="${k}" min="${min}" max="${max}" step="${step}" value="${cd[k]}"></div>`;
  sheet(ex ? 'Подписка' : kind === 'cart' ? 'Подписаться на корзину' : 'Подписаться на товар', `
    <p class="mu" style="margin:0">«${esc(title)}»</p>
    <div class="sec-h" style="margin-top:4px">Уведомить меня</div>
    <label class="gen-ck"><input type="checkbox" class="chk" id="chE" ${ex ? (ex.email ? 'checked' : '') : 'checked'}><span>По электронной почте${email ? ` <span class="mu">· ${esc(email)}</span>` : ''}</span></label>
    ${pushOk() ? `<label class="gen-ck"><input type="checkbox" class="chk" id="chP" ${ex?.push || (!ex && matchMedia('(display-mode: standalone)').matches) ? 'checked' : ''}><span>Пуш-уведомлением на этом устройстве</span></label>`
      : `<p class="mu" style="margin:0;font-size:13px">Пуш-уведомления — в установленном приложении Sali.</p>`}
    ${kind === 'cart' ? `<div class="sec-h" style="margin-top:4px">Когда</div>
      ${rng('pct', 5, 50, 5, v => `Корзина подешевела на ${v}% и больше`)}
      ${rng('ils', 10, 300, 10, v => `Корзина подешевела на ${v} ₪ и больше`)}
      ${rng('deals', 1, 10, 1, v => `Акции на ${v} и более товаров в корзине или их аналоги`)}
      <p class="mu" style="margin:0;font-size:12px">Каждое утро пересчитываем корзину во всех сетях (${shopMode() === 'store' ? 'цены в магазине' : 'с доставкой'}) и сравниваем с сегодняшней ценой.</p>`
      : `<p style="margin:0">…если на этот товар будет акция в одной из сетей.</p>`}
    <button class="cta w" id="subOk">${ex ? 'Сохранить' : 'Подписаться'}</button>
    ${ex ? `<button class="ghost w" id="subDel">Отписаться</button>` : ''}
    <button class="linkb" id="subTest" style="align-self:center">Прислать тестовое уведомление</button>`, (el, close) => {
    $$('[data-r]', el).forEach(r => r.oninput = () => { cd[r.dataset.r] = +r.value; $(`[data-v="${r.dataset.r}"]`, el).textContent = r.value; const on = $(`[data-on="${r.dataset.r}"]`, el); on.checked = true; });
    const chans = () => ({ email: $('#chE', el).checked, push: !!$('#chP', el)?.checked });
    const prepPush = async ch => { if (ch.push) await ensurePush(); };
    $('#subOk', el).onclick = async () => {
      const ch = chans();
      if (!ch.email && !ch.push) return toast('Выберите, как уведомлять');
      const cond = kind === 'cart' ? Object.fromEntries(['pct', 'ils', 'deals'].flatMap(k => [[k + '_on', $(`[data-on="${k}"]`, el).checked], [k, cd[k]]])) : {};
      if (kind === 'cart') { if (!cond.pct_on && !cond.ils_on && !cond.deals_on) return toast('Отметьте хотя бы одно условие'); cond.shop = shopMode(); }
      const b = $('#subOk', el); b.disabled = true;
      try {
        await prepPush(ch);
        const row = { kind, ref: String(ref), title, email: ch.email, push: ch.push, cond, active: true, updated_at: new Date().toISOString() };
        const { error } = ex ? await sb.from('user_subs').update(row).eq('id', ex.id) : await sb.from('user_subs').insert(row);
        if (error) throw error;
        await loadSubs(); close(); render();
        toast(ex ? 'Подписка сохранена' : 'Подписались — сообщим, когда станет дешевле');
        if (!ex) fn('subs-check', { action: 'init' }, true).catch(e => console.warn('subs init', e));
      } catch (e) { b.disabled = false; toast(e.message); }
    };
    const dl = $('#subDel', el); if (dl) dl.onclick = async () => {
      const { error } = await sb.from('user_subs').delete().eq('id', ex.id);
      if (error) return toast('Не получилось: ' + error.message);
      await loadSubs(); close(); render(); toast('Отписались');
    };
    $('#subTest', el).onclick = async () => {
      const ch = chans(); if (!ch.email && !ch.push) return toast('Выберите, как уведомлять');
      try { await prepPush(ch); const r = await fn('subs-check', { action: 'test', ...ch }, true); toast(r.sent?.length ? 'Отправили: ' + r.sent.map(x => x === 'push' ? 'пуш' : 'письмо').join(' и ') : 'Не отправилось — почта ещё не подключена'); }
      catch (e) { toast(e.message); }
    };
  });
}
// «Мои подписки»
route(/^#\/subs$/, () => `<div class="hd"><div><div class="sub">Скидки на корзины и товары</div><h1 class="h">Мои подписки</h1></div></div>
  <div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-top:10px" id="subsBox"><p class="mu"><span class="spin"></span> Загружаем…</p></div>`, {
  async after(view) {
    const box = $('#subsBox', view);
    if (!app.user) { box.innerHTML = `<div class="card"><b>Подписки хранятся в аккаунте</b><span class="mu">Подпишитесь на корзину или товар — каждое утро проверим цены и акции во всех сетях и сообщим, когда станет дешевле.</span><button class="gbtn" id="lg">${IC.google}Войти через Google</button></div>`; $('#lg', box).onclick = () => login('#/subs'); return; }
    let subs, log = [];
    try { subs = await loadSubs(); ({ data: log } = await sb.from('notify_log').select('title,body,url,channel,ok,sent_at').eq('ok', true).order('sent_at', { ascending: false }).limit(10)); }
    catch (e) { box.innerHTML = `<div class="err">Не загрузилось: ${esc(e.message)}</div>`; return; }
    const condText = x => x.kind === 'product' ? 'акция в любой сети' : [x.cond.pct_on && `дешевле на ${x.cond.pct}%`, x.cond.ils_on && `дешевле на ${x.cond.ils} ₪`, x.cond.deals_on && `акции на ${x.cond.deals}+ товаров`].filter(Boolean).join(' · ');
    const chText = x => [x.email && 'почта', x.push && 'пуш'].filter(Boolean).join(' и ');
    box.innerHTML = (subs.length ? subs.map((x, k) => `<button class="op" data-sk="${k}"><span class="bk-ic">${ico(x.kind === 'cart' ? 'cart' : 'tag', 24, '#137A4B')}</span>
        <span class="oi"><b>${esc(x.title || '')}</b><span>${x.kind === 'cart' ? 'Корзина' : 'Товар'} · ${esc(condText(x))}</span><span>${esc(chText(x))}${x.base?.sum ? ` · было ${moneyR(x.base.sum)}` : ''}</span></span>${ico('bell', 20, '#137A4B')}</button>`).join('')
      : `<p class="mu" style="margin:0">Подписок пока нет. Подпишитесь на корзину (кнопка «Подписаться на корзину» в корзине) или на товар — в карточке товара.</p><a class="cta" href="#/baskets">К корзинам</a>`)
      + (log?.length ? `<div class="sec-h" style="margin-top:12px">Последние уведомления</div>` + log.map(l => `<a class="op" href="${esc(l.url || '#/subs')}"><span class="oi"><b>${esc(l.title)}</b><span style="white-space:pre-line">${esc(l.body || '')}</span><span>${new Date(l.sent_at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' })} · ${l.channel === 'push' ? 'пуш' : 'письмо'}</span></span></a>`).join('') : '');
    $$('[data-sk]', box).forEach(b => b.onclick = () => { const x = subs[+b.dataset.sk]; subSheet({ kind: x.kind, ref: x.ref, title: x.title }); });
  },
});

// запуск — последним, когда все экраны уже объявлены
boot();
