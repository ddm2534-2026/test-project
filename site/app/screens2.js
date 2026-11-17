/* Sali — корзина, календарь, настройки, рецепты (свои и библиотека), «Мои меню», кабинет. */
'use strict';

// ---------- 9. Корзина недели ----------
function basketModel() {
  const m = app.menu, b = m.basket; if (!b?.chains?.length) return null;
  const by = Object.fromEntries(b.chains.map(c => [c.chain, c]));
  const costMap = c => Object.fromEntries(c.lines.map(l => [l.key, l]));
  const full = Math.max(...b.chains.map(c => c.have));
  const ok = b.chains.filter(c => c.have >= full - 1).sort((a, z) => a.total - z.total);
  const best = ok[0];
  // две сети: по каждому продукту — где дешевле
  let pair = null;
  for (let i = 0; i < Math.min(ok.length, 5); i++) for (let j = 0; j < b.chains.length; j++) {
    const A = ok[i], B = b.chains[j]; if (A === B) continue;
    const a = costMap(A), z = costMap(B); let total = 0, have = 0, part = { [A.chain]: 0, [B.chain]: 0 };
    for (const k of new Set([...Object.keys(a), ...Object.keys(z)])) {
      const x = a[k], y = z[k], pick = !y || (x && x.cost <= y.cost) ? [A.chain, x] : [B.chain, y];
      total += pick[1].cost; part[pick[0]] += pick[1].cost; have++;
    }
    if (have >= best.have && Math.min(part[A.chain], part[B.chain]) > 25 && (!pair || total < pair.total)) pair = { a: A.chain, b: B.chain, total, part };
  }
  if (pair && pair.total > best.total - 10) pair = null;
  const mine = m.chain || app.profile.chain;
  return { best, pair, mine: mine && by[mine], by, costMap };
}
function buyLines(bm, mode) {
  const need = weekNeed(), m = app.menu;
  const lines = [];
  for (const e of need) {
    if (m.have?.[e.key]) continue;
    let chain, l;
    if (mode === 'two' && bm.pair) {
      const a = bm.costMap(bm.by[bm.pair.a])[e.key], z = bm.costMap(bm.by[bm.pair.b])[e.key];
      [chain, l] = !z || (a && a.cost <= z.cost) ? [bm.pair.a, a] : [bm.pair.b, z];
    } else { const c = mode === 'mine' && bm.mine ? bm.mine : bm.best; chain = c.chain; l = bm.costMap(c)[e.key]; }
    lines.push({ e, chain, l, d: app.defs[e.key] });
  }
  return lines;
}
const qtyText = (e, d) => { const u = d?.base_unit || ''; const q = m => u === 'шт' ? Math.ceil(m) + ' шт' : m >= 1000 ? amt(Math.round(m / 100) / 10) + (u === 'мл' ? ' л' : ' кг') : Math.round(m) + ' ' + u; return q(e.qty); };
route(/^#\/basket(\?.*)?$/, () => {
  const nm = needMenu(); if (nm) return nm;
  const m = app.menu, bm = basketModel();
  if (!bm) { if (!timers.bwait) { timers.bwait = 1; refreshPrices().then(() => { timers.bwait = 0; render(); }).catch(e => { timers.bwait = 0; toast('Цены не загрузились: ' + e.message); }); } return `${menuHead('Корзина недели')}<p class="pad mu"><span class="spin"></span> Считаем цены в 7 сетях…</p>`; }
  const mode = m.buyMode && (m.buyMode !== 'two' || bm.pair) && (m.buyMode !== 'mine' || bm.mine) ? m.buyMode : 'one';
  const lines = buyLines(bm, mode);
  const total = lines.reduce((a, x) => a + (x.l?.cost || 0), 0);
  const worst = Math.max(...Object.values(bm.by).filter(c => c.have >= bm.best.have - 1).map(c => c.total));
  const opt = (k, title, sub, price, note) => `<button class="opt" aria-pressed="${mode === k}" data-mode="${k}"><span class="rd"></span><span class="oi"><b>${title}</b><span>${sub}</span></span><span class="opp num">${moneyR(price)}${note ? `<small>${note}</small>` : ''}</span></button>`;
  const haveKeys = weekNeed().filter(e => m.have?.[e.key]);
  const byCat = {};
  for (const x of lines) (byCat[CAT_ORDER.includes(x.d?.category) ? x.d.category : 'other'] ||= []).push(x);
  const dn = id => dishById(id)?.name || '';
  return `${menuHead('Корзина недели')}
    <div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-top:12px">
      <div class="sec-h">Где купить<small>${allSlots().length} приёмов пищи · ${weekLabel(m.weekStart)}</small></div>
      ${opt('one', `Всё в одной сети — ${esc(CHAINS[bm.best.chain] || bm.best.chain)}`, `${bm.best.have} из ${m.basket.need} продуктов${bm.best.missing?.length ? ' · ' + bm.best.missing.length + ' не нашлось' : ''}`, bm.best.total, worst - bm.best.total > 5 ? '−' + moneyR(worst - bm.best.total) : '')}
      ${bm.pair ? opt('two', 'Дешевле всего — две сети', `${esc(CHAINS[bm.pair.a])} ${moneyR(bm.pair.part[bm.pair.a])} + ${esc(CHAINS[bm.pair.b])} ${moneyR(bm.pair.part[bm.pair.b])} · ещё −${moneyR(bm.best.total - bm.pair.total)}, но два магазина`, bm.pair.total, '') : ''}
      ${bm.mine && bm.mine !== bm.best ? opt('mine', `Ваша сеть — ${esc(CHAINS[bm.mine.chain])}`, 'самые выгодные товары в вашей сети', bm.mine.total, 'как обычно') :
        !bm.mine ? `<label class="lbl">Ваша обычная сеть<select class="inp" id="myChain"><option value="">— выбрать —</option>${Object.entries(CHAINS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>` : ''}
      <details><summary class="linkb" style="list-style:none;cursor:pointer">Все ${Object.keys(bm.by).length} сетей</summary><div style="margin-top:6px">${Object.values(bm.by).sort((a, z) => z.have - a.have || a.total - z.total).map(c => `<div class="rw"><b>${esc(CHAINS[c.chain] || c.chain)}</b><span class="mu">${c.have}/${m.basket.need}</span><span class="num" style="min-width:70px;text-align:right">${moneyR(c.total)}</span></div>`).join('')}</div></details>
      <div class="sec" style="margin-top:6px"><div class="sec-h">Уже есть дома — не покупаем</div>
        <div class="chips">${haveKeys.map(e => `<button class="hm" data-have="${esc(e.key)}" aria-label="Вернуть в покупки: ${esc(app.defs[e.key]?.name_ru || e.key)}"><s>${esc(app.defs[e.key]?.name_ru || e.key)}</s></button>`).join('')}<button class="hm" id="markHave" style="background:#fff;border:1px dashed #C8C8C8">+ отметить</button></div></div>
      ${CAT_ORDER.filter(c => byCat[c]).map(c => `<div><div class="cat-h"><span>${CAT_LABEL[c]} · ${byCat[c].length}</span><span class="num">${money(byCat[c].reduce((a, x) => a + (x.l?.cost || 0), 0), 1)}</span></div>
        ${byCat[c].map(x => `<div class="it"><div class="tx"><b>${esc(x.d?.name_ru || x.e.key)}, ${qtyText(x.e, x.d)}</b>
          <span>${esc(x.e.dishes.map(dn).filter(Boolean).slice(0, 3).join(', '))}</span>
          ${x.l ? `<span><span class="he" dir="rtl">${esc(x.l.name)}</span> · ${x.l.kg ? amt(x.l.kg) + ' кг' : (x.l.packs || 1) + ' уп.'}${mode === 'two' ? ' · ' + esc(CHAINS[x.chain]) : ''}${x.l.sub ? ' · аналог' : ''}${x.l.deal ? ' · <b style="color:#137A4B">акция</b>' : ''}</span>` : '<span style="color:#B23B27">нет в этой сети</span>'}</div>
          <span class="num" style="font:700 14px Heebo,sans-serif">${x.l ? money(x.l.cost, 1) : '—'}</span>
          <button class="del" data-have="${esc(x.e.key)}" aria-label="Есть дома: ${esc(x.d?.name_ru || x.e.key)}" title="Есть дома">${ico('check', 18, '#8A8A8A')}</button></div>`).join('')}</div>`).join('')}
      <p class="mu" style="font-size:12px;margin:4px 0 0">Цены — из открытых данных сетей, обновляются каждый день. Цены в магазине могут отличаться. Галочка справа — «есть дома».</p>
    </div>`;
}, {
  tab: 'basket',
  dock() {
    const bm = app.menu?.plan && basketModel(); if (!bm) return '';
    const m = app.menu, mode = m.buyMode && (m.buyMode !== 'two' || bm.pair) && (m.buyMode !== 'mine' || bm.mine) ? m.buyMode : 'one';
    const total = buyLines(bm, mode).reduce((a, x) => a + (x.l?.cost || 0), 0);
    const where = mode === 'two' ? 'в двух сетях' : 'в ' + (CHAINS[(mode === 'mine' ? bm.mine : bm.best).chain] || '');
    return `<div class="dock-in"><button class="ghost" id="listBtn" style="min-height:48px">${ico('share', 18)}Список</button><button class="cta sm" style="flex:1" id="buyBtn">Купить ${esc(where)} · ${moneyR(total)}</button></div>`;
  },
  after(view, q) {
    if (!app.menu?.plan) return bindNeedMenu(view);
    $$('[data-mode]', view).forEach(b => b.onclick = () => { app.menu.buyMode = b.dataset.mode; saveMenu(); render(); });
    $$('[data-have]', view).forEach(b => b.onclick = () => { const k = b.dataset.have; app.menu.have[k] = !app.menu.have[k]; saveMenu(); refreshPrices().then(render); render(); });
    const mc = $('#myChain', view); if (mc) mc.onchange = () => { app.profile.chain = mc.value; app.menu.chain = mc.value; saveProfile(); saveMenu(); app.menu.buyMode = 'mine'; render(); };
    const mh = $('#markHave', view); if (mh) mh.onclick = haveSheet;
    const lb = $('#listBtn'), bb = $('#buyBtn');
    if (lb) lb.onclick = shopList; if (bb) bb.onclick = shopList;
    if (q && q.includes('buy=1')) { history.replaceState(null, '', '#/basket'); setTimeout(shopList, 50); }
  },
});
function haveSheet() {
  const need = weekNeed().filter(e => !app.menu.have[e.key]);
  sheet('Что уже есть дома?', `<p class="mu" style="margin:0">Отмеченное не попадёт в корзину.</p><div>${need.map(e => `<label class="ing"><input type="checkbox" class="chk" data-k="${esc(e.key)}"><div class="tx"><b>${esc(app.defs[e.key]?.name_ru || e.key)}</b></div><span class="q">${qtyText(e, app.defs[e.key])}</span></label>`).join('')}</div><button class="cta w" data-ok>Готово</button>`,
    (el, close) => el.querySelector('[data-ok]').onclick = () => { $$('[data-k]', el).forEach(c => { if (c.checked) app.menu.have[c.dataset.k] = true; }); close(); saveMenu(); refreshPrices().then(render); render(); });
}
function shopList() {
  const bm = basketModel(); if (!bm) return;
  const m = app.menu, mode = m.buyMode && (m.buyMode !== 'two' || bm.pair) && (m.buyMode !== 'mine' || bm.mine) ? m.buyMode : 'one';
  const lines = buyLines(bm, mode);
  const groups = {};
  for (const x of lines) (groups[x.chain] ||= []).push(x);
  const text = `Sali · покупки на ${weekLabel(m.weekStart)}\n` + Object.entries(groups).map(([c, xs]) => `\n${CHAINS[c] || c}:\n` + xs.map(x => `☐ ${x.d?.name_ru || x.e.key} — ${qtyText(x.e, x.d)}${x.l ? ` (${x.l.name}, ${x.l.kg ? amt(x.l.kg) + ' кг' : (x.l.packs || 1) + ' уп.'})` : ''}`).join('\n')).join('\n');
  sheet('Список в магазин', `<p class="mu" style="margin:0">Сети пока не дают положить товары в корзину их сайта со стороны. Скопируйте список или отправьте его себе — и закажите по нему.</p>
    <textarea class="inp" readonly style="min-height:240px;font-size:13px">${esc(text)}</textarea>
    <div style="display:flex;gap:10px">${navigator.share ? '<button class="cta" style="flex:1" data-share>Отправить</button>' : ''}<button class="${navigator.share ? 'ghost' : 'cta'}" style="flex:1" data-copy>Скопировать</button></div>`,
    el => {
      el.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(text).then(() => toast('Список скопирован'), () => { el.querySelector('textarea').select(); toast('Выделили — скопируйте'); });
      const s = el.querySelector('[data-share]'); if (s) s.onclick = () => navigator.share({ title: 'Покупки на неделю', text }).catch(() => {});
    });
}

// ---------- 7. Календарь готовки ----------
route(/^#\/calendar$/, () => {
  const nm = needMenu(); if (nm) return nm;
  const ev = cookEvents(), ti = todayIndex(), p = app.profile;
  const total = ev.reduce((a, e) => a + e.mins, 0);
  const h0 = Math.floor(Math.min(...ev.map(e => e.start), 17 * 60) / 60), h1 = Math.ceil(Math.max(...ev.map(e => e.start + e.mins), 20 * 60) / 60);
  const H = 46, hours = []; for (let h = h0; h < h1; h++) hours.push(h);
  const evAt = d => ev.filter(e => e.day === d).map(e => `<a class="ev ${e.kind}" href="#/dish/${e.slot.dayI}/${e.slot.mi}" style="top:${(e.start - h0 * 60) / 60 * H}px;height:${Math.max(22, e.mins / 60 * H - 2)}px" title="${esc(e.dishes.join(', '))}">${esc(e.dishes[0])}${e.dishes.length > 1 ? ' +' + (e.dishes.length - 1) : ''} · ${e.mins}′</a>`).join('');
  return `<div class="hd"><div><div class="sub">Неделя ${weekLabel(app.menu.weekStart)}</div><h1 class="h">Готовка в календаре</h1></div></div>
    <div class="sum"><div style="flex:1"><div class="k">У плиты за неделю</div><b>${Math.floor(total / 60)} ч ${total % 60} мин</b></div><div style="text-align:right"><div class="k">ужин в</div><b style="font-size:16px">${esc(p.times['ужин'])}</b></div></div>
    <div class="pad" style="padding-top:14px">
      <div class="cal-grid"><div></div>${DAYS.map((x, i) => `<div class="cal-hd ${i === ti ? 'today' : ''}">${x}<br>${dayDate(i).getDate()}</div>`).join('')}
        <div>${hours.map(h => `<div class="cal-hr" style="height:${H}px">${h}:00</div>`).join('')}</div>
        ${DAYS.map((x, i) => `<div class="cal-col" style="height:${hours.length * H}px;background:repeating-linear-gradient(#fff 0 ${H - 1}px,#F0F0F0 ${H - 1}px ${H}px)">${evAt(i)}</div>`).join('')}</div>
      <div class="legend" style="margin-top:10px"><span><i style="background:#137A4B"></i>готовка</span><span><i style="background:#FFE2C8"></i>заготовка на завтра</span></div>
    </div>
    <div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-top:16px">
      <div class="sec-h">Во сколько едим</div>
      ${MEAL_ORDER.filter(mm => allSlots().some(s => s.meal === mm)).map(mm => `<div class="rw"><b>${MEAL_LABEL[mm]}</b><input type="time" data-t="${mm}" value="${esc(p.times[mm])}" aria-label="Время: ${MEAL_LABEL[mm]}"></div>`).join('')}
      <div class="rw"><b>Напоминать за 15 минут</b><button class="sw" role="switch" aria-checked="${p.remind !== false}" id="remind" aria-label="Напоминать за 15 минут"><i></i></button></div>
      <button class="cta w" id="ics">${ico('cal', 20, '#fff')}Добавить в календарь телефона</button>
      <p class="mu" style="font-size:12px;margin:0">Скачается файл календаря: на iPhone он откроется в «Календаре», на Android — в Google Календаре. На компьютере: Google Календарь → Настройки → Импорт.</p>
    </div>`;
}, {
  tab: 'cal',
  after(view) {
    if (!app.menu?.plan) return bindNeedMenu(view);
    $$('[data-t]', view).forEach(i => i.onchange = () => { app.profile.times[i.dataset.t] = i.value; saveProfile(); render(); });
    $('#remind', view).onclick = () => { app.profile.remind = app.profile.remind === false; saveProfile(); render(); };
    $('#ics', view).onclick = () => {
      const blob = new Blob([icsFile()], { type: 'text/calendar;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sali-${app.menu.weekStart}.ics`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
  },
});

// ---------- 8. Настройки меню (семья) ----------
route(/^#\/family$/, () => `<div class="hd"><div><div class="sub">Настройки меню</div><h1 class="h">Кто что ест</h1></div><button class="ib" onclick="history.length > 1 ? history.back() : go('#/today')" aria-label="Закрыть">${ico('close')}</button></div>
  <div class="pad" style="display:flex;flex-direction:column;gap:18px;padding-top:12px" id="fam">
    <label class="wish"><span class="sub">Пожелания своими словами</span><textarea data-f="wish" rows="2" placeholder="Поменьше мяса, что-нибудь с чечевицей…">${esc(app.profile.wish)}</textarea></label>
    ${familyForm(true)}
    <p class="mu" style="font-size:12px;margin:0">${app.user ? 'Настройки сохраняются в аккаунте.' : 'Настройки сохраняются на этом устройстве.'} Время еды и сеть применяются сразу, остальное — при следующей сборке меню.</p>
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
  return `<div class="hero">${r.image_url ? `<img src="${esc(r.image_url)}" alt="${esc(r.name)}">` : `<div class="t" style="background:${MEAL_COLOR[(r.meals || [])[0]] || '#7A6A50'}">${esc(r.name[0])}</div>`}
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
        app.draft = { title: r.title || '', servings: r.servings || 4, minutes: r.minutes || 30, work_minutes: r.work_minutes || null, meals: r.meals || [], kind: r.kind,
          items: (r.items || []).map(i => ({ key: i.key, name: i.key ? (app.defs[i.key]?.name_ru || i.line) : (i.missing || i.line), line: i.line, amount: i.qty, unit: i.key ? (app.defs[i.key]?.base_unit || 'г') : '', guess: i.guess, pantry: !!i.pantry || !!app.defs[i.key]?.pantry })),
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
function draftIngs(dr) { return dr.items.filter(i => i.name || i.key).map(i => ({ key: i.key || null, name: i.name || app.defs[i.key]?.name_ru || '', amount: Number(i.amount) || 0, unit: i.unit || app.defs[i.key]?.base_unit || 'г', pantry: !!i.pantry })); }
function draftToSrc(dr, row) {
  return { id: row?.id, own: !!row, name: dr.title || 'Мой рецепт', portions: dr.servings || 4, minutes: dr.minutes, cook_minutes: dr.minutes, meals: dr.meals?.length ? dr.meals : undefined,
    tags: [dr.kind].filter(Boolean), ingredients: draftIngs(dr), steps: (dr.steps || []).filter(s => s.trim()) };
}
async function saveDraft(dr) {
  const row = { name: dr.title || 'Мой рецепт', portions: dr.servings || 4, minutes: dr.minutes || null, work_minutes: dr.work_minutes || null, ingredients: draftIngs(dr),
    steps: (dr.steps || []).filter(s => s.trim()), meals: dr.meals || [], tags: [dr.kind].filter(Boolean), source: dr.source };
  const q = dr.savedId ? sb.from('user_recipes').update(row).eq('id', dr.savedId) : sb.from('user_recipes').insert(row);
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  app.myRecipes = null; dr.savedId = data.id;
  return data;
}
function finishDraft(dr, row, toMenu) {
  if (toMenu && dr.for && app.menu?.plan) {
    const [d, mi, meal] = dr.for.split('/');
    putDish(+d, mi === 'new' ? null : +mi, draftToSrc(dr, row), { meal: decodeURIComponent(meal || 'ужин') });
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
      <div class="sec"><div class="sec-h">Когда подходит</div><div class="chips">${toggle('завтрак', 'Завтрак')}${toggle('обед', 'Обед')}${toggle('ужин', 'Ужин')}${toggle('в школу', 'В коробочку')}${toggle('перекус', 'Перекус')}</div>
        <div class="chips">${['мясное', 'молочное', 'парве'].map(k => `<button class="pill" aria-pressed="${dr.kind === k}" data-kind="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
      <div class="sec"><div class="sec-h">Продукты · ${dr.items.length}<button class="linkb" id="addIng">+ добавить</button></div>
        ${unknown ? `<p class="mu" style="margin:0;font-size:13px">${unknown} ${plural(unknown, 'продукт', 'продукта', 'продуктов')} не узнали — нажмите «?», чтобы выбрать, или удалите.</p>` : ''}
        <div>${dr.items.map((i, k) => { const q = toBase(i, app.defs[i.key]), u = i.key && unitPrice(i.key, priceChain()); return `<div class="ing">${i.key ? `<span class="okm">${ico('check', 12, '#fff', 3)}</span>` : `<button class="qm" data-pick="${k}" aria-label="Выбрать продукт" style="border:0">?</button>`}
          <div class="tx"><b>${esc(i.name)}</b><span>${esc(i.line && i.line !== i.name ? i.line : '')}</span></div>
          <input class="inp" data-amt="${k}" value="${esc(amt(i.amount))}" inputmode="decimal" style="width:64px;height:38px;padding:0 6px;text-align:right" aria-label="Количество"><span class="q" style="width:28px">${esc(i.unit)}</span>
          <span class="c num">${i.pantry ? 'дома' : q != null && u != null ? money(q * u, 1) : '—'}</span><button class="del" data-rm="${k}" aria-label="Убрать">${ico('close', 16, '#8A8A8A')}</button></div>`; }).join('')}</div></div>
      <div class="sec"><div class="sec-h">Как готовить · ${dr.steps.length}<button class="linkb" id="addStep">+ шаг</button></div>
        ${dr.steps.map((s, k) => `<div class="step"><i>${k + 1}</i><textarea class="inp" data-step="${k}" style="min-height:60px;flex:1">${esc(s)}</textarea></div>`).join('')}</div>
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
    ensureUnits(dr.items.map(i => i.key)).then(() => { if (location.hash === '#/review' && !view.contains(document.activeElement)) rer(); });
    $$('[data-dr]', view).forEach(i => i.oninput = () => { dr[i.dataset.dr] = i.dataset.dr === 'minutes' ? Number(i.value) || null : i.value; keep(); });
    $$('[data-sv]', view).forEach(b => b.onclick = () => { const n = Math.max(1, Math.min(30, dr.servings + +b.dataset.sv)), k = n / dr.servings; dr.items.forEach(i => i.amount = Math.round(i.amount * k * 10) / 10); dr.servings = n; rer(); });
    $$('[data-meal]', view).forEach(b => b.onclick = () => { const m = b.dataset.meal; dr.meals ||= []; dr.meals.includes(m) ? dr.meals.splice(dr.meals.indexOf(m), 1) : dr.meals.push(m); rer(); });
    $$('[data-kind]', view).forEach(b => b.onclick = () => { dr.kind = dr.kind === b.dataset.kind ? null : b.dataset.kind; rer(); });
    $$('[data-amt]', view).forEach(i => i.onchange = () => { dr.items[+i.dataset.amt].amount = Number(String(i.value).replace(',', '.')) || 0; rer(); });
    $$('[data-rm]', view).forEach(b => b.onclick = () => { dr.items.splice(+b.dataset.rm, 1); rer(); });
    $$('[data-step]', view).forEach(t => t.oninput = () => { dr.steps[+t.dataset.step] = t.value; keep(); });
    $('#addStep', view).onclick = () => { dr.steps.push(''); rer(); };
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
      const words = s.split(/\s+/).filter(Boolean).map(w => w.slice(0, Math.max(3, w.length - 2)));
      const f = all.filter(g => words.every(w => g.name_ru.toLowerCase().includes(w))).sort((a, b) => a.name_ru.length - b.name_ru.length).slice(0, 12);
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
        <a href="#/calendar">${ico('cal', 22)}<span>Время еды и напоминания</span></a>
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
