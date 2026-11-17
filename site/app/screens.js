/* Sali — экраны меню: вводные, сборка, сегодня, неделя, блюдо, замена, готовка. */
'use strict';

// ---------- форма семьи (вводные и настройки) ----------
function familyForm(full) {
  const p = app.profile;
  const meal = m => {
    const v = p.meals[m];
    return `<div class="ml"><button type="button" class="sw" role="switch" aria-checked="${v.on}" data-meal="${m}" aria-label="${MEAL_LABEL[m]}"><i></i></button><b>${MEAL_LABEL[m]}</b>
      <span class="mu">${v.on ? (v.days.length === 7 ? 'каждый день' : v.days.length ? v.days.slice().sort().map(i => DAYS[i]).join(', ') : 'выберите дни') : 'нет'}</span>
      ${v.on && m === 'в школу' ? `<span class="stp" role="group" aria-label="Сколько коробочек"><button type="button" data-step="boxes.-1" aria-label="Меньше">−</button><b>${boxes(p)}</b><button type="button" data-step="boxes.1" aria-label="Больше">+</button></span>` : ''}
      ${v.on ? `<div class="dd" role="group" aria-label="Дни: ${MEAL_LABEL[m]}">${DAYS.map((d, i) => `<button type="button" aria-pressed="${v.days.includes(i)}" data-day="${m}.${i}">${d}</button>`).join('')}</div>` : ''}</div>`;
  };
  const diets = ['кашрут', 'вегетарианское', 'без глютена', 'без лактозы'];
  return `
  <div class="ml" style="border:0"><b>На сколько человек готовим</b><span class="stp" role="group" aria-label="Сколько человек"><button type="button" data-step="people.-1" aria-label="Меньше">−</button><b>${eaters(p)}</b><button type="button" data-step="people.1" aria-label="Больше">+</button></span></div>
  <div class="sec"><div class="sec-h">Какие приёмы пищи планировать</div>
    <div>${MEAL_ORDER.map(meal).join('')}
      <div class="ml"><button type="button" class="sw" role="switch" aria-checked="${p.friday.on}" data-friday aria-label="Ужин в пятницу с гостями"><i></i></button><b>Ужин в пятницу с гостями</b>
        ${p.friday.on ? `<span class="stp" role="group" aria-label="Сколько человек"><button type="button" data-guests="-1" aria-label="Меньше">−</button><b>${p.friday.guests}</b><button type="button" data-guests="1" aria-label="Больше">+</button></span>` : '<span class="mu">нет</span>'}</div>
    </div></div>
  <div class="sec"><div class="sec-h">Ограничения</div>
    <div class="chips">${diets.map(d => `<button type="button" class="pill" aria-pressed="${p.diet.includes(d)}" data-diet="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div>
    <label class="lbl">Аллергии и что нельзя — строго исключим<input class="inp" data-f="allergies" value="${esc(p.allergies)}" placeholder="например: орехи, кунжут"></label>
    <label class="lbl">Не любят<input class="inp" data-f="dislikes" value="${esc(p.dislikes)}" placeholder="грибы, баклажаны"></label>
  </div>
  <div class="row2">
    <label class="lbl">Готовка в будни
      <select class="inp" data-f="maxMin">${[20, 30, 40, 60].map(n => `<option value="${n}" ${+p.maxMin === n ? 'selected' : ''}>до ${n} мин</option>`).join('')}</select></label>
    <label class="lbl">Бюджет на неделю, ₪<input class="inp" data-f="budget" inputmode="numeric" value="${esc(p.budget)}" placeholder="необязательно"></label>
  </div>
  ${full ? `
  <label class="lbl">Любимые блюда и продукты<input class="inp" data-f="likes" value="${esc(p.likes)}" placeholder="шницель, паста, гречка"></label>
  <label class="lbl">Кухня
    <select class="inp" data-f="cuisine">${[['домашняя русская и израильская, привычные блюда', 'Домашняя русская + израильская'], ['в основном израильская и средиземноморская', 'Израильская, средиземноморская'], ['разнообразно: европейская, азиатская, израильская', 'Разнообразно']]
      .map(([v, t]) => `<option value="${esc(v)}" ${p.cuisine === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
  <label class="lbl">Обычно покупаю в
    <select class="inp" data-f="chain"><option value="">— посчитаем, где выгоднее —</option>${Object.entries(CHAINS).map(([k, v]) => `<option value="${k}" ${p.chain === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}`;
}
function bindFamilyForm(view, rerender) {
  const p = app.profile;
  view.addEventListener('input', e => {
    const f = e.target.dataset.f; if (!f) return;
    const path = f.split('.'); let o = p;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    let v = e.target.value; if (f === 'maxMin') v = Number(v);
    o[path[path.length - 1]] = v; saveProfile();
    if (f === 'wish' || f.endsWith('.name') || f.endsWith('.age')) return;
  });
  view.addEventListener('change', e => { if (e.target.dataset.f === 'chain' && app.menu) { app.menu.chain = e.target.value; saveMenu(); schedulePrices(); } });
  view.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.meal) { p.meals[d.meal].on = !p.meals[d.meal].on; }
    else if (d.day) { const [m, i] = d.day.split('.'); const a = p.meals[m].days, n = +i; a.includes(n) ? a.splice(a.indexOf(n), 1) : a.push(n); }
    else if (d.friday != null) { p.friday.on = !p.friday.on; }
    else if (d.guests) { p.friday.guests = Math.max(2, Math.min(30, p.friday.guests + +d.guests)); }
    else if (d.diet) { p.diet.includes(d.diet) ? p.diet.splice(p.diet.indexOf(d.diet), 1) : p.diet.push(d.diet); }
    else if (d.step) { const [k, n] = d.step.split('.'); p[k] = Math.max(1, Math.min(k === 'people' ? 20 : 8, (k === 'people' ? eaters(p) : boxes(p)) + +n)); }
    else if (d.week) { p.weekMode = d.week; }
    else return;
    saveProfile(); rerender();
  });
}

// ---------- 1. Вводные ----------
route(/^#\/start$/, () => {
  const p = app.profile, n = plannedCount();
  const ws = weekStartFor(p.weekMode), wsThis = weekStartFor('this'), wsNext = weekStartFor('next');
  return `<div class="pad" style="display:flex;flex-direction:column;gap:18px;padding-top:6px">
    <div><div class="sub">Меню на ${weekLabel(ws)}</div><h1 class="big">Что хочется на этой неделе?</h1></div>
    <label class="wish"><span class="sub">Напишите своими словами</span>
      <textarea data-f="wish" rows="3" placeholder="Поменьше мяса, что-нибудь с чечевицей. Во вторник нет времени готовить. Дети не едят грибы.">${esc(p.wish)}</textarea></label>
    <div class="seg" role="group" aria-label="Какая неделя">
      <button type="button" data-week="this" aria-pressed="${ws === wsThis}">Эта неделя · ${weekLabel(wsThis)}</button>
      <button type="button" data-week="next" aria-pressed="${ws === wsNext}">Следующая · ${weekLabel(wsNext)}</button></div>
    ${familyForm(false)}
    <details><summary class="linkb" style="list-style:none;cursor:pointer">Ещё настройки: любимое, кухня, время еды, своя сеть</summary><div style="display:flex;flex-direction:column;gap:14px;margin-top:12px" id="more"></div></details>
    <button class="cta w" id="go" ${n ? '' : 'disabled'}>Собрать меню · ${n} ${plural(n, 'приём', 'приёма', 'приёмов')} пищи</button>
    ${app.menu ? `<a class="linkb" href="#/today" style="text-align:center">Вернуться к текущему меню</a>` : ''}
    <p class="mu" style="font-size:12px;margin:0 0 20px">Меню составляет модель ИИ — около минуты. При аллергиях всегда проверяйте состав на упаковке.</p>
  </div>`;
}, {
  after(view) {
    const more = $('#more', view);
    const fill = () => { more.innerHTML = familyForm(true).split('<label class="lbl">Любимые блюда')[1] ? '<label class="lbl">Любимые блюда' + familyForm(true).split('<label class="lbl">Любимые блюда')[1] : ''; };
    fill();
    bindFamilyForm(view.firstElementChild, () => { const y = scrollY, open = $('details', view).open; render(); $('details', $('#view')).open = open; scrollTo(0, y); });
    $('#go', view).onclick = () => {
      if (!plannedCount()) { toast('Включите хотя бы один приём пищи'); return; }
      if (app.menu?.plan) confirmSheet('Собрать новое меню?', app.user ? 'Текущее меню останется в «Моих меню».' : 'Текущее меню на этом устройстве заменится новым. Чтобы не потерять его — сначала сохраните в аккаунт.', 'Собрать новое', buildMenu);
      else buildMenu();
    };
  },
});

