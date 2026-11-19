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
const packLabel = (a, k) => a ? `${amt(a >= 1000 && (k === 'г' || k === 'мл') ? a / 1000 : a)} ${a >= 1000 && k === 'г' ? 'кг' : a >= 1000 && k === 'мл' ? 'л' : k || ''}` : '';
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
route(/^#\/baskets$/, () => {
  const m = app.menu;
  const menuCard = m?.plan?.dishes?.length && !cartForMenu(m, false) ? `<a class="bk bk-new" href="#/basket"><span class="bk-ic">${ico('menu', 24, '#137A4B')}</span>
      <span class="oi"><b>Собрать корзину из меню</b><span>${esc(menuTitle(m))} · продукты рецептов</span></span>${ico('plus', 22, '#137A4B')}</a>` : '';
  const cards = app.carts.map(c => {
    const best = cartMin(c);
    return `<a class="bk" href="#/cart/${c.id}"><span class="bk-ic">${ico(c.src === 'receipt' ? 'camera' : c.src === 'menu' ? 'menu' : 'cart', 24, '#137A4B')}</span>
      <span class="oi"><b>${esc(c.title)}</b><span>${c.items.length} ${plural(c.items.length, 'товар', 'товара', 'товаров')} · ${new Date(c.updated).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></span>
      ${best ? `<b class="num">от ${moneyR(best.sum)}</b>` : c.items.length ? '<span class="spin" aria-label="Считаем цену"></span>' : ''}<button class="ib bk-del" data-delc="${c.id}" aria-label="Удалить корзину «${esc(c.title)}»">${ico('trash')}</button></a>`;
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
    $$('[data-delc]', view).forEach(b => b.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      const c = cartById(b.dataset.delc); if (!c) return;
      confirmSheet('Удалить корзину?', `«${c.title}» удалится${c.savedId ? ' и из аккаунта' : ''}.`, 'Удалить', async () => { await deleteCart(c); render(); });
    });
    cloudLoadCarts().then(ch => { if (ch && location.hash === '#/baskets') render(); });
    // цены «от» для корзин без свежего сравнения — считаем по очереди и перерисовываем
    (async () => {
      let ch = false;
      for (const c of app.carts.filter(c => c.items.length && !cartMin(c))) {
        if (location.hash !== '#/baskets') return;
        try { await cartCompare(c); ch = true; } catch {}
      }
      if (ch && location.hash === '#/baskets') render();
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
  const rc = (c.receipts || []).map(r => `${CHAINS[r.chain] || 'чек'}${r.date ? ' ' + new Date(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''}${r.total ? ' — ' + money(r.total, 1) : ''}`).join(' · ');
  return `<div class="cc-top"><a class="ib" href="#/baskets" aria-label="Ко всем корзинам">${ico('back')}</a>
      <span style="display:flex;gap:8px"><button class="ib" data-ren aria-label="Переименовать">${ico('pen')}</button><button class="ib" data-del aria-label="Удалить корзину">${ico('trash')}</button></span></div>
    <div class="cc-title"><div class="sub">${n} ${plural(n, 'товар', 'товара', 'товаров')}${rc ? ' · ' + esc(rc) : ''}</div><h1 class="h">${esc(c.title)}</h1>
      ${(mm => c.menuLid ? (mm ? `<div class="cc-menu">Из меню «${esc(menuTitle(mm))}»${menuNeedSig(mm) !== c.menuSig ? ` · <b>меню изменилось</b> <button class="linkb" data-mupd>Обновить корзину</button>` : ''}</div>` : `<div class="cc-menu mu">Меню, из которого собрана корзина, удалено</div>`) : '')(menuByLid(c.menuLid))}</div>
    <div class="pad" style="display:flex;flex-direction:column;gap:12px;padding-top:12px">
      ${n ? `<div class="seg" role="tablist"><button data-shop="delivery" aria-pressed="${shopMode() === 'delivery'}">С доставкой</button><button data-shop="store" aria-pressed="${shopMode() === 'store'}">В магазине</button></div>
      <div class="cc-chipsw"><div class="cc-chips" id="ccChips"><span class="mu"><span class="spin"></span> Сравниваем цены…</span></div><button class="cc-more" type="button" aria-label="Показать другие сети" hidden><span style="display:grid;transform:rotate(180deg)">${ico('back', 18)}</span></button></div>
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
    const dl = $('[data-del]', view); if (dl) dl.onclick = () => confirmSheet('Удалить корзину?', `«${c.title}» удалится${c.savedId ? ' и из аккаунта' : ''}.`, 'Удалить', async () => { await deleteCart(c); go('#/baskets'); });
    const chips = $('#ccChips', view), list = $('#ccList', view), bar = $('#ccBar', view);
    // ряд сетей крутится вбок: справа затухание и кнопка-стрелка, пока есть что листать
    const more = $('.cc-more', view);
    const edge = () => { if (!chips || !more) return; const rest = chips.scrollWidth - chips.clientWidth - chips.scrollLeft; chips.parentNode.classList.toggle('has-more', rest > 8); chips.parentNode.classList.toggle('has-less', chips.scrollLeft > 8); more.hidden = rest <= 8; };
    if (chips && more) { chips.addEventListener('scroll', edge, { passive: true }); addEventListener('resize', edge); more.onclick = () => chips.scrollBy({ left: chips.clientWidth * 0.7, behavior: 'smooth' }); new MutationObserver(() => requestAnimationFrame(edge)).observe(chips, { childList: true }); }
    let d = null, seq = 0;
    const selKey = c.id + ':' + shopMode();
    const draw = () => {
      const rows = d?.chains?.length ? cartRows(d) : [];
      let sel = (app.ui.cartSel ||= {})[selKey];
      if (!rows.some(r => r.chain === sel)) sel = rows[0]?.chain || null; // по умолчанию — самая выгодная одна сеть
      const row = rows.find(r => r.chain === sel) || null, n = c.items.filter(i => !i.have && (i.barcode || i.key)).length;
      if (chips && rows.length) { const top = rows.filter(r => r.chain !== 'yango').sort((a, b) => b.have - a.have || a.sum - b.sum)[0], ord = [...rows.filter(r => r.parts), ...rows.filter(r => !r.parts && r.chain !== 'yango'), ...rows.filter(r => r.chain === 'yango')];
        chips.innerHTML = ord.map(r => `<button class="cc-chip${r.chain === sel ? ' on' : ''}${r.parts ? ' cc-combo' : ''}${r.chain === 'yango' ? ' cc-yango' : ''}" data-cs="${r.chain}"><b>${r.chain === 'yango' ? ico('bolt', 13) + ' ' : ''}${r.parts ? r.parts.length + ' сети' : esc(CHAINS[r.chain] || r.chain)}</b>${r.parts ? `<small>${esc(rowName(r, true))}</small>` : ''}<span>${moneyR(r.sum)}${r.have < n ? ` · ${r.have}/${n}` : ''}${!r.parts && r.chain === modeChain(app.profile.chain) ? ' · ваша' : ''}</span>${r === top ? '<i>дешевле</i>' : r.chain === 'yango' ? '<i class="cc-yi">экспресс</i>' : ''}</button>`).join(''); }
      list.innerHTML = cartListHtml(c, row, sel);
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
        if ((!i.barcode || sl?.how === 'analog') && sl?.barcode && (sl.packs || sl.kg)) {
          // «молоко 3% 2 л» или аналог → товар, который показан в этой сети, целыми упаковками (или на вес): +/− меняет его упаковки, без пересчёта
          before = sl.packs || sl.kg;
          Object.assign(i, { need: i.need || (i.barcode ? undefined : { qty: i.qty, unit: i.unit }), barcode: sl.barcode, he: sl.name, name: trName(sl.name), src: i.src === 'menu' ? 'menu-pick' : i.src });
          delete i.unit; delete i.pack; // размер упаковки старого товара здесь уже не верен
          if (sl.kg && !sl.packs) { i.weighted = true; i.kg = Math.max(0, Math.round((sl.kg + 0.25 * +dd) * 100) / 100); i.qty = 1; after = i.kg; }
          else { i.qty = Math.max(0, (sl.packs || 1) + +dd); delete i.kg; after = i.qty; }
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
      <span class="pic-ic"${i.have ? '' : ` data-var="${i.id}"`} style="width:48px;height:48px;font-size:24px;background:#F4F1EA">${itemPic(i)}</span>
      <span class="oi"${i.have || (!i.barcode && !i.key) ? '' : ` data-var="${i.id}" role="button" tabindex="0" aria-label="Варианты товара «${esc(itemName(i))}»"`}><b dir="auto">${esc(itemName(i))}</b>${(sb => sb.length ? `<span dir="auto">${sb.join(' · ')}</span>` : '')(sub)}
        ${gone ? `<span class="ci-warn">Нет ${row?.parts ? 'ни в одной из сетей' : 'в ' + esc(CHAINS[ch] || ch)}</span>` : ''}</span>
      <b class="num ci-pr">${l ? money(Number(l.cost), 1) : ''}</b>
      <span class="ci-bot">
        <span class="ci-act">${!i.barcode && !i.key ? `<button class="linkb" data-fix="${i.id}">Найти товар</button>` : ''}
          ${u ? `<a class="linkb ci-site" href="${esc(u)}" target="_blank" rel="noopener"${srch && /^(tivtaam|keshet)$/.test(baseChain(lc)) ? ` data-want="${esc(baseChain(lc))}|${esc(l.barcode)}"` : ''}>${ico('link', 14)} ${srch ? 'Найти на сайте' : 'На сайте'}</a>` : ''}
          ${!i.have && (i.barcode || i.key) ? `<button class="linkb" data-var="${i.id}">Другие варианты</button>` : ''}
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
    $('[data-copy]', el).onclick = () => navigator.clipboard.writeText(text).then(() => toast('Корзина скопирована'), () => { $('textarea', el).select(); toast('Выделили — скопируйте'); });
    const s = $('[data-share]', el); if (s) s.onclick = () => navigator.share({ title: c.title, text }).catch(() => {});
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
  return { id: newId('i'), barcode: p.barcode, key: p.ingredient || undefined, he: p.name, name: p.ru || p.name, pack: packLabel(p.pack_amount, p.pack_kind),
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
function prodCard(p, k, c) {
  const nm = p.ru || trName(p.name), pp = prodPrice(p.prices), it = inCart(c, p.barcode);
  const more = prodChain() === 'all' ? Object.keys(p.prices || {}).length - 1 : 0;
  return `<div class="sp">
    <div class="sp-img">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : `<span>${esc(p.icon || '🛒')}</span>`}</div>
    <div class="sp-pr">${pp ? `<b>${money(pp.p, 1)}</b>${p.is_weighted ? '<small> / кг</small>' : ''}` : '<small>нет цены</small>'}</div>
    ${pp && prodChain() === 'all' ? `<div class="sp-ch">${esc(CHAINS[pp.ch] || pp.ch)}${more > 0 ? ` · и ещё в ${more} ${plural(more, 'сети', 'сетях', 'сетях')}` : ''}</div>` : ''}
    <div class="sp-nm" title="${esc(p.name)}">${esc(nm)}</div>
    <div class="sp-pk" dir="auto">${esc([packLabel(p.pack_amount, p.pack_kind), p.name !== nm ? p.name : ''].filter(Boolean).join(' · '))}</div>
    ${it ? `<span class="stp sp-stp" role="group" aria-label="Количество"><button data-pm="${k}.-1" aria-label="Меньше">−</button><b class="num">${esc(it.kg ? amt(it.kg) + ' кг' : it.qty)}</b><button data-pm="${k}.1" aria-label="Больше">+</button></span>`
      : `<button class="sp-add" data-pa="${k}">В корзину</button>`}
  </div>`;
}
const SHOP_HINTS = ['молоко', 'хлеб', 'яйца', 'хумус', 'сыр', 'курица', 'помидоры', 'огурцы', 'бананы', 'йогурт', 'рис', 'макароны', 'кофе', 'шоколад'];
route(/^#\/products(?:\?cart=([\w-]+)(?:&replace=([\w-]+))?)?$/, (cid, rid) => {
  const mode = shopMode(), ch = prodChain();
  const rc = cid && cartById(cid), ri = rid && rc?.items.find(x => x.id === rid);
  return `${ri ? `<div class="cc-repl"><a class="ib" href="#/cart/${rc.id}" aria-label="Назад к корзине">${ico('back')}</a><span>Замена для «<b>${esc(itemName(ri))}</b>» — выберите товар</span></div>` : ''}<div class="shop-top">
      <div class="shop-row"><input class="inp" id="pq" type="search" placeholder="Поиск товаров: хумус, молоко 3%, חלב…" autocomplete="off" value="${esc(app.ui.pq || '')}"></div>
      <div class="shop-row"><div class="seg shop-seg" role="tablist"><button data-shop="delivery" aria-pressed="${mode === 'delivery'}">Доставка</button><button data-shop="store" aria-pressed="${mode === 'store'}">Магазин</button></div>
        <select class="inp shop-sel" id="pch" aria-label="Сеть"><option value="all">Все сети</option>${SHOP[mode].map(x => `<option value="${x}" ${ch === x ? 'selected' : ''}>${esc(CHAINS[x] || x)}</option>`).join('')}${mode === 'delivery' ? `<option value="yango" ${ch === 'yango' ? 'selected' : ''}>⚡ Yango Deli — экспресс</option>` : ''}</select></div>
    </div>
    <div class="pad"><div id="pres"></div></div>
    <a class="shop-bar" id="pbar" hidden></a>`;
}, {
  tab: 'basket',
  after(view, cid, rid) {
    if (cid && cartById(cid)) app.ui.shopCart = cid;
    const q = $('#pq', view), res = $('#pres', view), bar = $('#pbar', view);
    let seq = 0, list = [];
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
      res.innerHTML = `<div class="sgrid">${list.map((p, k) => prodCard(p, k, c)).join('')}</div>`;
      $$('[data-pa]', res).forEach(b => b.onclick = () => put(list[+b.dataset.pa]));
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
    const run = async () => {
      const v = q.value.trim(), my = ++seq; app.ui.pq = v;
      if (v.length < 2) {
        list = [];
        res.innerHTML = `<p class="mu" style="margin:4px 0 10px">Что ищем?</p><div class="chips">${SHOP_HINTS.map(h => `<button type="button" class="pill" data-hint="${h}">${h}</button>`).join('')}</div>`;
        $$('[data-hint]', res).forEach(b => b.onclick = () => { q.value = b.dataset.hint; run(); });
        return;
      }
      if (!list.length) res.innerHTML = `<p class="mu"><span class="spin"></span> Ищем…</p>`;
      try {
        const got = await searchProducts(v, 60);
        if (my !== seq) return;
        list = got;
        if (!list.length) { res.innerHTML = `<p class="mu">Ничего не нашли${prodChain() === 'all' ? '' : ' в ' + esc(CHAINS[prodChain()])}. Попробуйте иначе или на иврите.</p>`; return; }
        draw();
        loadNameTr(list.filter(p => !p.ru).map(p => ({ n: p.name }))).then(ch => { if (ch && my === seq && res.isConnected) draw(); }).catch(() => {});
      } catch (e) { if (my === seq) res.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
    q.oninput = () => debounce('psearch', 300, run);
    $$('[data-shop]', view).forEach(b => b.onclick = () => { app.profile.shop = b.dataset.shop; saveProfile(); render(); });
    $('#pch', view).onchange = e => { (app.profile.prodChain ||= {})[shopMode()] = e.target.value; saveProfile(); list = []; run(); drawBar(); };
    run(); drawBar(); if (!q.value) setTimeout(() => q.focus(), 30);
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
      await loadNameTr(out.flatMap(x => x.opts).filter(p => !p.ru).map(p => ({ n: p.name }))).catch(() => {});
      btn.disabled = false;
      const nm = p => p.ru || trName(p.name);
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
    // новое меню — всегда отдельное (текущее уходит в «Мои меню»), даже на ту же дату или неделю
    $$('[data-n]', el).forEach(b => b.onclick = () => { close(); archiveMenu(); app.menu = null; LS.set('sali.menu', null); startPlan(b.dataset.n); });
    $$('[data-nc]', el).forEach(b => b.addEventListener('click', close, true));
    bindNewCart(el, null);
  });
}
document.addEventListener('click', e => { if (e.target.closest('[data-new]')) { e.preventDefault(); newSheet(); } });

boot();
