/* Sali — корзина, календарь, настройки, рецепты (свои и библиотека), «Мои меню», кабинет. */
'use strict';

// ---------- 9. Корзина недели ----------
// режим покупки: одна сеть (самая выгодная), две сети (каждый продукт — где дешевле), своя сеть
function basketModel() {
  const m = app.menu; if (!m?.basket?.chains?.length) return null;
  const by = Object.fromEntries(m.basket.chains.map(c => [c.chain, c]));
  const sums = chainSums();
  const ok = fullChains(sums).sort(chainRank);
  const best = ok[0], worst = Math.max(...ok.map(withFee));
  let pair = null;
  for (const A of ok.slice(0, 5)) for (const B of sums) {
    if (A === B) continue;
    let total = 0, have = 0; const part = { [A.chain]: 0, [B.chain]: 0 };
    for (const k of buyKeys()) {
      const x = lineIn(by[A.chain], k), y = lineIn(by[B.chain], k);
      if (!x && !y) continue;
      const [ch, l] = !y || (x && x.cost <= y.cost) ? [A.chain, x] : [B.chain, y];
      total += l.cost; part[ch] += l.cost; have++;
    }
    // с доставкой у двух сетей — две доставки и два минимума заказа
    const fee = (delivOf(A.chain)?.fee || 0) + (delivOf(B.chain)?.fee || 0);
    const under = [A.chain, B.chain].some(ch => (delivOf(ch)?.min || 0) > part[ch]);
    if (!under && have >= best.have && Math.min(part[A.chain], part[B.chain]) > 25 && (!pair || total + fee < pair.total + pair.fee)) pair = { a: A.chain, b: B.chain, total, part, fee };
  }
  if (pair && pair.total + pair.fee > withFee(best) - 10) pair = null;
  const mineId = modeChain(m.chain || app.profile.chain), mine = mineId && sums.find(c => c.chain === mineId);
  const mode = m.buyMode === 'two' && pair ? 'two' : m.buyMode === 'mine' && mine ? 'mine' : 'one';
  return { by, sums, best, worst, pair, mine, mode, total: m.basket.chains.length };
}
// строки корзины: все продукты недели; «есть дома» — зачёркнуты, но остаются
function basketLines(bm) {
  const m = app.menu, need = Object.fromEntries(weekNeed().map(e => [e.key, e]));
  return Object.keys(m.basket.qty).map(k => {
    let chain, l;
    if (bm.mode === 'two') {
      const x = lineIn(bm.by[bm.pair.a], k), y = lineIn(bm.by[bm.pair.b], k);
      [chain, l] = !y || (x && x.cost <= y.cost) ? [bm.pair.a, x] : [bm.pair.b, y];
    } else { chain = bm.mode === 'mine' ? bm.mine.chain : bm.best.chain; l = lineIn(bm.by[chain], k); }
    return { key: k, chain, l, d: app.defs[k], e: need[k] || { key: k, qty: m.basket.qty[k], dishes: [] }, off: !!m.have?.[k] };
  });
}
const qtyText = (e, d) => { const u = d?.base_unit || '', q = e.qty; if (!(q > 0)) return 'по вкусу'; return u === 'шт' ? Math.ceil(q) + ' шт' : q >= 1000 ? amt(Math.round(q / 100) / 10) + (u === 'мл' ? ' л' : ' кг') : Math.round(q) + ' ' + u; };
const packText = l => l ? (l.kg ? amt(l.kg) + ' кг' : (l.packs || 1) + ' уп.') : '';
function basketTotal(lines) { return lines.reduce((a, x) => a + (!x.off && x.l ? x.l.cost : 0), 0); }
// доставка — отдельная строка корзины: по одной на каждую сеть, из которой что-то покупаем (только «С доставкой»)
function deliveryLines(lines) { return [...new Set(lines.filter(x => !x.off && x.l).map(x => x.chain))].map(c => ({ chain: c, fee: delivOf(c)?.fee || 0 })).filter(d => d.fee); }
const feesSum = ds => ds.reduce((a, d) => a + d.fee, 0);