// ---------- 2. Сборка ----------
route(/^#\/building$/, () => {
  const b = app.build;
  if (!b) { setTimeout(() => go(app.menu ? '#/today' : '#/start')); return ''; }
  const pics = (app.lib || []).filter(r => r.thumb_url).slice(0, 40);
  const pick = [0, 1, 2, 3].map(i => pics[(i * 7 + 3) % (pics.length || 1)]).filter(Boolean);
  const pos = [[0, 105], [105, 210], [210, 105], [105, 0]];
  const st = (i, text) => `<div class="st ${b.step > i ? 'done' : b.step === i ? 'now' : 'wait'}"><span class="ck">${b.step > i ? ico('check', 16, '#fff', 3) : ''}</span>${text}</div>`;
  const center = b.step === 0 ? `<b>${ico('clock', 34, '#137A4B')}</b><span>около минуты</span>` : `<b class="num">${b.done}/${b.total}</b><span>рецептов готово</span>`;
  return `<div class="build">
    <div class="orbit-box"><div class="orbit-ring"></div><div class="orbit-c"><div>${center}</div></div>
      <div class="orbit" aria-hidden="true">${pick.map((r, i) => `<img src="${esc(r.thumb_url)}" alt="" style="top:${pos[i][0]}px;left:${pos[i][1]}px">`).join('')}</div></div>
    <h1 class="h" style="text-align:center;margin:0 0 10px">${b.error ? 'Не получилось собрать меню' : 'Собираем вашу неделю…'}</h1>
    ${b.error ? `<div class="err">${esc(b.error)}</div><div style="display:flex;gap:10px;margin-top:14px"><button class="cta" style="flex:1" data-go="#/start">Изменить вводные</button><button class="ghost" style="flex:1" id="retry">Ещё раз</button></div>` : `
    ${st(0, b.step > 0 ? esc(b.msg) : 'Подбираем блюда под ваш запрос')}
    ${st(1, 'Пишем рецепты и считаем продукты')}
    ${st(2, 'Сравниваем цены в 7 сетях')}
    ${st(3, 'Расставляем готовку по календарю')}
    <div class="tip" style="margin-top:22px"><b>Блюда повторяются с умом:</b> что-то готовим на два дня, а продукты одного блюда идут в другое — покупаете меньше и почти ничего не выбрасываете.</div>`}
  </div>`;
}, { after(view) { const r = $('#retry', view); if (r) r.onclick = buildMenu; if (!app.lib) loadLib().then(() => location.hash === '#/building' && render()).catch(() => {}); } });

// ---------- общее для меню ----------
function needMenu() {
  if (app.menu?.plan?.dishes?.length) return null;
  return `<div class="empty"><div style="width:64px;height:64px">${IC.logo.replace(/30/g, '64')}</div><h1 class="h">Меню ещё нет</h1><p>Расскажите о семье и пожеланиях — соберём меню на неделю с рецептами, корзиной и ценами в 7 сетях.</p>
    <a class="cta" href="#/start">Собрать меню</a>${app.user ? '' : `<button class="linkb" data-act="login">У меня уже есть аккаунт — войти</button>`}</div>`;
}
function bindNeedMenu(view) { const b = $('[data-act="login"]', view); if (b) b.onclick = () => login('#/today'); }
function basketDock() {
  if (!app.menu?.plan) return '';
  const r = weekRange(), n = app.menu.basket?.qty ? buyKeys().length : 0;
  return `<div class="dock-in"><a class="dock-link" href="#/basket"><span class="dock-ic">${ico('cart', 22, '#137A4B')}</span>
    <span style="display:flex;flex-direction:column;min-width:0"><b style="font:800 15px Heebo,sans-serif">Показать корзину</b><span class="mu num" style="font:600 12px Heebo,sans-serif">${n ? `${n} ${plural(n, 'продукт', 'продукта', 'продуктов')}${r ? ' · от ' + moneyR(r.from) : ''}` : 'считаем цены…'}</span></span></a>
    <a class="cta sm" href="#/basket?buy=1">Купить на неделю</a></div>`;
}
function menuHead(sub) {
  const m = app.menu, p = m.profile || app.profile;
  return `<div class="hd"><div><div class="sub">${weekLabel(m.weekStart)} · ${eaters(p)} ${plural(eaters(p), 'человек', 'человека', 'человек')}</div><h1 class="h">${sub || 'Меню недели'}</h1></div>
    <a class="ib" href="#/family" aria-label="Настройки меню">${ico('gear')}</a></div>`;
}
function rangeBox() {
  const r = weekRange();
  const per = r ? [r.from / totalPortions(), r.to / totalPortions()] : null;
  return `<div class="sum"><div style="flex:1"><div class="k">Неделя обойдётся</div><b class="num">${r ? (Math.round(r.from) === Math.round(r.to) ? moneyR(r.from) : `${Math.round(r.from)}–${moneyR(r.to)}`) : '<span class="spin"></span>'}</b></div>
    <div style="text-align:right"><div class="k">за порцию</div><b class="num" style="font-size:16px">${per ? (per[0].toFixed(2) === per[1].toFixed(2) ? money(per[0], 1) : `${per[0].toFixed(2).replace('.', ',')}–${money(per[1], 1)}`) : '—'}</b></div></div>`;
}
function saveBanner() {
  if (app.user || !app.menu?.plan) return '';
  return `<div class="banner"><span style="flex:1">Меню пока только на этом устройстве. Сохраните — и откроете его с любого телефона.</span><button class="cta sm" data-act="save2">Сохранить</button></div>`;
}
function bindSave(view) { const b = $('[data-act="save2"]', view); if (b) b.onclick = () => askLogin('Сохраним меню', 'Войдите через Google — меню останется в аккаунте, и к нему можно вернуться с любого устройства.'); }