route(/^#\/basket(\?.*)?$/, () => {
  const nm = needMenu(); if (nm) return nm;
  const m = app.menu, bm = basketStale(m) ? null : basketModel();
  if (!bm) { if (!timers.bwait) { timers.bwait = 1; refreshPrices().catch(() => new Promise(r => setTimeout(r, 1500)).then(refreshPrices)).then(() => { timers.bwait = 0; render(); }).catch(e => { timers.bwait = 0; toast('Цены не загрузились: ' + e.message); }); } return `${menuHead('Корзина недели')}<p class="pad mu"><span class="spin"></span> Считаем цены в 7 сетях…</p>`; }
  const lines = basketLines(bm), nBuy = lines.filter(x => !x.off).length;
  const feeText = c => (c.short ? ` · <b style="color:#B4441E">до минимального заказа не хватает ${moneyR(c.short)}</b>` : '');
  const opt = (k, title, sub, price, note) => `<button class="opt" aria-pressed="${bm.mode === k}" data-mode="${k}"><span class="rd"></span><span class="oi"><b>${title}</b><span>${sub}</span></span><span class="opp num">${moneyR(price)}${note ? `<small>${note}</small>` : ''}</span></button>`;
  const byCat = {};
  for (const x of lines) (byCat[CAT_ORDER.includes(x.d?.category) ? x.d.category : 'other'] ||= []).push(x);
  for (const c in byCat) byCat[c].sort((a, z) => a.off - z.off);
  const row = x => { const cat = CAT_ORDER.includes(x.d?.category) ? x.d.category : 'other';
    return `<div class="pcard ${x.off ? 'off' : ''}">
      <span class="pic-ic" style="background:${CAT_BG[cat]}" aria-hidden="true">${iconOf(x.key)}</span>
      <div class="pc-tx">
        <b dir="auto">${esc(x.l ? trName(shelfName(x.chain, x.l.barcode, x.l.name)) : (x.d?.name_ru || x.key))}</b>
        ${productMetaHtml(x.chain, x.l)}
        <span>${x.l ? packText(x.l) + ' · ' : ''}${esc(x.d?.name_ru || x.key)}, ${qtyText(x.e, x.d) === 'по вкусу' ? 'по вкусу' : 'нужно ' + qtyText(x.e, x.d)}${bm.mode === 'two' && x.l ? ' · ' + esc(CHAINS[x.chain]) : ''}</span>
        <span class="pc-tags">${x.off ? '<span class="lk gr">есть дома</span>' : ''}${x.l?.deal ? '<span class="lk">акция</span>' : ''}${x.l?.sub ? '<span class="lk y">аналог</span>' : ''}${x.l?.picked ? '<span class="lk b">ваш выбор</span>' : ''}${!x.l && !x.off ? '<span class="lk o">нет в этой сети</span>' : ''}</span>
        <span class="pc-act">${x.off ? `<button class="linkb" data-have="${esc(x.key)}">Вернуть в покупки</button>` : `<button class="linkb" data-swap="${esc(x.key)}" data-chain="${esc(x.chain)}">${ico('swap', 14)} Заменить</button>${(u => u ? `<a class="linkb" href="${esc(u)}" target="_blank" rel="noopener" ${linkIsSearch(x.chain, x.l?.barcode) ? `data-want="${esc(baseChain(x.chain))}:${esc(x.l?.barcode)}"` : ''}>${ico('link', 14)} ${linkIsSearch(x.chain, x.l?.barcode) ? 'Найти на сайте' : 'На сайте'}</a>` : '')(productLink(x.chain, x.l?.barcode, x.l?.kg != null))}<button class="linkb mu-b" data-have="${esc(x.key)}">Есть дома</button>`}</span>
      </div>
      <b class="pc-p num">${x.l ? money(x.l.cost, 1) : '—'}</b></div>`; };
  return `${menuHead('Корзина недели')}
    <div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-top:12px">
      <div class="seg" role="tablist"><button data-shop="delivery" aria-pressed="${shopMode() === 'delivery'}">С доставкой</button><button data-shop="store" aria-pressed="${shopMode() === 'store'}">В магазине</button></div>
      <div class="sec-h">Где купить<small>${allSlots().length} приёмов пищи · ${weekLabel(m.weekStart)}</small></div>
      ${opt('one', `Всё в одной сети — ${esc(CHAINS[bm.best.chain] || bm.best.chain)}`, `${bm.best.have} из ${nBuy} продуктов${feeText(bm.best)}`, withFee(bm.best), bm.worst - withFee(bm.best) > 5 ? '−' + moneyR(bm.worst - withFee(bm.best)) : '')}
      ${bm.pair ? opt('two', 'Дешевле всего — две сети', `${esc(CHAINS[bm.pair.a])} ${moneyR(bm.pair.part[bm.pair.a])} + ${esc(CHAINS[bm.pair.b])} ${moneyR(bm.pair.part[bm.pair.b])}· ещё −${moneyR(withFee(bm.best) - bm.pair.total - bm.pair.fee)}, но два ${shopMode() === 'delivery' ? 'заказа' : 'магазина'}`, bm.pair.total + bm.pair.fee, '') : ''}
      ${bm.mine && bm.mine.chain !== bm.best.chain ? opt('mine', `Ваша сеть — ${esc(CHAINS[bm.mine.chain])}`, `${bm.mine.have} из ${nBuy} продуктов${feeText(bm.mine)}`, withFee(bm.mine), 'как обычно') : ''}
      <label class="lbl">Ваша обычная сеть<select class="inp" id="myChain"><option value="">— не выбрана —</option>${SHOP[shopMode()].map(k => `<option value="${k}" ${modeChain(m.chain || app.profile.chain) === k ? 'selected' : ''}>${CHAINS[k]}</option>`).join('')}</select></label>
      <details><summary class="linkb" style="list-style:none;cursor:pointer">Все ${bm.total} сетей</summary><div style="margin-top:6px">${bm.sums.slice().sort((a, z) => z.have - a.have || chainRank(a, z)).map(c => `<div class="rw"><b>${esc(CHAINS[c.chain] || c.chain)}</b><span class="mu">${c.have}/${nBuy}${c.short ? ' · до минимума ' + moneyR(c.short) : ''}</span><span class="num" style="min-width:70px;text-align:right">${moneyR(withFee(c))}</span></div>`).join('')}</div></details>
      <p class="mu" style="font-size:13px;margin:4px 0 0">«Есть дома» — товар остаётся в списке зачёркнутым и не входит в сумму.</p>
      ${CAT_ORDER.filter(c => byCat[c]).map(c => `<div><div class="cat-h"><span>${CAT_LABEL[c]} · ${byCat[c].filter(x => !x.off).length}</span><span class="num">${money(basketTotal(byCat[c]), 1)}</span></div><div class="pgrid">${byCat[c].map(row).join('')}</div></div>`).join('')}
      ${(ds => ds.length ? `<div><div class="cat-h"><span>Доставка</span><span class="num">${money(feesSum(ds), 1)}</span></div><div class="pgrid">${ds.map(d => `<div class="pcard"><span class="pic-ic" style="background:#EEF1EC" aria-hidden="true">🚚</span><span class="pc-tx"><b>Доставка — ${esc(CHAINS[d.chain] || d.chain)}</b></span><b class="pc-p num">${money(d.fee, 1)}</b></div>`).join('')}</div></div>` : '')(deliveryLines(lines))}
      <p class="mu" style="font-size:12px;margin:4px 0 0">Цены — из открытых данных сетей, обновляются каждый день. В магазине могут отличаться.</p>
    </div>`;
}, {
  tab: 'basket',
  dock() {
    const bm = app.menu?.plan?.dishes?.length && basketModel(); if (!bm) return '';
    const bl = basketLines(bm), total = basketTotal(bl) + feesSum(deliveryLines(bl));
    const one = bm.mode === 'mine' ? bm.mine : bm.best;
    const where = bm.mode === 'two' ? 'в двух сетях' : 'в ' + (CHAINS[one.chain] || '');
    return `<div class="dock-in"><span style="flex:1;display:flex;flex-direction:column"><b class="num" style="font:900 18px Heebo,sans-serif">${moneyR(total)}</b><span class="mu" style="font:600 12px Heebo,sans-serif">${esc(where)}</span></span>
      <button class="cta sm" id="waBtn">${IC.i('<path d="M3 21l1.6-4.8A9 9 0 1 1 8 19.6z"/>', 18, '#fff')}Отправить список</button></div>`;
  },
  after(view, q) {
    if (!app.menu?.plan?.dishes?.length) return bindNeedMenu(view);
    const noIcon = Object.keys(app.menu.basket?.qty || {}).filter(k => app.defs[k]?.icon === undefined);
    if (noIcon.length && !timers.icons) { timers.icons = 1; loadDefs(noIcon).then(() => { timers.icons = 0; render(); }); }
    for (const ch of ['tivtaam', 'keshet']) {
      const bs = (app.menu.basket?.chains || []).filter(c => baseChain(c.chain) === ch).flatMap(c => c.lines.map(l => l.barcode));
      if (bs.length && !timers['st' + ch]) { timers['st' + ch] = 1; loadStoraiIds(ch, bs).then(got => { timers['st' + ch] = 0; if (got) render(); }).catch(() => { timers['st' + ch] = 0; }); }
    }
    // нажали «Найти на сайте» — просим израильскую машину найти номер карточки в первую очередь
    $$('[data-want]', view).forEach(a => a.addEventListener('click', () => { const [c, b] = a.dataset.want.split(':'); rpc('storai_want', { p_chain: c, p_barcode: b }).catch(() => {}); }));
    // названия и штрихкоды в том виде, как у самой сети
    const byChain = {};
    for (const c of app.menu.basket?.chains || []) for (const l of c.lines || []) (byChain[c.chain] ||= []).push(l.barcode);
    for (const p of Object.values(app.menu.pick || {})) (byChain[p.chain] ||= []).push(p.barcode);
    for (const [ch, bs] of Object.entries(byChain)) if (!timers['nm' + ch]) { timers['nm' + ch] = 1; loadChainNames(ch, bs).then(got => { timers['nm' + ch] = 0; if (got) render(); }).catch(() => { timers['nm' + ch] = 0; }); }
    // перевод названий: только для того, что видно в корзине
    const bmNow = basketModel();
    const shown = (bmNow ? basketLines(bmNow) : []).filter(x => x.l && chainMeta[x.chain] && x.l.barcode in chainMeta[x.chain]).map(x => ({ n: shelfName(x.chain, x.l.barcode, x.l.name), m: chainMeta[x.chain]?.[x.l.barcode]?.m }));
    if (!timers.ntr) { timers.ntr = 1; loadNameTr(shown).then(got => { timers.ntr = 0; if (got) render(); }).catch(() => { timers.ntr = 0; }); }
    $$('[data-mode]', view).forEach(b => b.onclick = () => { app.menu.buyMode = b.dataset.mode; saveMenu(); render(); });
    $$('[data-shop]', view).forEach(b => b.onclick = () => { if (shopMode() === b.dataset.shop) return; app.profile.shop = b.dataset.shop; saveProfile(); render(); });
    $$('[data-have]', view).forEach(b => b.onclick = () => { const k = b.dataset.have; app.menu.have[k] = !app.menu.have[k]; saveMenu(); render(); });
    $$('[data-swap]', view).forEach(b => b.onclick = () => swapProduct(b.dataset.swap, b.dataset.chain));
    const mc = $('#myChain', view); if (mc) mc.onchange = () => { app.profile.chain = mc.value; app.menu.chain = mc.value; app.menu.buyMode = mc.value ? 'mine' : 'one'; saveProfile(); saveMenu(); render(); };
    const wa = $('#waBtn'); if (wa) wa.onclick = shopList;
    if (q && q.includes('buy=1')) { history.replaceState(null, '', '#/basket'); setTimeout(shopList, 50); }
  },
});