// ---------- 3. Сегодня ----------
route(/^#\/today$/, () => {
  const nm = needMenu(); if (nm) return nm;
  const m = app.menu, ti = todayIndex();
  if (app.ui.day == null) app.ui.day = ti >= 0 ? ti : 0;
  const d = app.ui.day, date = dayDate(d), ss = slots(d);
  const cost = ss.reduce((a, s) => a + (slotCost(s) || 0), 0), por = ss.reduce((a, s) => a + (s.leftovers ? 0 : portionsOf(s)), 0);
  const tomorrow = d < 6 ? slots(d + 1).filter(s => s.meal === 'в школу' && !s.leftovers) : [];
  const title = d === ti ? `Сегодня, ${DAYS_FULL[d]}` : `${DAYS_FULL[d][0].toUpperCase() + DAYS_FULL[d].slice(1)}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const card = s => {
    const c = slotCost(s), dish = s.dish, r = recipeOf(dish.id), por = portionsOf(s);
    return `<div class="slot">
      <a class="mc" href="#/dish/${d}/${s.mi}"><div class="pic">${tile(dish, 't', s.meal)}<button class="swb" data-go="#/swap/${d}/${s.mi}" aria-label="Заменить: ${esc(dish.name)}">${ico('swap', 15)}Заменить</button></div>
      <div class="mb"><div class="rowi"><span class="lk ${s.meal === 'в школу' ? 'o' : ''}">${esc(MEAL_LABEL[s.meal] || s.meal)}</span>${s.leftovers ? '<span class="lk gr">остатки</span>' : ''}<span class="pr num">${s.leftovers ? '0 ₪' : c != null ? money(c, 1) : r ? '—' : '<span class="spin"></span>'}</span></div>
      <div class="mt">${esc(dish.name)}</div>
      <div class="rowi"><span>${por} ${plural(por, 'порция', 'порции', 'порций')}${!s.leftovers && c ? ' · ' + money(c / Math.max(1, dish.portions), 1) + ' за порцию' : ''}</span><span style="margin-inline-start:auto">${s.leftovers ? 'приготовлено раньше' : s.meal === 'в школу' ? 'готово с вечера' : (dish.cook_minutes || '?') + ' мин'}</span></div></div></a></div>`;
  };
  return `${menuHead()}${saveBanner()}${rangeBox()}
    <div class="days" role="group" aria-label="День недели">${DAYS.map((x, i) => `<button class="d ${i === ti ? 'today' : ''}" aria-pressed="${i === d}" data-day="${i}" aria-label="${DAYS_FULL[i]}, ${dayDate(i).getDate()}">${x}<b>${dayDate(i).getDate()}</b><i>${slots(i).map(() => '<s></s>').join('')}</i></button>`).join('')}</div>
    <div class="pad" style="padding-top:16px;display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2 class="h2">${title}</h2>
      <span class="mu num" style="font:700 14px Heebo,sans-serif">${ss.length ? `${money(cost, 1)}${por ? ' · ' + money(cost / Math.max(1, eaters(m.profile || app.profile)), 1) + ' на человека' : ''}` : ''}</span></div>
    <div class="slots">${ss.length ? ss.map(card).join('') : `<div class="note wide">${ico('bulb', 22, '#8A6400')}<span>На этот день ничего не запланировано.</span></div>`}
      <button class="add wide" id="addMeal">+ Добавить приём пищи или своё блюдо</button>
      ${tomorrow.length ? `<div class="note wide">${ico('bulb', 22, '#8A6400')}<span><b>На завтра:</b> вечером собрать коробочку — ${esc(tomorrow.map(s => s.dish.name).join(', '))}.</span></div>` : ''}
    </div>`;
}, {
  tab: 'menu', dock: basketDock,
  after(view) {
    bindNeedMenu(view); bindSave(view);
    $$('[data-day]', view).forEach(b => b.onclick = () => { app.ui.day = +b.dataset.day; render(); });
    const a = $('#addMeal', view); if (a) a.onclick = () => addMealSheet(app.ui.day);
    if (app.menu?.plan) {
      refreshImages().then(() => {});
      if (basketStale(app.menu)) schedulePrices();
      else { const k = unpricedKeys(); if (k.length && !timers.unpriced) { timers.unpriced = 1; ensureUnits(k).then(() => { timers.unpriced = 0; render(); }); } }
    }
  },
});
function addMealSheet(d) {
  sheet(`Добавить · ${DAYS_FULL[d]}`, `<p class="mu" style="margin:0">Какой приём пищи?</p><div class="chips">${MEAL_ORDER.map(m => `<button class="pill" data-m="${m}">${MEAL_LABEL[m]}</button>`).join('')}</div>`,
    (el, close) => $$('[data-m]', el).forEach(b => b.onclick = () => { close(); go(`#/swap/${d}/new/${encodeURIComponent(b.dataset.m)}`); }));
}

// ---------- 4. Неделя ----------
route(/^#\/week$/, () => {
  const nm = needMenu(); if (nm) return nm;
  const ti = todayIndex(), r = weekRange();
  const row = s => {
    const c = slotCost(s), por = portionsOf(s);
    return `<a class="m" href="#/dish/${s.dayI}/${s.mi}"><span class="th">${imgOf(s.dish) ? `<img src="${esc(imgOf(s.dish))}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span class="t" style="width:100%;height:100%;font-size:15px;background:${MEAL_COLOR[s.meal]}">${esc(s.dish.name[0])}</span>`}</span>
      <span class="mi"><b>${esc(s.dish.name)}</b><span>${esc(MEAL_SHORT[s.meal] || s.meal)} · ${s.leftovers ? 'остатки' : por + ' ' + plural(por, 'порция', 'порции', 'порций')}</span></span><span class="p num">${s.leftovers ? '0' : c != null ? money(c, 1).replace(' ₪', '') : '—'}</span></a>`;
  };
  return `${menuHead()}${saveBanner()}
    <div class="seg" style="margin:12px 18px 0" role="group" aria-label="Вид"><button aria-pressed="false" data-go="#/today">День</button><button aria-pressed="true">Неделя</button></div>
    <div class="pad" style="padding-top:12px;display:flex;gap:8px">
      <div class="fact" style="flex:1.4"><span>Неделя</span><b class="num">${r ? `${Math.round(r.from)}–${moneyR(r.to)}` : '…'}</b></div>
      <div class="fact" style="flex:1"><span>За порцию</span><b class="num">${r ? (r.from / totalPortions()).toFixed(2).replace('.', ',') + '–' + (r.to / totalPortions()).toFixed(2).replace('.', ',') : '—'}</b></div>
      <div class="fact" style="flex:.7"><span>Приёмов</span><b>${allSlots().length}</b></div></div>
    ${app.menu.plan.summary || (app.menu.plan.notes || []).length ? `<div class="card" style="margin:12px 18px 0"><b>Идея меню</b>${app.menu.plan.summary ? `<span>${esc(app.menu.plan.summary)}</span>` : ''}
      ${(app.menu.plan.notes || []).map(n => `<span class="mu" style="font-size:13px">• ${esc(n)}</span>`).join('')}</div>` : ''}
    <p class="mu pad" style="font-size:12px;margin:8px 0 0">«От» — самая выгодная сеть, «до» — ${app.menu.chain || app.profile.chain ? 'ваша сеть' : 'самая дорогая из сетей, где есть всё'}.</p>
    <div class="wk">${DAYS.map((x, i) => `<div class="day ${i === ti ? 'now' : ''}"><div class="dn"><b>${dayDate(i).getDate()}</b><span>${x}</span></div>
      <div class="ms">${slots(i).map(row).join('') || '<span class="mu" style="font-size:13px;padding-top:12px">ничего не готовим</span>'}<button class="linkb" style="align-self:flex-start;font-size:13px" data-add="${i}">+ добавить</button></div></div>`).join('')}</div>`;
}, { tab: 'menu', dock: basketDock, after(view) { bindNeedMenu(view); bindSave(view); $$('[data-add]', view).forEach(b => b.onclick = () => addMealSheet(+b.dataset.add)); } });

// ---------- 5. Блюдо ----------
route(/^#\/dish\/(\d)\/(\d+)$/, (d, mi) => {
  const nm = needMenu(); if (nm) return nm;
  const s = slots(+d).find(x => x.mi === +mi); if (!s) { setTimeout(() => go('#/today')); return ''; }
  const dish = s.dish, r = recipeOf(dish.id), date = dayDate(+d), c = dishCost(dish);
  const chain = priceChain();
  const ingRow = i => {
    const q = toBase(i, app.defs[i.key]), u = i.key && unitPrice(i.key, chain), have = i.pantry || app.menu.have?.[i.key];
    const cost = q != null && u != null ? q * u : null;
    return `<div class="ing"><div class="tx"><b>${esc(i.name)}</b>${i.name_he ? `<span class="he" dir="rtl">${esc(i.name_he)}</span>` : ''}</div>
      <span class="q">${i.unit === 'по вкусу' ? 'по вкусу' : amt(i.amount) + ' ' + esc(i.unit)}</span><span class="c num ${have ? 'mu' : ''}">${have ? 'есть дома' : cost != null ? money(cost, 1) : '—'}</span></div>`;
  };
  const th = imgOf(dish), full = fullImgOf(dish);
  return `<div class="hero">${full ? `<img src="${esc(th || full)}" ${th && full && th !== full ? `srcset="${esc(th)} 640w, ${esc(full)} 1200w" sizes="(min-width: 700px) 1040px, 100vw"` : ''} alt="${esc(dish.name)}">` : tile(dish, 't', s.meal)}
      <button class="ib back" onclick="history.length > 1 ? history.back() : go('#/today')" aria-label="Назад">${ico('back')}</button>
      <button class="swb" data-go="#/swap/${d}/${mi}" style="top:12px;right:12px">${ico('swap', 15)}Заменить</button></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:14px;padding-top:14px">
      <div><div class="rowi"><span class="lk">${DAYS[+d]}, ${date.getDate()} ${MONTHS[date.getMonth()]} · ${esc(MEAL_SHORT[s.meal])}</span>${(dish.tags || []).filter(t => ['мясное', 'молочное', 'парве', 'вегетарианское'].includes(t)).map(t => `<span class="lk gr">${esc(t)}</span>`).join('')}</div>
        <h1 class="h" style="margin-top:8px">${esc(dish.name)}</h1>${dish.description ? `<p class="mu" style="margin:6px 0 0">${esc(dish.description)}</p>` : ''}</div>
      <div class="facts"><div class="fact"><span>Всё блюдо</span><b class="num">${c != null ? money(c, 1) : '—'}</b></div><div class="fact"><span>За порцию</span><b class="num">${c != null ? money(c / Math.max(1, dish.portions), 1) : '—'}</b></div><div class="fact"><span>На порцию</span><b class="num">${dish.kcal ? dish.kcal + ' ккал' : '—'}</b></div></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><b>Порций</b><span class="stp" role="group" aria-label="Порций"><button data-por="-1" aria-label="Меньше">−</button><b>${dish.portions}</b><button data-por="1" aria-label="Больше">+</button></span></div>
      ${s.leftovers ? `<div class="when">${ico('bulb', 20, '#0D5A37')}<span>В этот день едим приготовленное раньше — готовить не нужно.</span></div>` :
        `<div class="when">${ico('clock', 20, '#0D5A37')}<span>${dish.cook_minutes || '?'} мин${s.meal === 'в школу' ? ' · можно собрать с вечера' : ''}</span></div>`}
      <div class="sec"><div class="sec-h">Продукты${chain ? `<small>цены в ${esc(CHAINS[chain] || chain)}</small>` : ''}</div>
        ${r ? `<div>${(r.ingredients || []).map(ingRow).join('')}</div>${r.scaled_from ? `<p class="mu" style="font-size:12px;margin:0">Количества пересчитаны на ${dish.portions} порц.</p>` : ''}
        <a href="#/basket" style="font:700 14px Heebo,sans-serif">Продукты этого блюда уже в корзине недели — посмотреть</a>`
        : `<p class="mu" style="margin:0"><span class="spin"></span> Рецепт загружается…</p>`}</div>
      ${r ? `<div class="sec"><div class="sec-h">Как готовить · ${(r.steps || []).length} ${plural((r.steps || []).length, 'шаг', 'шага', 'шагов')}</div>
        ${(r.steps || []).map((t, i) => `<div class="step"><i>${i + 1}</i><span>${esc(t)}</span></div>`).join('')}
        ${r.tip ? `<div class="note">${ico('bulb', 20, '#8A6400')}<span>${esc(r.tip)}</span></div>` : ''}</div>` : ''}
      <div style="display:flex;gap:10px;margin-bottom:20px"><button class="cta" style="flex:1.4" id="cookGo" ${r ? '' : 'disabled'}>Начать готовить</button><a class="ghost" style="flex:1" href="#/swap/${d}/${mi}">Заменить</a></div>
    </div>`;
}, {
  tab: 'menu',
  after(view, d, mi) {
    const s = slots(+d).find(x => x.mi === +mi); if (!s) return;
    $$('[data-por]', view).forEach(b => b.onclick = () => { setPortions(s.dish, Math.max(1, Math.min(30, s.dish.portions + +b.dataset.por))); render(); });
    const c = $('#cookGo', view); if (c) c.onclick = () => cookMode(s.dish);
    if (!recipeOf(s.dish.id)) loadRecipeFor(s.dish).then(render).catch(e => toast('Рецепт не загрузился: ' + e.message));
  },
});

// ---------- режим готовки ----------
function cookMode(dish) {
  const r = recipeOf(dish.id); if (!r) return;
  const pages = [{ ing: true }, ...(r.steps || []).map((t, i) => ({ t, i }))];
  let k = 0;
  const el = document.createElement('div'); el.className = 'cook'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Готовим: ' + dish.name);
  document.body.appendChild(el);
  let lock; try { navigator.wakeLock?.request('screen').then(l => lock = l).catch(() => {}); } catch (e) {}
  const close = () => { el.remove(); try { lock?.release(); } catch (e) {} };
  const draw = () => {
    const p = pages[k];
    el.innerHTML = `<div class="cook-top"><b style="flex:1;font:800 16px Heebo,sans-serif">${esc(dish.name)}</b><button class="ib" data-x aria-label="Закрыть">${ico('close')}</button></div>
      <div class="bar"><i style="width:${(k + 1) / pages.length * 100}%"></i></div>
      <div class="cook-body">${p.ing ? `<span class="n">Сначала достаньте продукты</span>${(r.ingredients || []).map(i => `<label class="ing"><input type="checkbox" class="chk"><div class="tx"><b>${esc(i.name)}</b></div><span class="q">${i.unit === 'по вкусу' ? 'по вкусу' : amt(i.amount) + ' ' + esc(i.unit)}</span></label>`).join('')}`
        : `<span class="n">Шаг ${p.i + 1} из ${r.steps.length}</span><p>${esc(p.t)}</p>`}</div>
      <div class="cook-nav"><button class="ghost" data-p ${k ? '' : 'disabled'}>Назад</button><button class="cta" data-n>${k < pages.length - 1 ? 'Дальше' : 'Готово'}</button></div>`;
    el.querySelector('[data-x]').onclick = close;
    el.querySelector('[data-p]').onclick = () => { k--; draw(); };
    el.querySelector('[data-n]').onclick = () => { if (k < pages.length - 1) { k++; draw(); } else { close(); toast('Приятного аппетита!'); } };
  };
  draw();
}

// ---------- 6. Замена ----------
route(/^#\/swap\/(\d)\/(\d+|new)(?:\/([^/?]+))?/, (d, mi, mealArg) => {
  const nm = needMenu(); if (nm) return nm;
  const isNew = mi === 'new', s = isNew ? null : slots(+d).find(x => x.mi === +mi);
  if (!isNew && !s) { setTimeout(() => go('#/today')); return ''; }
  const meal = isNew ? decodeURIComponent(mealArg || 'ужин') : s.meal;
  const cur = s?.dish, cc = cur ? dishCost(cur) : null;
  const tabs = [['similar', 'Похожее'], ['cheap', 'Дешевле'], ['fast', 'Быстрее'], ['basket', 'Из того, что в корзине'], ['kids', 'Подходит детям'], ['mine', 'Мои рецепты']];
  const tab = app.ui.swapTab || 'similar';
  return `<div class="hd"><div><div class="sub">${isNew ? 'Добавить' : 'Заменить'} · ${DAYS[+d]}, ${esc(MEAL_SHORT[meal])}</div><h1 class="h">${isNew ? esc(MEAL_LABEL[meal]) : esc(cur.name)}</h1></div>
      <button class="ib" onclick="history.back()" aria-label="Закрыть">${ico('close')}</button></div>
    ${cur ? `<p class="pad mu num" style="margin:4px 0 0;font:700 14px Heebo,sans-serif">Сейчас: ${cc != null ? money(cc, 1) : '—'} · ${cur.cook_minutes || '?'} мин</p>` : ''}
    <div class="pad" style="padding-top:12px"><div class="hscroll" role="group" aria-label="Подборка">${tabs.map(([k, t]) => `<button class="pill" aria-pressed="${tab === k}" data-tab="${k}">${t}</button>`).join('')}</div></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-top:12px" id="opts"><p class="mu"><span class="spin"></span> Подбираем варианты…</p></div>
    <div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-top:14px">
      <div class="sec-h" style="font-size:14px;color:var(--mu)">Своё</div>
      <a class="op" href="#/new?for=${d}/${mi}/${encodeURIComponent(meal)}"><span class="t" style="background:#E8F5EE;color:#137A4B;width:64px;height:64px;border-radius:12px">${ico('plus', 26, '#137A4B')}</span><span class="oi"><b>Добавить свой рецепт</b><span>текстом, ссылкой или фото страницы — посчитаем цену</span></span></a>
      ${cur ? `<button class="op" id="rm"><span class="t" style="background:#F2F2F2;color:#5C5C5C;width:64px;height:64px;border-radius:12px">${ico('trash', 24, '#5C5C5C')}</span><span class="oi"><b>Убрать — едим остатки</b><span>${cc ? 'освободит ' + money(cc, 1) : 'уберём этот приём пищи'}</span></span></button>` : ''}
    </div>`;
}, {
  tab: 'menu',
  async after(view, d, mi, mealArg) {
    const isNew = mi === 'new', s = isNew ? null : slots(+d).find(x => x.mi === +mi);
    const meal = isNew ? decodeURIComponent(mealArg || 'ужин') : s?.meal;
    $$('[data-tab]', view).forEach(b => b.onclick = () => { app.ui.swapTab = b.dataset.tab; render(); });
    const rm = $('#rm', view);
    if (rm) rm.onclick = () => { removeSlot(+d, +mi); toast('Убрали из меню'); go('#/today'); };
    const box = $('#opts', view), tab = app.ui.swapTab || 'similar';
    try {
      let list;
      if (tab === 'mine') {
        if (!app.user) { box.innerHTML = `<div class="card"><b>Свои рецепты хранятся в аккаунте</b><span class="mu">Войдите, чтобы добавлять бабушкины и любимые рецепты и ставить их в меню.</span><button class="gbtn" id="lg">${IC.google}Войти через Google</button></div>`; $('#lg', box).onclick = () => login(location.hash); return; }
        list = (await myRecipes()).map(r => ({ ...r, own: true, cook_minutes: r.minutes }));
      } else {
        const lib = await loadLib();
        const inMenu = new Set(app.menu.plan.dishes.map(x => x.recipe_id).filter(Boolean));
        list = lib.filter(r => (r.meals || []).includes(meal) && !inMenu.has(r.id) && fitsFamily(r)).map(r => ({ ...r, lib: true }));
      }
      const cur = s?.dish;
      await ensureUnits(list.slice(0, 80).flatMap(r => (r.ingredients || []).map(i => i.key)));
      list.forEach(r => { r._cost = ingsCost(scaleIngs(r.ingredients || [], (cur?.portions || r.portions || 4) / (r.portions || 4))).sum; });
      const curCost = cur ? dishCost(cur) : null, curMin = cur?.cook_minutes || 999;
      const basketKeys = new Set(weekNeed().filter(e => !e.pantry).map(e => e.key));
      const overlap = r => { const ks = (r.ingredients || []).filter(i => !i.pantry && i.key).map(i => i.key); return ks.length ? ks.filter(k => basketKeys.has(k)).length / ks.length : 0; };
      const curWords = new Set((cur?.name || '').toLowerCase().split(/[^а-яёa-z]+/).filter(w => w.length > 3).map(w => w.slice(0, 5)));
      const sim = r => { let n = 0; for (const w of r.name.toLowerCase().split(/[^а-яёa-z]+/)) if (w.length > 3 && curWords.has(w.slice(0, 5))) n++; return n + (cur?.tags || []).filter(t => (r.tags || []).includes(t)).length * 0.3; };
      if (tab === 'similar') list.sort((a, b) => sim(b) - sim(a) || (a._cost - b._cost));
      if (tab === 'cheap') list = list.filter(r => r._cost > 0 && (curCost == null || r._cost < curCost)).sort((a, b) => a._cost - b._cost);
      if (tab === 'fast') list = list.filter(r => (r.cook_minutes || 99) < curMin).sort((a, b) => (a.cook_minutes || 99) - (b.cook_minutes || 99));
      if (tab === 'basket') list = list.map(r => ({ ...r, _ov: overlap(r) })).filter(r => r._ov >= 0.5).sort((a, b) => b._ov - a._ov);
      if (tab === 'kids') list = list.filter(r => (r.tags || []).some(t => ['для детей', 'для сада', 'ребёнок любит', 'в школу', 'любимое'].includes(t)) || (r.meals || []).includes('в школу'));
      list = list.slice(0, 14);
      if (!list.length) { box.innerHTML = `<p class="mu" style="margin:0">${tab === 'mine' ? 'Своих рецептов пока нет — добавьте первый ниже.' : 'В этой подборке ничего не нашлось — попробуйте другую.'}</p>`; return; }
      box.innerHTML = list.map((r, i) => {
        const delta = curCost != null && r._cost ? r._cost - curCost : null;
        return `<button class="op" data-i="${i}">${libTile(r)}<span class="oi"><b>${esc(r.name)}</b><span>${r.cook_minutes ? r.cook_minutes + ' мин' : ''}${(r.tags || []).filter(t => ['мясное', 'молочное', 'парве'].includes(t)).map(t => ' · ' + t).join('')}${r._ov ? ` · ${Math.round(r._ov * 100)}% продуктов уже в корзине` : ''}</span></span>
          <span class="dl num ${delta != null && delta < 0 ? 'minus' : ''}">${delta != null ? (delta < 0 ? '−' : '+') + money(Math.abs(delta), 1).replace(' ₪', '') : r._cost ? money(r._cost, 1) : ''}</span></button>`;
      }).join('');
      $$('[data-i]', box).forEach(b => b.onclick = async () => {
        const r = list[+b.dataset.i];
        b.disabled = true;
        try {
          let src = r;
          if (r.lib) { const full = await libRecipeFull(r.id); src = { ...full, lib: true, thumb_url: r.thumb_url, image_url: r.image_url || full.image_url }; }
          putDish(+d, isNew ? null : +mi, src, { meal });
          toast(isNew ? 'Добавили в меню' : 'Заменили');
          go('#/today');
        } catch (e) { b.disabled = false; toast('Не получилось: ' + e.message); }
      });
    } catch (e) { box.innerHTML = `<div class="err">Не загрузилось: ${esc(e.message)}</div>`; }
  },
});