// сколько стоит предложение сети на нужное количество
function offerCost(o, key) {
  const d = app.defs[key], q = app.menu.basket.qty[key]; if (!d || !q) return null;
  const pg = d.piece_g;
  if (o.is_weighted) {
    const g = d.base_unit === 'шт' ? (pg ? q * pg : null) : q; if (!g) return null;
    const kg = Math.max(0.1, Math.round(g / 100) / 10);
    return { cost: Number(o.price) * kg, kg, packs: null };
  }
  let n = q;
  if (o.pack_unit && o.pack_unit !== d.base_unit) {
    if (o.pack_unit === 'шт' && pg) n = q / pg;
    else if (d.base_unit === 'шт' && pg) n = q * pg;
    else if (!((o.pack_unit === 'г' && d.base_unit === 'мл') || (o.pack_unit === 'мл' && d.base_unit === 'г'))) return null;
  }
  const packs = Number(o.pack) > 0 ? Math.max(1, Math.ceil(n / Number(o.pack) - 0.05)) : 1;
  return { cost: Number(o.price) * packs, kg: null, packs };
}
function swapProduct(key, chain) {
  const d = app.defs[key];
  sheet('Заменить товар', `<p class="mu" style="margin:0">${esc(d?.name_ru || key)} · нужно ${qtyText({ qty: app.menu.basket.qty[key] }, d)} · ${esc(CHAINS[chain] || chain)}</p><div id="alts"><p class="mu"><span class="spin"></span> Ищем товары…</p></div>`, async (el, close) => {
    const box = $('#alts', el);
    try {
      const offers = await rpc('g_ingredient_offers', { p_keys: [key] });
      const seen = new Set(), list = [];
      for (const o of offers) {
        if (o.chain !== chain || seen.has(o.barcode)) continue; seen.add(o.barcode);
        const c = offerCost(o, key); if (c) list.push({ ...o, ...c });
      }
      list.sort((a, b) => a.cost - b.cost);
      await loadChainNames(chain, list.map(o => o.barcode)).catch(() => {});
      await loadNameTr(list.map(o => ({ n: shelfName(chain, o.barcode, o.name), m: chainMeta[chain]?.[o.barcode]?.m }))).catch(() => {});
      const cur = lineIn(app.menu.basket.chains.find(c => c.chain === chain), key);
      if (!list.length) { box.innerHTML = '<p class="mu">В этой сети других товаров не нашли.</p>'; return; }
      const cat = CAT_ORDER.includes(d?.category) ? d.category : 'other';
      box.innerHTML = `<div class="mlist">${list.map((o, i) => `<button class="op" data-i="${i}" ${cur?.barcode === o.barcode ? 'aria-current="true" style="border:2px solid #137A4B"' : ''}>
          <span class="pic-ic" style="background:${CAT_BG[cat]};width:48px;height:48px;font-size:24px" aria-hidden="true">${iconOf(key)}</span><span class="oi"><b dir="auto">${esc(trName(shelfName(chain, o.barcode, o.name)))}</b><span>${o.is_weighted ? 'на развес · ' + amt(o.kg) + ' кг' : (o.pack ? amt(o.pack) + ' ' + esc(o.pack_unit || '') + ' · ' : '') + o.packs + ' уп.'}${cur?.barcode === o.barcode ? ' · сейчас' : ''}</span></span>
          <span class="dl num">${money(o.cost, 1)}</span></button>`).join('')}</div>
        ${app.menu.pick?.[key] ? '<button class="ghost w" data-reset>Вернуть самый выгодный</button>' : ''}`;
      $$('[data-i]', box).forEach(b => b.onclick = () => {
        const o = list[+b.dataset.i];
        app.menu.pick ||= {};
        app.menu.pick[key] = { key, chain, barcode: o.barcode, name: o.name, cost: o.cost, packs: o.packs, kg: o.kg, picked: true };
        saveMenu(); close(); render(); toast('Заменили товар');
      });
      const r = $('[data-reset]', box); if (r) r.onclick = () => { delete app.menu.pick[key]; saveMenu(); close(); render(); };
    } catch (e) { box.innerHTML = `<div class="err">Не загрузилось: ${esc(e.message)}</div>`; }
  });
}
function shopList() {
  const bm = basketModel(); if (!bm) return;
  const m = app.menu, lines = basketLines(bm).filter(x => !x.off);
  const groups = {};
  for (const x of lines) (groups[x.chain] ||= []).push(x);
  const text = `🛒 Покупки на неделю ${weekLabel(m.weekStart)} (Sali)\n` + Object.entries(groups).map(([c, xs]) =>
    `\n*${CHAINS[c] || c}* — ${moneyR(basketTotal(xs) + (delivOf(c)?.fee || 0))}\n` + xs.map(x => `▫️ ${x.l ? (h => trName(h) !== h ? trName(h) + ' (' + h + ')' : h)(shelfName(x.chain, x.l.barcode, x.l.name)) : (x.d?.name_ru || x.key)}${x.l ? ' — ' + packText(x.l) : ''}${x.l ? '' : ' (' + qtyText(x.e, x.d) + ')'}${x.l && realBarcode(x.l.barcode, x.l.kg != null) ? '\n     ' + 'штрихкод ' + x.l.barcode : ''}`).join('\n') + (delivOf(c)?.fee ? `\n▫️ Доставка — ${money(delivOf(c).fee, 1)}` : '')).join('\n') +
    `\n\nИтого: ${moneyR(basketTotal(lines) + feesSum(deliveryLines(lines)))}`;
  sheet('Отправить список', `<a class="cta w" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Отправить в WhatsApp</a>
    <div style="display:flex;gap:10px">${navigator.share ? '<button class="ghost" style="flex:1" data-share>Поделиться…</button>' : ''}<button class="ghost" style="flex:1" data-copy>Скопировать</button></div>
    <textarea class="inp" readonly style="min-height:220px;font-size:13px" aria-label="Текст списка">${esc(text)}</textarea>`,
    el => {
      el.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(text).then(() => toast('Список скопирован'), () => { el.querySelector('textarea').select(); toast('Выделили — скопируйте'); });
      const s = el.querySelector('[data-share]'); if (s) s.onclick = () => navigator.share({ title: 'Покупки на неделю', text }).catch(() => {});
    });
}

// ---------- 8. Настройки меню (семья) ----------
route(/^#\/family$/, () => `<div class="hd"><div><div class="sub">Настройки меню</div><h1 class="h">Кто что ест</h1></div><button class="ib" onclick="history.length > 1 ? history.back() : go('#/today')" aria-label="Закрыть">${ico('close')}</button></div>
  <div class="pad" style="display:flex;flex-direction:column;gap:18px;padding-top:12px" id="fam">
    <label class="wish"><span class="sub">Пожелания своими словами</span><textarea data-f="wish" rows="2" placeholder="Поменьше мяса, что-нибудь с чечевицей…">${esc(app.profile.wish)}</textarea></label>
    ${familyForm(true)}
    <p class="mu" style="font-size:12px;margin:0">${app.user ? 'Настройки сохраняются в аккаунте.' : 'Настройки сохраняются на этом устройстве.'} Сеть применяется сразу, остальное — при следующей сборке меню.</p>
    <button class="cta w" id="rebuild">Пересобрать меню с этими настройками</button>
    <button class="ghost w" onclick="history.length > 1 ? history.back() : go('#/today')" style="margin-bottom:20px">Готово</button>
  </div>`, {
  after(view) {
    bindFamilyForm($('#fam', view), () => { const y = scrollY; render(); scrollTo(0, y); });
    $('#rebuild', view).onclick = () => app.menu?.plan ? confirmSheet('Пересобрать меню?', app.user ? 'Текущее меню останется в «Моих меню».' : 'Текущее меню на этом устройстве заменится новым.', 'Пересобрать', buildMenu) : buildMenu();
  },
});

// ---------- Рецепты ----------
async function myRecipes(force) {
  if (!app.user) return [];
  if (app.myRecipes && !force) return app.myRecipes;
  const { data, error } = await sb.from('user_recipes').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return (app.myRecipes = data);
}
route(/^#\/recipes(\?mine)?$/, (mine) => {
  if (mine) app.ui.recTab = 'mine';
  const tab = app.ui.recTab;
  return `<div class="hd"><div><div class="sub">Библиотека и свои</div><h1 class="h">Рецепты</h1></div><a class="ib" href="#/new" aria-label="Новый рецепт">${ico('plus')}</a></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:12px;padding-top:12px">
      <div class="seg" role="group" aria-label="Какие рецепты"><button aria-pressed="${tab === 'all'}" data-rt="all">Все рецепты</button><button aria-pressed="${tab === 'mine'}" data-rt="mine">Мои рецепты</button></div>
      <div class="search">${ico('search', 18, '#8A8A8A')}<input class="inp" id="q" type="search" placeholder="Найти: шакшука, курица, суп…" value="${esc(app.ui.q)}" aria-label="Поиск рецептов"></div>
      ${tab === 'all' ? `<div class="hscroll" role="group" aria-label="Приём пищи">${['', ...MEAL_ORDER].map(m => `<button class="pill" aria-pressed="${(app.ui.recMeal || '') === m}" data-rm="${m}">${m ? MEAL_LABEL[m].replace('Коробочка в сад и школу', 'В школу / сад') : 'Все'}</button>`).join('')}</div>` : ''}
      <div id="rlist"><p class="mu"><span class="spin"></span> Загружаем…</p></div>
    </div>`;
}, {
  tab: 'recipes',
  async after(view) {
    $$('[data-rt]', view).forEach(b => b.onclick = () => { app.ui.recTab = b.dataset.rt; history.replaceState(null, '', '#/recipes'); render(); });
    $$('[data-rm]', view).forEach(b => b.onclick = () => { app.ui.recMeal = b.dataset.rm; render(); });
    const box = $('#rlist', view), q = $('#q', view);
    const draw = list => {
      const s = app.ui.q.trim().toLowerCase();
      const f = list.filter(r => !s || (r.name + ' ' + (r.description || '')).toLowerCase().includes(s)).filter(r => !app.ui.recMeal || (r.meals || []).includes(app.ui.recMeal));
      box.innerHTML = f.length ? `<div class="grid">${f.slice(0, 120).map(r => `<a class="rc" href="#/${r.user_id ? 'my' : 'r'}/${r.id}">${libTile(r)}<div><b>${esc(r.name)}</b><span>${(r.cook_minutes || r.minutes) ? (r.cook_minutes || r.minutes) + ' мин' : ''}${(r.meals || []).length ? ' · ' + esc(r.meals.map(x => MEAL_SHORT[x] || x).join(', ')) : ''}</span></div></a>`).join('')}</div>${f.length > 120 ? `<p class="mu">Показаны первые 120 — уточните поиск.</p>` : ''}`
        : `<p class="mu">Ничего не нашлось.</p>`;
    };
    try {
      if (app.ui.recTab === 'mine') {
        if (!app.user) { box.innerHTML = `<div class="card"><b>Свои рецепты хранятся в аккаунте</b><span class="mu">Бабушкины, любимые, из книги — добавьте их, и мы посчитаем цену порции и поставим в меню.</span><button class="gbtn" id="lg">${IC.google}Войти через Google</button></div>`; $('#lg', box).onclick = () => login('#/recipes?mine'); return; }
        const list = await myRecipes();
        if (!list.length) { box.innerHTML = `<div class="empty" style="padding:20px 0"><p>Своих рецептов пока нет.</p><a class="cta" href="#/new">Добавить рецепт</a></div>`; return; }
        draw(list);
      } else draw(await loadLib());
      q.oninput = () => { app.ui.q = q.value; app.ui.recTab === 'mine' ? draw(app.myRecipes || []) : draw(app.lib || []); };
    } catch (e) { box.innerHTML = `<div class="err">Не загрузилось: ${esc(e.message)}</div>`; }
  },
});

function recipePage(r, own) {
  const ings = r.ingredients || [], mins = r.cook_minutes || r.minutes;
  const c = ingsCost(ings).sum;
  return `<div class="hero">${r.image_url ? `<img src="${esc(r.thumb_url || r.image_url)}" ${r.thumb_url ? `srcset="${esc(r.thumb_url)} 640w, ${esc(r.image_url)} 1200w" sizes="(min-width: 700px) 1040px, 100vw"` : ''} alt="${esc(r.name)}">` : `<div class="t" style="background:${MEAL_COLOR[(r.meals || [])[0]] || '#7A6A50'}">${esc(r.name[0])}</div>`}
      <button class="ib back" onclick="history.length > 1 ? history.back() : go('#/recipes')" aria-label="Назад">${ico('back')}</button></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:14px;padding-top:14px">
      <div><div class="rowi">${own ? '<span class="lk">мой рецепт</span>' : ''}${(r.meals || []).map(m => `<span class="lk gr">${esc(MEAL_SHORT[m] || m)}</span>`).join('')}</div><h1 class="h" style="margin-top:8px">${esc(r.name)}</h1>${r.description ? `<p class="mu" style="margin:6px 0 0">${esc(r.description)}</p>` : ''}</div>
      <div class="facts"><div class="fact"><span>Порций</span><b>${r.portions || '—'}</b></div><div class="fact"><span>Время</span><b>${mins ? mins + ' мин' : '—'}</b></div><div class="fact"><span>За порцию</span><b class="num">${c ? money(c / Math.max(1, r.portions || 1), 1) : '—'}</b></div></div>
      ${app.menu?.plan ? `<button class="cta w" id="toMenu">Поставить в меню</button>` : `<a class="cta w" href="#/start">Собрать меню</a>`}
      <div class="sec"><div class="sec-h">Продукты</div><div>${ings.map(i => `<div class="ing"><div class="tx"><b>${esc(i.name || app.defs[i.key]?.name_ru || i.key)}</b></div><span class="q">${i.unit === 'по вкусу' ? 'по вкусу' : amt(i.amount) + ' ' + esc(i.unit || '')}</span></div>`).join('')}</div></div>
      <div class="sec"><div class="sec-h">Как готовить</div>${(r.steps || []).map((t, i) => `<div class="step"><i>${i + 1}</i><span>${esc(t)}</span></div>`).join('')}${r.tip ? `<div class="note">${ico('bulb', 20, '#8A6400')}<span>${esc(r.tip)}</span></div>` : ''}</div>
      ${own ? `<button class="ghost w" id="delOwn" style="margin-bottom:20px">${ico('trash', 18)}Удалить рецепт</button>` : '<div style="height:20px"></div>'}
    </div>`;
}
function toMenuSheet(src) {
  let d = app.ui.day ?? Math.max(0, todayIndex()), meal = (src.meals || [])[0] || 'ужин';
  const draw = (el, close) => {
    const ex = slots(d).find(s => s.meal === meal);
    el.querySelector('[data-body]').innerHTML = `<div class="sec"><div class="sec-h">День</div><div class="dd">${DAYS.map((x, i) => `<button aria-pressed="${i === d}" data-d="${i}">${x}</button>`).join('')}</div></div>
      <div class="sec"><div class="sec-h">Приём пищи</div><div class="chips">${MEAL_ORDER.map(m => `<button class="pill" aria-pressed="${m === meal}" data-m="${m}">${MEAL_LABEL[m]}</button>`).join('')}</div></div>
      ${ex ? `<button class="cta w" data-put="replace">Заменить «${esc(ex.dish.name)}»</button><button class="ghost w" data-put="add">Добавить ещё одно блюдо</button>` : `<button class="cta w" data-put="add">Поставить в ${DAYS_FULL[d]}</button>`}`;
    $$('[data-d]', el).forEach(b => b.onclick = () => { d = +b.dataset.d; draw(el, close); });
    $$('[data-m]', el).forEach(b => b.onclick = () => { meal = b.dataset.m; draw(el, close); });
    $$('[data-put]', el).forEach(b => b.onclick = () => { putDish(d, b.dataset.put === 'replace' ? ex.mi : null, src, { meal }); close(); app.ui.day = d; toast('Поставили в меню'); go('#/today'); });
  };
  sheet('Поставить в меню', '<div data-body style="display:flex;flex-direction:column;gap:14px"></div>', draw);
}
route(/^#\/r\/([0-9a-f-]+)$/, () => `<p class="pad mu" style="padding-top:20px"><span class="spin"></span> Загружаем рецепт…</p>`, {
  tab: 'recipes',
  async after(view, id) {
    try {
      const r = await libRecipeFull(id); if (!r) { view.innerHTML = '<p class="pad">Рецепт не найден.</p>'; return; }
      await ensureUnits((r.ingredients || []).map(i => i.key));
      view.innerHTML = recipePage(r, false);
      const b = $('#toMenu', view); if (b) b.onclick = () => toMenuSheet({ ...r, lib: true });
    } catch (e) { view.innerHTML = `<div class="pad err">Не загрузилось: ${esc(e.message)}</div>`; }
  },
});
route(/^#\/my\/([0-9a-f-]+)$/, () => `<p class="pad mu" style="padding-top:20px"><span class="spin"></span> Загружаем рецепт…</p>`, {
  tab: 'recipes',
  async after(view, id) {
    if (!app.user) { view.innerHTML = '<p class="pad">Войдите, чтобы открыть свой рецепт.</p>'; return; }
    const r = (await myRecipes()).find(x => x.id === id) || (await myRecipes(true)).find(x => x.id === id);
    if (!r) { view.innerHTML = '<p class="pad">Рецепт не найден.</p>'; return; }
    await ensureUnits((r.ingredients || []).map(i => i.key));
    view.innerHTML = recipePage(r, true);
    const b = $('#toMenu', view); if (b) b.onclick = () => toMenuSheet({ ...r, own: true, cook_minutes: r.minutes });
    $('#delOwn', view).onclick = () => confirmSheet('Удалить рецепт?', `«${r.name}» удалится из ваших рецептов. В уже составленных меню блюдо останется.`, 'Удалить', async () => {
      const { error } = await sb.from('user_recipes').delete().eq('id', r.id);
      if (error) return toast('Не удалилось: ' + error.message);
      app.myRecipes = (app.myRecipes || []).filter(x => x.id !== r.id); toast('Удалили'); go('#/recipes?mine');
    });
  },
});

// ---------- 10. Новый рецепт ----------
route(/^#\/new(?:\?for=([^&]+))?$/, (forArg) => {
  const way = app.ui.way || 'text';
  const w = (k, icon, bg, t, s) => `<button class="way" aria-pressed="${way === k}" data-way="${k}"><span class="wi" style="background:${bg}">${ico(icon, 24)}</span><span class="wt"><b>${t}</b><span>${s}</span></span></button>`;
  return `<div class="hd"><div><div class="sub">${forArg ? 'Своё блюдо в меню' : 'Мои рецепты'}</div><h1 class="h">Новый рецепт</h1></div><button class="ib" onclick="history.back()" aria-label="Закрыть">${ico('close')}</button></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-top:10px">
      <p class="mu" style="margin:0 0 4px">Добавьте как удобно — разберём рецепт на продукты, найдём их в магазинах и посчитаем цену порции.</p>
      ${w('text', 'text', '#FFF1C2', 'Вставить текст', 'из заметок, WhatsApp, письма')}
      ${way === 'text' ? `<textarea class="inp" id="rtext" placeholder="Мамины котлетки с кабачком&#10;500 г куриного фарша, 1 кабачок, 1 яйцо, 2 ложки панировки, укроп, соль.&#10;Кабачок натереть и отжать, смешать всё, сформовать котлетки…">${esc(app.ui.rtext || '')}</textarea>` : ''}
      ${w('link', 'link', '#E9EEFC', 'Ссылка', 'страница рецепта на сайте')}
      ${way === 'link' ? `<input class="inp" id="rurl" type="url" inputmode="url" placeholder="https://…" value="${esc(app.ui.rurl || '')}"><span class="mu" style="font-size:12px">Instagram и TikTok не отдают рецепт по ссылке — для них сделайте скриншот.</span>` : ''}
      ${w('photo', 'camera', '#FFE2C8', 'Фото рецепта', 'страница из книги, бабушкина тетрадь, скриншот')}
      ${way === 'photo' ? `<label class="ghost w" style="cursor:pointer">${ico('camera', 18)}${app.ui.photoName ? esc(app.ui.photoName) : 'Сфотографировать или выбрать'}<input type="file" accept="image/*" id="rphoto" class="sr"></label>` : ''}
      ${w('manual', 'pen', '#E8F5EE', 'Вручную', 'по полям: продукты, шаги, время')}
      <div class="status mu" id="pst" role="status" aria-live="polite"></div>
      <button class="cta w" id="parse" style="margin-bottom:20px">${way === 'manual' ? 'Заполнить вручную' : 'Разобрать рецепт'}</button>
    </div>`;
}, {
  tab: 'recipes',
  after(view, forArg) {
    $$('[data-way]', view).forEach(b => b.onclick = () => { app.ui.way = b.dataset.way; render(); });
    const t = $('#rtext', view); if (t) t.oninput = () => app.ui.rtext = t.value;
    const u = $('#rurl', view); if (u) u.oninput = () => app.ui.rurl = u.value;
    const ph = $('#rphoto', view); if (ph) ph.onchange = async () => { const f = ph.files[0]; if (!f) return; app.ui.photo = await shrinkImage(f); app.ui.photoName = f.name; render(); };
    $('#parse', view).onclick = async () => {
      const way = app.ui.way || 'text', st = $('#pst', view), btn = $('#parse', view);
      if (way === 'manual') { app.draft = { title: '', servings: 4, minutes: 30, work_minutes: 15, meals: [], items: [], steps: [''], for: forArg || null, source: 'manual' }; LS.set('sali.draft', app.draft); go('#/manual'); return; }
      const body = way === 'text' ? { text: app.ui.rtext || '' } : way === 'link' ? { url: (app.ui.rurl || '').trim() } : { image: app.ui.photo };
      if ((way === 'text' && (body.text || '').trim().length < 20) || (way === 'link' && !body.url) || (way === 'photo' && !body.image)) { st.textContent = way === 'photo' ? 'Сначала выберите фото' : way === 'link' ? 'Вставьте ссылку' : 'Вставьте текст рецепта'; return; }
      btn.disabled = true; st.innerHTML = '<span class="spin"></span> Разбираем рецепт — 5–20 секунд…';
      try {
        const t0 = Date.now();
        const res = await fn('recipe-parse', body);
        Object.assign(app.defs, Object.fromEntries(Object.entries(res.defs || {}).map(([k, v]) => [k, { key: k, name_ru: v.name, name_he: v.name_he, base_unit: v.unit, piece_g: v.piece_g }])));
        await loadDefs((res.result.items || []).map(i => i.key));
        const r = res.result;
        // основное + отдельный гарнир: делим сразу, пользователь может отменить на проверке
        const split = r.dish_type === 'main' && (r.side_items || []).length > 0, sideIdx = new Set(split ? r.side_items : []);
        app.draft = { title: split ? (r.main_title || r.title || '') : (r.title || ''), fullTitle: r.title || '', servings: r.servings || 4, minutes: r.minutes || 30, work_minutes: r.work_minutes || null, meals: r.meals || [], kind: r.kind,
          split, sideTitle: r.side_title || '', sideSteps: r.side_steps || [], sideMinutes: r.side_minutes || 20, sideMatch: res.side_match || null,
          items: (r.items || []).map((i, n) => ({ side: sideIdx.has(n) || undefined, key: i.key, name: i.key ? (app.defs[i.key]?.name_ru || i.line) : (i.missing || i.line), line: i.line, amount: i.qty, unit: i.key ? (app.defs[i.key]?.base_unit || 'г') : '', guess: i.guess, pantry: !!i.pantry || !!app.defs[i.key]?.pantry })),
          steps: r.steps || [], for: forArg || null, source: way, ms: Date.now() - t0 };
        LS.set('sali.draft', app.draft);
        go('#/review');
      } catch (e) { st.innerHTML = `<span style="color:#B23B27">${esc(e.message)}</span>`; }
      finally { btn.disabled = false; }
    };
  },
});
// фото уменьшаем в браузере: до 1600 px, JPEG — чтобы быстро ушло
function shrinkImage(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res({ media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] });
    };
    img.onerror = () => rej(new Error('Не получилось открыть фото'));
    img.src = url;
  });
}

// ---------- 11. Проверить рецепт ----------
function draftIngs(dr, part = 'main') { return dr.items.filter(i => (i.name || i.key) && (!dr.split || !!i.side === (part === 'side'))).map(i => ({ key: i.key || null, name: i.name || app.defs[i.key]?.name_ru || '', amount: Number(i.amount) || 0, unit: i.unit || app.defs[i.key]?.base_unit || 'г', pantry: !!i.pantry })); }
function draftToSrc(dr, row) {
  return { id: row?.id, own: !!row, name: dr.title || 'Мой рецепт', portions: dr.servings || 4, minutes: dr.minutes, cook_minutes: dr.minutes, meals: dr.meals?.length ? dr.meals : undefined,
    tags: [dr.kind].filter(Boolean), ingredients: draftIngs(dr), steps: draftSteps(dr), kind: dr.split ? 'main' : 'dish' };
}
// без разделения шаги гарнира идут вместе с основными
function draftSteps(dr) { return [...(dr.steps || []), ...(dr.split ? [] : dr.sideSteps || [])].filter(s => s.trim()); }
function draftSideSrc(dr, row) {
  return { id: row?.id, own: !!row, name: dr.sideTitle || 'Гарнир', portions: dr.servings || 4, cook_minutes: dr.sideMinutes, meals: ['обед', 'ужин'], kind: 'side',
    tags: ['гарнир'], ingredients: draftIngs(dr, 'side'), steps: (dr.sideSteps || []).filter(s => s.trim()) };
}
async function saveDraft(dr) {
  // гарнир: если такой есть в библиотеке — ссылка на него, иначе свой рецепт-гарнир
  let side = { kind: 'dish', side_id: null, side_src: null };
  if (dr.split) {
    if (dr.sideMatch?.id) side = { kind: 'main', side_id: dr.sideMatch.id, side_src: 'lib' };
    else {
      const sr = { name: dr.sideTitle || 'Гарнир', portions: dr.servings || 4, minutes: dr.sideMinutes || null, ingredients: draftIngs(dr, 'side'), steps: (dr.sideSteps || []).filter(s => s.trim()),
        meals: ['обед', 'ужин'], tags: ['гарнир'], source: dr.source, kind: 'side' };
      const q0 = dr.sideSavedId ? sb.from('user_recipes').update(sr).eq('id', dr.sideSavedId) : sb.from('user_recipes').insert(sr);
      const { data: sd, error: se } = await q0.select('id').single();
      if (se) throw se;
      dr.sideSavedId = sd.id; side = { kind: 'main', side_id: sd.id, side_src: 'own' };
    }
  }
  const row = { name: dr.title || 'Мой рецепт', portions: dr.servings || 4, minutes: dr.minutes || null, work_minutes: dr.work_minutes || null, ingredients: draftIngs(dr),
    steps: draftSteps(dr), meals: dr.meals || [], tags: [dr.kind].filter(Boolean), source: dr.source, ...side };
  const q = dr.savedId ? sb.from('user_recipes').update(row).eq('id', dr.savedId) : sb.from('user_recipes').insert(row);
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  app.myRecipes = null; dr.savedId = data.id;
  return data;
}
function finishDraft(dr, row, toMenu) {
  if (toMenu && dr.for && app.menu?.plan) {
    const [d, mi, meal] = dr.for.split('/');
    const dish = putDish(+d, mi === 'new' ? null : +mi, draftToSrc(dr, row), { meal: decodeURIComponent(meal || 'ужин') });
    if (dr.split) {
      const at = app.menu.plan.days[+d].meals.findIndex(x => x.dish_id === dish.id);
      if (at >= 0) {
        if (dr.sideMatch?.id) libRecipeFull(dr.sideMatch.id).then(sd => { putSide(+d, at, { ...sd, lib: true }); render(); }).catch(e => console.warn(e));
        else putSide(+d, at, draftSideSrc(dr, dr.sideSavedId ? { id: dr.sideSavedId } : null));
      }
    }
    app.draft = null; LS.set('sali.draft', null); app.ui.day = +d; toast('Поставили в меню'); go('#/today');
  } else if (toMenu && app.menu?.plan) { app.draft = null; LS.set('sali.draft', null); toMenuSheet(draftToSrc(dr, row)); }
  else { app.draft = null; LS.set('sali.draft', null); toast('Рецепт сохранён'); go(row ? `#/my/${row.id}` : '#/recipes?mine'); }
}
route(/^#\/review$/, () => {
  const dr = app.draft; if (!dr) { setTimeout(() => go('#/new')); return ''; }
  const ings = draftIngs(dr), c = ingsCost(ings).sum, toggle = (v, t) => `<button class="pill" aria-pressed="${(dr.meals || []).includes(v)}" data-meal="${v}">${t}</button>`;
  const unknown = dr.items.filter(i => !i.key).length;
  return `<div class="hd"><div><div class="sub">Новый рецепт${dr.ms ? ` · разобрали за ${Math.round(dr.ms / 1000)} сек` : ''}</div><h1 class="h">Проверьте, что мы поняли</h1></div><button class="ib" onclick="history.back()" aria-label="Назад">${ico('back')}</button></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:14px;padding-top:12px">
      <label class="lbl">Название<input class="inp" data-dr="title" value="${esc(dr.title)}"></label>
      <div class="row2"><div class="fact"><span>Порций</span><span class="stp" style="align-self:flex-start;margin-top:4px"><button data-sv="-1" aria-label="Меньше">−</button><b>${dr.servings}</b><button data-sv="1" aria-label="Больше">+</button></span></div>
        <div class="fact"><span>Время, мин</span><input class="inp" data-dr="minutes" inputmode="numeric" value="${esc(dr.minutes || '')}" style="height:40px;margin-top:4px"></div></div>
      <div class="fact"><span>За порцию${priceChain() ? ' · ' + esc(CHAINS[priceChain()] || '') : ''}</span><b class="num">${c ? money(c / Math.max(1, dr.servings), 1) + ` · всего ${money(c, 1)}` : '—'}</b></div>
      <div class="sec"><div class="sec-h">Когда подходит</div><div class="chips">${toggle('завтрак', 'Завтрак')}${toggle('обед', 'Обед')}${toggle('ужин', 'Ужин')}${toggle('в школу', 'В коробочку')}${toggle('перекус', 'Перекус')}${toggle('десерт', 'Десерт')}</div>
        <div class="chips">${['мясное', 'молочное', 'парве'].map(k => `<button class="pill" aria-pressed="${dr.kind === k}" data-kind="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
      ${dr.sideTitle ? `<div class="sec split"><div class="sec-h">Основное и гарнир</div>
        <div class="seg" role="group" aria-label="Разделить"><button data-split="1" aria-pressed="${!!dr.split}">Основное + гарнир</button><button data-split="0" aria-pressed="${!dr.split}">Одно блюдо</button></div>
        ${dr.split ? `<label class="lbl">Гарнир<input class="inp" data-dr="sideTitle" value="${esc(dr.sideTitle)}"></label>
        <p class="mu" style="margin:0;font-size:13px">${dr.sideMatch ? `Такой гарнир уже есть в библиотеке — в меню поставим «${esc(dr.sideMatch.name)}» вместе с этим блюдом.` : 'Сохраним гарнир отдельным рецептом.'}
          В меню его можно заменить на любой другой гарнир или убрать — останется только основное. Продукты гарнира отмечены ниже; нажмите на отметку, чтобы перенести продукт.</p>` : ''}</div>` : ''}
      <div class="sec"><div class="sec-h">Продукты · ${dr.items.length}<button class="linkb" id="addIng">+ добавить</button></div>
        ${unknown ? `<p class="mu" style="margin:0;font-size:13px">${unknown} ${plural(unknown, 'продукт', 'продукта', 'продуктов')} не узнали — нажмите «?», чтобы выбрать, или удалите.</p>` : ''}
        <div>${dr.items.map((i, k) => { const q = toBase(i, app.defs[i.key]), u = i.key && unitPrice(i.key, priceChain()); return `<div class="ing">${i.key ? `<span class="okm">${ico('check', 12, '#fff', 3)}</span>` : `<button class="qm" data-pick="${k}" aria-label="Выбрать продукт" style="border:0">?</button>`}
          <div class="tx"><b>${esc(i.name)}${dr.split ? ` <button class="lk ${i.side ? 'o' : 'gr'}" data-side="${k}" style="border:0;vertical-align:1px">${i.side ? 'гарнир' : 'основное'}</button>` : ''}</b><span>${esc(i.line && i.line !== i.name ? i.line : '')}</span></div>
          <input class="inp" data-amt="${k}" value="${esc(amt(i.amount))}" inputmode="decimal" style="width:64px;height:38px;padding:0 6px;text-align:right" aria-label="Количество"><span class="q" style="width:28px">${esc(i.unit)}</span>
          <span class="c num">${i.pantry ? 'дома' : q != null && u != null ? money(q * u, 1) : '—'}</span><button class="del" data-rm="${k}" aria-label="Убрать">${ico('close', 16, '#8A8A8A')}</button></div>`; }).join('')}</div></div>
      <div class="sec"><div class="sec-h">Как готовить${dr.split ? ' основное' : ''} · ${dr.steps.length}<button class="linkb" id="addStep">+ шаг</button></div>
        ${dr.steps.map((s, k) => `<div class="step"><i>${k + 1}</i><textarea class="inp" data-step="${k}" style="min-height:60px;flex:1">${esc(s)}</textarea></div>`).join('')}</div>
      ${dr.split && (dr.sideSteps || []).length ? `<div class="sec"><div class="sec-h">Как готовить гарнир · ${dr.sideSteps.length}</div>
        ${dr.sideSteps.map((s, k) => `<div class="step"><i>${k + 1}</i><textarea class="inp" data-sstep="${k}" style="min-height:52px;flex:1">${esc(s)}</textarea></div>`).join('')}</div>` : ''}
      ${dr.for && app.menu?.plan ? `<button class="cta w" id="saveMenu">Сохранить и в меню</button><button class="ghost w" id="onlyMenu">Только в меню, без сохранения</button>`
        : `<button class="cta w" id="saveOnly">Сохранить в мои рецепты</button>${app.menu?.plan ? '<button class="ghost w" id="saveMenu">Сохранить и поставить в меню</button>' : ''}`}
      <div style="height:20px"></div>
    </div>`;
}, {
  tab: 'recipes',
  after(view) {
    const dr = app.draft; if (!dr) return;
    const keep = () => LS.set('sali.draft', dr);
    const rer = () => { keep(); const y = scrollY; render(); scrollTo(0, y); };
    const missing = dr.items.map(i => i.key).filter(k => k && !unitCache[k]);
    if (missing.length) ensureUnits(missing).then(() => { if (location.hash === '#/review' && !view.contains(document.activeElement)) rer(); });
    $$('[data-dr]', view).forEach(i => i.oninput = () => { dr[i.dataset.dr] = i.dataset.dr === 'minutes' ? Number(i.value) || null : i.value; keep(); });
    $$('[data-sv]', view).forEach(b => b.onclick = () => { const n = Math.max(1, Math.min(30, dr.servings + +b.dataset.sv)), k = n / dr.servings; dr.items.forEach(i => i.amount = Math.round(i.amount * k * 10) / 10); dr.servings = n; rer(); });
    $$('[data-meal]', view).forEach(b => b.onclick = () => { const m = b.dataset.meal; dr.meals ||= []; dr.meals.includes(m) ? dr.meals.splice(dr.meals.indexOf(m), 1) : dr.meals.push(m); rer(); });
    $$('[data-kind]', view).forEach(b => b.onclick = () => { dr.kind = dr.kind === b.dataset.kind ? null : b.dataset.kind; rer(); });
    $$('[data-amt]', view).forEach(i => i.onchange = () => { dr.items[+i.dataset.amt].amount = Number(String(i.value).replace(',', '.')) || 0; rer(); });
    $$('[data-rm]', view).forEach(b => b.onclick = () => { dr.items.splice(+b.dataset.rm, 1); rer(); });
    $$('[data-step]', view).forEach(t => t.oninput = () => { dr.steps[+t.dataset.step] = t.value; keep(); });
    $('#addStep', view).onclick = () => { dr.steps.push(''); rer(); };
    $$('[data-sstep]', view).forEach(t => t.oninput = () => { dr.sideSteps[+t.dataset.sstep] = t.value; keep(); });
    $$('[data-side]', view).forEach(b => b.onclick = () => { const it = dr.items[+b.dataset.side]; it.side = !it.side || undefined; rer(); });
    $$('[data-split]', view).forEach(b => b.onclick = () => {
      const on = b.dataset.split === '1'; if (on === !!dr.split) return;
      // «одно блюдо» — исходное название; «основное + гарнир» — название основного
      if (!on) { dr.mainTitle = dr.title; dr.title = dr.fullTitle || dr.title; } else dr.title = dr.mainTitle || dr.title;
      dr.split = on; rer();
    });
    $$('[data-pick]', view).forEach(b => b.onclick = () => pickIngredient(dr.items[+b.dataset.pick].name, g => { const it = dr.items[+b.dataset.pick]; it.key = g.key; it.name = g.name_ru; it.unit = g.base_unit; it.pantry = !!g.pantry; rer(); }));
    $('#addIng', view).onclick = () => pickIngredient('', g => { dr.items.push({ key: g.key, name: g.name_ru, amount: g.base_unit === 'шт' ? 1 : 100, unit: g.base_unit, pantry: !!g.pantry }); rer(); });
    const doSave = async (toMenu) => {
      if (!dr.title.trim()) { toast('Напишите название'); return; }
      if (!app.user) { askLogin('Сохраним рецепт', 'Свои рецепты хранятся в аккаунте — войдите через Google, и рецепт сохранится.', '#/review'); return; }
      try { const row = await saveDraft(dr); finishDraft(dr, row, toMenu); } catch (e) { toast('Не сохранилось: ' + e.message); }
    };
    const s1 = $('#saveMenu', view); if (s1) s1.onclick = () => doSave(true);
    const s2 = $('#saveOnly', view); if (s2) s2.onclick = () => doSave(false);
    const s3 = $('#onlyMenu', view); if (s3) s3.onclick = () => { if (!dr.title.trim()) return toast('Напишите название'); finishDraft(dr, null, true); };
  },
});
// выбор продукта из справочника
function pickIngredient(q0, onPick) {
  sheet('Какой продукт?', `<div class="search">${ico('search', 18, '#8A8A8A')}<input class="inp" id="iq" placeholder="фарш, кабачок, панировка…" value="${esc(q0)}"></div><div id="il"><p class="mu"><span class="spin"></span></p></div>`, async (el, close) => {
    const all = await loadAllIngs(), inp = $('#iq', el), box = $('#il', el);
    const draw = () => {
      const s = inp.value.trim().toLowerCase();
      const words = s.split(/\s+/).filter(Boolean).map(w => w.length >= 6 ? w.slice(0, w.length - 2) : w);
      const f = all.filter(g => words.every(w => (g.name_ru + ' ' + (g.name_he || '')).toLowerCase().includes(w))).sort((a, b) => a.name_ru.length - b.name_ru.length).slice(0, 12);
      box.innerHTML = f.length ? `<div class="acl">${f.map((g, i) => `<button data-i="${i}"><b>${esc(g.name_ru)}</b><span>${esc(g.base_unit)}</span></button>`).join('')}</div>` : '<p class="mu">Ничего не нашлось — попробуйте другое слово.</p>';
      $$('[data-i]', box).forEach(b => b.onclick = () => { close(); onPick(f[+b.dataset.i]); });
    };
    inp.oninput = draw; draw();
  });
}

// ---------- 12. Рецепт вручную ----------
route(/^#\/manual$/, () => {
  const dr = app.draft; if (!dr) { setTimeout(() => go('#/new')); return ''; }
  const units = ['г', 'кг', 'мл', 'л', 'шт', 'ст.л.', 'ч.л.'];
  return `<div class="hd"><div><div class="sub">Новый рецепт · вручную</div><h1 class="h">Рецепт по полям</h1></div><button class="ib" onclick="history.back()" aria-label="Назад">${ico('back')}</button></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:14px;padding-top:12px">
      <label class="lbl">Название<input class="inp" data-dr="title" value="${esc(dr.title)}" placeholder="Мамины котлетки с кабачком"></label>
      <div class="row2"><label class="lbl">Порций<input class="inp" data-dr="servings" inputmode="numeric" value="${esc(dr.servings)}"></label><label class="lbl">Всего, мин<input class="inp" data-dr="minutes" inputmode="numeric" value="${esc(dr.minutes || '')}"></label></div>
      <div class="sec"><div class="sec-h">Продукты</div>
        <div class="mrow mu" style="font:600 12px Heebo,sans-serif"><span>Что</span><span>Сколько</span><span>Ед.</span><span></span></div>
        ${dr.items.map((i, k) => `<div class="mrow"><button class="inp" data-pick="${k}" style="text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(i.name || 'выбрать…')}</button>
          <input class="inp" data-amt="${k}" inputmode="decimal" value="${esc(amt(i.amount))}" aria-label="Количество"><select class="inp" data-unit="${k}" aria-label="Единица" style="padding:0 4px">${units.map(u => `<option ${i.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
          <button class="del" data-rm="${k}" aria-label="Убрать">${ico('close', 16, '#8A8A8A')}</button></div>`).join('')}
        <button class="add" id="addIng">+ Продукт</button></div>
      <div class="sec"><div class="sec-h">Шаги</div>
        ${dr.steps.map((s, k) => `<div class="step"><i>${k + 1}</i><textarea class="inp" data-step="${k}" style="min-height:56px;flex:1" placeholder="Что делаем">${esc(s)}</textarea></div>`).join('')}
        <button class="add" id="addStep">+ Шаг</button></div>
      <button class="cta w" id="next" style="margin-bottom:20px">Посчитать цену и сохранить</button>
    </div>`;
}, {
  tab: 'recipes',
  after(view) {
    const dr = app.draft; if (!dr) return;
    const keep = () => LS.set('sali.draft', dr), rer = () => { keep(); const y = scrollY; render(); scrollTo(0, y); };
    $$('[data-dr]', view).forEach(i => i.oninput = () => { dr[i.dataset.dr] = i.dataset.dr === 'title' ? i.value : Number(i.value) || null; keep(); });
    $$('[data-amt]', view).forEach(i => i.onchange = () => { dr.items[+i.dataset.amt].amount = Number(String(i.value).replace(',', '.')) || 0; keep(); });
    $$('[data-unit]', view).forEach(i => i.onchange = () => { dr.items[+i.dataset.unit].unit = i.value; keep(); });
    $$('[data-rm]', view).forEach(b => b.onclick = () => { dr.items.splice(+b.dataset.rm, 1); rer(); });
    $$('[data-step]', view).forEach(t => t.oninput = () => { dr.steps[+t.dataset.step] = t.value; keep(); });
    $$('[data-pick]', view).forEach(b => b.onclick = () => pickIngredient('', g => { Object.assign(dr.items[+b.dataset.pick], { key: g.key, name: g.name_ru, unit: g.base_unit, pantry: !!g.pantry }); rer(); }));
    $('#addIng', view).onclick = () => pickIngredient('', g => { dr.items.push({ key: g.key, name: g.name_ru, amount: g.base_unit === 'шт' ? 1 : 100, unit: g.base_unit, pantry: !!g.pantry }); rer(); });
    $('#addStep', view).onclick = () => { dr.steps.push(''); rer(); };
    $('#next', view).onclick = () => { if (!dr.title.trim()) return toast('Напишите название'); if (!dr.items.length) return toast('Добавьте хотя бы один продукт'); dr.servings = dr.servings || 4; keep(); go('#/review'); };
  },
});

// ---------- Мои меню ----------
route(/^#\/menus$/, () => `<div class="hd"><div><div class="sub">${app.user ? esc(app.user.email || '') : 'Аккаунт'}</div><h1 class="h">Мои меню</h1></div><a class="ib" href="#/start" aria-label="Новое меню">${ico('plus')}</a></div>
  <div class="pad" style="padding-top:12px" id="ml"><p class="mu"><span class="spin"></span> Загружаем…</p></div>`, {
  tab: 'menus',
  async after(view) {
    const box = $('#ml', view);
    if (!app.user) { box.innerHTML = `<div class="card"><b>Меню хранятся в аккаунте</b><span class="mu">Войдите через Google — каждое собранное меню сохранится, и к нему можно вернуться с любого устройства.</span><button class="gbtn" id="lg">${IC.google}Войти через Google</button></div>`; $('#lg', box).onclick = () => login('#/menus'); return; }
    const { data, error } = await sb.from('user_menus').select('id,title,created_at,updated_at,img:state->images,ws:state->>weekStart,n:state->plan->dishes').order('updated_at', { ascending: false }).limit(60);
    if (error) { box.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    if (!data.length) { box.innerHTML = `<div class="empty"><p>Сохранённых меню пока нет.</p><a class="cta" href="#/start">Собрать меню</a></div>`; return; }
    const now = app.menu?.savedId;
    box.innerHTML = `<div class="mlist">${data.map(m => { const pics = Object.values(m.img || {}).map(x => x.thumb).filter(Boolean).slice(0, 4);
      return `<div class="mitem ${m.id === now ? 'cur' : ''}"><span class="ph">${pics.map(s => `<img src="${esc(s)}" alt="">`).join('')}</span>
        <button class="tx" data-open="${m.id}" style="border:0;background:none;text-align:left;padding:0"><b>${esc(m.ws ? 'Неделя ' + weekLabel(m.ws) : m.title)}</b><span>${(m.n || []).length} блюд · изменено ${new Date(m.updated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}${m.id === now ? ' · открыто' : ''}</span></button>
        <button class="del" data-del="${m.id}" aria-label="Удалить меню">${ico('trash', 18, '#8A8A8A')}</button></div>`; }).join('')}</div>`;
    $$('[data-open]', box).forEach(b => b.onclick = () => openMenu(b.dataset.open));
    $$('[data-del]', box).forEach(b => b.onclick = () => confirmSheet('Удалить меню?', 'Меню удалится из аккаунта насовсем.', 'Удалить', async () => {
      const { error } = await sb.from('user_menus').delete().eq('id', b.dataset.del);
      if (error) return toast('Не удалилось: ' + error.message);
      if (app.menu?.savedId === b.dataset.del) { delete app.menu.savedId; LS.set('sali.menu', app.menu); }
      render();
    }));
  },
});

// ---------- Кабинет ----------
route(/^#\/account$/, () => {
  const u = app.user;
  if (!u) return `<div class="hd"><div><div class="sub">Sali</div><h1 class="h">Вход</h1></div></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:14px;padding-top:14px">
      <p class="mu" style="margin:0">Войдите, чтобы меню, свои рецепты и настройки семьи сохранялись в аккаунте и открывались с любого устройства.</p>
      <button class="gbtn" id="lg">${IC.google}Продолжить с Google</button>
      <p class="mu" style="font-size:12px;margin:0">Входя, вы соглашаетесь с <a href="../privacy.html">политикой конфиденциальности</a>.</p></div>`;
  const md = u.user_metadata || {};
  return `<div class="hd"><div><div class="sub">Кабинет</div><h1 class="h">${esc(md.full_name || md.name || 'Мой аккаунт')}</h1></div></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:14px;padding-top:12px">
      <div style="display:flex;align-items:center;gap:12px"><span class="av-btn" style="width:56px;height:56px;border-radius:28px">${md.avatar_url ? `<img src="${esc(md.avatar_url)}" alt="" referrerpolicy="no-referrer">` : esc((u.email || '?')[0].toUpperCase())}</span><span class="mu">${esc(u.email || '')}</span></div>
      <div class="menu-list">
        <a href="#/menus">${ico('menu', 22)}<span>Мои меню</span><small>все недели</small></a>
        <a href="#/recipes?mine">${ico('book', 22)}<span>Мои рецепты</span><small>свои и бабушкины</small></a>
        <a href="#/family">${ico('user', 22)}<span>Семья и настройки меню</span><small>${eaters()} ${plural(eaters(), 'человек', 'человека', 'человек')}</small></a>
        <a href="../privacy.html">${ico('text', 22)}<span>Политика конфиденциальности</span></a>
        <button id="out">${ico('back', 22)}<span>Выйти</span></button>
      </div>
      <p class="mu" style="font-size:12px;margin:0">Чтобы удалить аккаунт и все данные, напишите на <a href="mailto:ddm2534@gmail.com">ddm2534@gmail.com</a>.</p>
    </div>`;
}, {
  after(view) {
    const lg = $('#lg', view); if (lg) lg.onclick = () => login('#/account');
    const out = $('#out', view); if (out) out.onclick = async () => { await sb.auth.signOut(); toast('Вы вышли'); go('#/account'); };
  },
});

// ---------- запуск ----------
route(/^#?\/?$/, () => { setTimeout(() => go(app.menu?.plan ? '#/today' : '#/start')); return ''; });
render();
if (sb) {
  let first = true;
  sb.auth.onAuthStateChange((ev, session) => {
    const was = app.user?.id;
    app.user = session?.user || null;
    if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + (location.hash || ''));
    if (app.user && (!was || first) && ev !== 'TOKEN_REFRESHED') setTimeout(onSignedIn, 0);
    else if (ev === 'SIGNED_OUT') { app.myRecipes = null; render(); }
    else renderChrome();
    first = false;
  });
}
