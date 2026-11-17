/* Sali — основа приложения: данные, вход, расчёты цен, роутер. Экраны — в screens*.js. */
'use strict';
const SB_URL = '/*__SUPABASE_URL__*/'.replace(/\/$/, '');
const KEY = '/*__SUPABASE_KEY__*/';
const FN = SB_URL + '/functions/v1/';
const REST = SB_URL + '/rest/v1/';
const sb = window.supabase ? window.supabase.createClient(SB_URL, KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } }) : null;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const money = (n, frac) => n == null || !isFinite(n) ? '—' : (frac || n < 100 ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : nf.format(Math.round(n))) + ' ₪';
const moneyR = n => n == null || !isFinite(n) ? '—' : nf.format(Math.round(n)) + ' ₪';
const amt = a => { const n = Number(a); return !isFinite(n) ? '' : n % 1 ? n.toFixed(n < 10 ? 1 : 0).replace('.', ',').replace(',0', '') : String(n); };
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m > 1 && m < 5 ? b : m === 1 ? a : c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const DAYS_GEN = ['воскресенья', 'понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MEAL_ORDER = ['завтрак', 'в школу', 'обед', 'перекус', 'ужин'];
const MEAL_LABEL = { 'завтрак': 'Завтрак', 'в школу': 'Коробочка в сад и школу', 'обед': 'Обед', 'перекус': 'Перекус', 'ужин': 'Ужин' };
const MEAL_SHORT = { 'завтрак': 'завтрак', 'в школу': 'коробочка', 'обед': 'обед', 'перекус': 'перекус', 'ужин': 'ужин' };
const MEAL_COLOR = { 'завтрак': '#C98A12', 'в школу': '#E07B2A', 'обед': '#2E7D32', 'перекус': '#7B4FBF', 'ужин': '#B8321C' };
const CHAINS = { shufersal: 'Шуферсаль', ramilevy: 'Рами Леви', victory: 'Виктори', tivtaam: 'Тив Таам', yochananof: 'Йохананоф', osherad: 'Ошер Ад', keshet: 'Кешет Теамим' };
const CAT_LABEL = { produce: 'Овощи и фрукты', meat: 'Мясо, курица, рыба', dairy: 'Молочное и яйца', bakery: 'Хлеб и выпечка', pantry: 'Бакалея', frozen: 'Заморозка', drinks: 'Напитки', sweets: 'Сладкое', coffee: 'Чай и кофе', other: 'Другое' };
const CAT_ORDER = ['produce', 'meat', 'dairy', 'bakery', 'pantry', 'frozen', 'drinks', 'sweets', 'coffee', 'other'];

const IC = {
  logo: '<svg width="30" height="30" viewBox="0 0 48 48" aria-hidden="true"><path d="M15 21a9 9 0 0 1 18 0" fill="none" stroke="#151515" stroke-width="3.5" stroke-linecap="round"/><path d="M6 21h36l-4 17a4 4 0 0 1-4 3H14a4 4 0 0 1-4-3z" fill="#FF4F6D"/><path d="M18 29q6 5 12 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M30 10c3-4 8-3 10-1-3 3-7 3-10 1z" fill="#1FB57A"/></svg>',
  i: (d, s = 20, c = 'currentColor', w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`,
  menu: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  cart: '<path d="M3 6h2l2 10h10l2-7H7"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  swap: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  bulb: '<path d="M12 3v3M5 12H2M22 12h-3M6 6L4 4M18 6l2-2"/><circle cx="12" cy="13" r="5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/>',
  google: '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z"/></svg>',
};
const ico = (name, s, c, w) => IC.i(IC[name], s, c, w);

// ---------- хранилище в браузере ----------
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('ls', e); } },
};

function defaultProfile() {
  const all = [0, 1, 2, 3, 4, 5, 6], school = [0, 1, 2, 3, 4];
  return {
    wish: '',
    adults: [{ name: '' }, { name: '' }],
    kids: [{ name: '', age: '' }],
    meals: {
      'завтрак': { on: false, days: all.slice() }, 'в школу': { on: false, days: school.slice() }, 'обед': { on: false, days: all.slice() },
      'перекус': { on: false, days: all.slice() }, 'ужин': { on: true, days: all.slice() },
    },
    friday: { on: false, guests: 8 },
    diet: [], maxMin: 40, budget: '', allergies: '', dislikes: '', likes: '',
    cuisine: 'домашняя русская и израильская, привычные блюда',
    times: { 'завтрак': '07:30', 'в школу': '07:30', 'обед': '13:00', 'перекус': '16:30', 'ужин': '19:00' },
    chain: '', remind: true, weekMode: 'auto',
  };
}

const app = {
  user: null,
  profile: Object.assign(defaultProfile(), LS.get('sali.profile') || {}),
  menu: LS.get('sali.menu'),
  lib: null, libP: null,
  defs: LS.get('sali.defs', {}),
  allIngs: null,
  draft: LS.get('sali.draft'),
  myRecipes: null,
  build: null,
  ui: { day: null, recTab: 'all', q: '' },
};

function saveProfile() {
  LS.set('sali.profile', app.profile);
  if (app.user) debounce('profile', 1000, () => sb.from('user_profiles').upsert({ user_id: app.user.id, family: app.profile }).then(({ error }) => error && console.warn(error)));
}
function saveMenu(opts = {}) {
  if (!app.menu) { LS.set('sali.menu', null); return; }
  app.menu.updatedAt = Date.now();
  LS.set('sali.menu', app.menu);
  if (app.user && !opts.local) debounce('menu', 900, cloudSaveMenu);
}
async function cloudSaveMenu() {
  const m = app.menu; if (!m || !app.user || !m.plan) return;
  const body = { title: menuTitle(m), state: m };
  if (m.savedId) {
    const { error } = await sb.from('user_menus').update(body).eq('id', m.savedId);
    if (error) console.warn('cloud save', error);
  } else {
    const { data, error } = await sb.from('user_menus').insert(body).select('id').single();
    if (error) { toast('Не удалось сохранить меню: ' + error.message); return; }
    m.savedId = data.id; LS.set('sali.menu', m); renderChrome();
  }
}
const timers = {};
function debounce(k, ms, fn) { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms); }

// ---------- даты недели ----------
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d; }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function weekStartFor(mode) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const dow = t.getDay();
  const thisSun = new Date(t); thisSun.setDate(t.getDate() - dow);
  const nextSun = new Date(thisSun); nextSun.setDate(thisSun.getDate() + 7);
  if (mode === 'this') return isoDate(thisSun);
  if (mode === 'next') return isoDate(nextSun);
  return isoDate(dow <= 1 ? thisSun : nextSun);
}
function weekLabel(iso) {
  const a = addDays(iso, 0), b = addDays(iso, 6);
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}` : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}
function dayDate(i) { return addDays(app.menu.weekStart, i); }
function todayIndex() { if (!app.menu) return -1; const d = Math.round((new Date().setHours(12, 0, 0, 0) - addDays(app.menu.weekStart, 0).getTime()) / 864e5); return d >= 0 && d < 7 ? d : -1; }
function menuTitle(m) { return 'Неделя ' + weekLabel(m.weekStart); }
function eaters(p = app.profile) { return Math.max(1, p.adults.length + p.kids.length); }

// ---------- вызовы сервера ----------
async function fn(name, body) {
  const r = await fetch(FN + name, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `ошибка ${r.status}`);
  return d;
}
async function rpc(name, args = {}) {
  const r = await fetch(REST + 'rpc/' + name, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}
function loadLib() {
  if (app.lib) return Promise.resolve(app.lib);
  return app.libP ||= rpc('menu_library').then(d => (app.lib = d.map(r => ({ ...r, ingredients: (r.ing || []).map(([key, name, amount, unit, pantry]) => ({ key, name, amount, unit, pantry })) })))).catch(e => { app.libP = null; throw e; });
}
async function loadDefs(keys) {
  const need = [...new Set(keys)].filter(k => k && k !== 'water' && !app.defs[k]);
  for (let i = 0; i < need.length; i += 80) {
    const part = need.slice(i, i + 80);
    const q = encodeURIComponent(`(${part.map(k => `"${k}"`).join(',')})`);
    const r = await fetch(`${REST}g_ingredients?select=key,name_ru,name_he,base_unit,piece_g,tbsp_g,tsp_g,category,pantry&key=in.${q}`, { headers: { apikey: KEY } });
    if (r.ok) for (const d of await r.json()) app.defs[d.key] = d;
  }
  LS.set('sali.defs', app.defs);
  return app.defs;
}
async function loadAllIngs() {
  if (app.allIngs) return app.allIngs;
  const r = await fetch(`${REST}g_ingredients?select=key,name_ru,name_he,base_unit,piece_g,tbsp_g,tsp_g,category,pantry&recipe=eq.true&is_group=eq.false&order=name_ru&limit=5000`, { headers: { apikey: KEY } });
  app.allIngs = r.ok ? await r.json() : [];
  for (const d of app.allIngs) app.defs[d.key] ||= d;
  return app.allIngs;
}

// количество в базовой единице ингредиента (г / мл / шт); null — не пересчитать
function toBase(i, d) {
  const a = Number(i.amount), u = i.unit;
  if (!d || u === 'по вкусу' || !isFinite(a)) return u === 'по вкусу' ? 0 : null;
  const g = { 'г': a, 'кг': a * 1000, 'мл': a, 'л': a * 1000, 'ст.л.': a * (d.tbsp_g || 15), 'ч.л.': a * (d.tsp_g || 5) }[u];
  if (d.base_unit === 'шт') return u === 'шт' ? a : (g != null && d.piece_g ? g / d.piece_g : null);
  if (u === 'шт') return d.piece_g ? a * d.piece_g : null;
  return g ?? null;
}
function scaleIngs(ings, k) {
  if (!isFinite(k) || Math.abs(k - 1) < 0.01) return ings.map(x => ({ ...x }));
  return ings.map(x => {
    if (typeof x.amount !== 'number' || x.unit === 'по вкусу') return { ...x };
    let a = x.amount * k;
    if (x.unit === 'шт') a = Math.max(0.5, Math.round(a * 2) / 2);
    else if (x.unit === 'ч.л.' || x.unit === 'ст.л.') a = Math.max(0.5, Math.round(a * 2) / 2);
    else if (x.unit === 'кг' || x.unit === 'л') a = Math.round(a * 10) / 10;
    else a = a >= 500 ? Math.round(a / 50) * 50 : a >= 100 ? Math.round(a / 10) * 10 : Math.max(1, Math.round(a / 5) * 5 || Math.round(a));
    return { ...x, amount: a };
  });
}

// ---------- меню: слоты, блюда, рецепты ----------
const dishById = id => app.menu?.plan?.dishes?.find(d => d.id === id);
const recipeOf = id => app.menu?.recipes?.[id];
function slots(dayI) {
  const day = app.menu.plan.days[dayI]; if (!day) return [];
  return day.meals.map((s, mi) => ({ ...s, mi, dayI, dish: dishById(s.dish_id) })).filter(s => s.dish)
    .sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal));
}
function allSlots() { const out = []; for (let i = 0; i < 7; i++) out.push(...slots(i)); return out; }
// сколько раз блюдо готовится за неделю (остатки не считаем)
function cooks(dishId) { const n = allSlots().filter(s => s.dish_id === dishId && !s.leftovers).length; return Math.max(1, n); }
function imgOf(dish) {
  const im = dish?.recipe_id && app.menu?.images?.[dish.recipe_id];
  return dish?.image || im?.thumb || null;
}
function fullImgOf(dish) { const im = dish?.recipe_id && app.menu?.images?.[dish.recipe_id]; return dish?.image || im?.full || im?.thumb || null; }
function tile(dish, cls = 't', meal) {
  const src = imgOf(dish);
  const m = meal || dish?.meals?.[0] || 'ужин';
  if (src) return `<img class="${cls === 't' ? '' : cls}" src="${esc(src)}" alt="" loading="lazy">`;
  return `<div class="t ${cls === 't' ? '' : cls}" style="background:${MEAL_COLOR[m] || '#7A6A50'}">${esc((dish?.name || '?')[0])}</div>`;
}
function libTile(r, cls = '') {
  const src = r.thumb_url || r.image_url;
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<div class="t ${cls}" style="background:${MEAL_COLOR[(r.meals || [])[0]] || '#7A6A50'}">${esc((r.name || '?')[0])}</div>`;
}
async function refreshImages() {
  const m = app.menu; if (!m) return;
  const ids = [...new Set(m.plan.dishes.map(d => d.recipe_id).filter(Boolean))].filter(id => !m.images?.[id]?.thumb);
  if (!ids.length) return;
  try {
    const rows = await rpc('menu_images', { p_ids: ids });
    m.images ||= {};
    for (const r of rows) if (r.thumb_url) m.images[r.id] = { thumb: r.thumb_url, full: r.image_url };
    saveMenu({ local: !rows.some(r => r.thumb_url) });
  } catch (e) { console.warn('images', e); }
}

// ---------- цены ----------
// цена за базовую единицу ингредиента из предложения сети
function unitFromOffer(o, d) {
  const p = Number(o.price); if (!(p > 0) || !d) return null;
  if (o.is_weighted) {
    if (d.base_unit === 'шт') return d.piece_g ? p / 1000 * d.piece_g : null;
    return p / 1000;
  }
  const pack = Number(o.pack); if (!(pack > 0)) return null;
  if (o.pack_unit === d.base_unit) return p / pack;
  if (o.pack_unit === 'шт' && d.piece_g && d.base_unit !== 'шт') return p / (pack * d.piece_g);
  if (d.base_unit === 'шт' && d.piece_g && (o.pack_unit === 'г' || o.pack_unit === 'мл')) return p / (pack / d.piece_g);
  if ((o.pack_unit === 'г' && d.base_unit === 'мл') || (o.pack_unit === 'мл' && d.base_unit === 'г')) return p / pack;
  return null;
}
const unitCache = LS.get('sali.units', {});
async function ensureUnits(keys) {
  const need = [...new Set(keys)].filter(k => k && k !== 'water' && !(k in unitCache && unitCache[k].t > Date.now() - 6 * 3600e3));
  if (!need.length) return unitCache;
  await loadDefs(need);
  const parts = []; for (let i = 0; i < need.length; i += 12) parts.push(need.slice(i, i + 12));
  // по 3 запроса параллельно: большие пачки упираются в таймаут базы
  for (let i = 0; i < parts.length; i += 3) await Promise.all(parts.slice(i, i + 3).map(async part => {
    let offers;
    try { offers = await rpc('g_ingredient_offers', { p_keys: part }); } catch (e) { console.warn(e); for (const k of part) unitCache[k] ||= { t: Date.now() - 5.9 * 3600e3, c: {} }; return; }
    for (const k of part) unitCache[k] = { t: Date.now(), c: {} };
    for (const o of offers) {
      const u = unitFromOffer(o, app.defs[o.key]); if (u == null) continue;
      const c = unitCache[o.key].c;
      if (c[o.chain] == null || u < c[o.chain]) c[o.chain] = Math.round(u * 10000) / 10000;
    }
  }));
  LS.set('sali.units', unitCache);
  return unitCache;
}
function unitPrice(key, chain) {
  const c = unitCache[key]?.c; if (!c) return null;
  if (chain && c[chain] != null) return c[chain];
  const v = Object.values(c); return v.length ? Math.min(...v) : null;
}
// выбранная сеть для цен блюд: своя сеть или самая выгодная по корзине недели
function priceChain() { return app.menu?.chain || app.profile.chain || app.menu?.basket?.best || null; }
// стоимость ингредиентов (без того, что есть дома)
function ingsCost(ings, chain = priceChain()) {
  let sum = 0, miss = 0;
  for (const i of ings || []) {
    if (!i.key || i.key === 'water' || i.pantry || app.menu?.have?.[i.key]) continue;
    const q = toBase(i, app.defs[i.key]); const u = unitPrice(i.key, chain);
    if (q == null || u == null) { miss++; continue; }
    sum += q * u;
  }
  return { sum, miss };
}
function dishCost(dish) { const r = recipeOf(dish?.id); return r ? ingsCost(r.ingredients).sum : null; }
function slotCost(s) { return s.leftovers ? 0 : dishCost(s.dish); }
function portionsOf(s) { return s.meal === 'в школу' ? Math.max(1, app.menu.profile?.kids?.length || app.profile.kids.length || 1) : eaters(app.menu.profile || app.profile); }

// нужное на неделю: по ключам, в базовых единицах
function weekNeed() {
  const m = app.menu, sum = {};
  const seen = new Set();
  for (const s of allSlots()) {
    if (seen.has(s.dish_id)) continue; seen.add(s.dish_id);
    const r = recipeOf(s.dish_id); if (!r) continue;
    const k = cooks(s.dish_id);
    for (const i of r.ingredients || []) {
      if (!i.key || i.key === 'water') continue;
      const q = toBase(i, app.defs[i.key]); if (q == null) continue;
      const e = (sum[i.key] ||= { key: i.key, qty: 0, pantry: true, dishes: new Set() });
      e.qty += q * k; if (!i.pantry) e.pantry = false; e.dishes.add(s.dish_id);
    }
  }
  return Object.values(sum).map(e => ({ ...e, dishes: [...e.dishes], have: m.have?.[e.key] ?? e.pantry }));
}
async function refreshPrices() {
  const m = app.menu; if (!m?.plan) return;
  const keys = Object.values(m.recipes || {}).flatMap(r => (r.ingredients || []).map(i => i.key)).filter(Boolean);
  await loadDefs(keys);
  await ensureUnits(keys);
  const need = weekNeed();
  m.have ||= {};
  for (const e of need) if (!(e.key in m.have)) m.have[e.key] = e.pantry;
  const buy = need.filter(e => !m.have[e.key]).map(e => {
    const d = app.defs[e.key];
    const qty = d?.base_unit === 'шт' ? Math.ceil(e.qty - 0.01) : e.qty >= 100 ? Math.ceil(e.qty / 10) * 10 : Math.max(5, Math.ceil(e.qty / 5) * 5);
    return { key: e.key, qty };
  });
  if (!buy.length) { m.basket = { at: Date.now(), need: 0, chains: [], best: null }; saveMenu(); return; }
  const b = await rpc('g_recipe_basket', { p_need: buy });
  const chains = (b.all || []).map(c => ({
    chain: c.chain, have: c.have_subst ?? c.have, total: c.total_subst ?? c.total, saved: c.saved,
    lines: [...(c.lines || []), ...(c.subst || [])].map(l => ({ key: l.for || l.key, sub: l.substitute ? l.key : undefined, name: l.name, cost: Number(l.cost), regular: Number(l.regular), packs: l.packs, kg: l.kg, deal: l.deal })),
    missing: c.missing_subst || [],
  }));
  const full = Math.max(0, ...chains.map(c => c.have));
  const complete = chains.filter(c => c.have >= full - 1).sort((a, b) => a.total - b.total);
  m.basket = { at: Date.now(), need: buy.length, chains, best: complete[0]?.chain || chains[0]?.chain || null, qty: Object.fromEntries(buy.map(x => [x.key, x.qty])) };
  saveMenu();
}
function weekRange() {
  const b = app.menu?.basket; if (!b?.chains?.length) return null;
  const full = Math.max(...b.chains.map(c => c.have));
  const ok = b.chains.filter(c => c.have >= full - 1);
  const from = Math.min(...ok.map(c => c.total));
  const mine = app.menu.chain || app.profile.chain;
  const mc = mine && b.chains.find(c => c.chain === mine);
  const to = mc ? mc.total : Math.max(...ok.map(c => c.total));
  return { from, to };
}
function totalPortions() { return allSlots().reduce((a, s) => a + portionsOf(s), 0) || 1; }

// ---------- календарь готовки ----------
const toMin = t => { const [h, m] = String(t || '19:00').split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = n => `${String(Math.floor(((n % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((n % 60) + 60) % 60).padStart(2, '0')}`;
function cookEvents() {
  const p = app.profile, ev = [];
  for (let d = 0; d < 7; d++) {
    const groups = {};
    for (const s of slots(d)) {
      if (s.leftovers) continue;
      const mins = Math.min(180, Math.max(10, s.dish.cook_minutes || 30));
      if (s.meal === 'в школу') {
        const day = d > 0 ? d - 1 : d, start = d > 0 ? toMin('20:30') : toMin(p.times?.['в школу'] || '07:30') - Math.min(mins, 30);
        ev.push({ day, start, mins: Math.min(mins, 40), kind: 'o', title: 'Коробочка на ' + (d > 0 ? 'завтра' : 'сегодня'), dishes: [s.dish.name], slot: s });
        continue;
      }
      const g = (groups[s.meal] ||= { day: d, meal: s.meal, mins: 0, dishes: [], slot: s });
      g.mins = Math.max(g.mins, mins); g.dishes.push(s.dish.name);
    }
    for (const g of Object.values(groups)) {
      const at = toMin(p.times?.[g.meal] || '19:00');
      ev.push({ day: d, start: at - g.mins, mins: g.mins, kind: 'g', title: MEAL_LABEL[g.meal], dishes: g.dishes, slot: g.slot, meal: g.meal });
    }
  }
  return ev.sort((a, b) => a.day - b.day || a.start - b.start);
}
function icsFile() {
  const p = app.profile;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sali//menu//RU', 'CALSCALE:GREGORIAN'];
  const fmt = (d, min) => { const x = new Date(d); x.setHours(0, min, 0, 0); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}${String(x.getMinutes()).padStart(2, '0')}00`; };
  const escI = s => String(s).replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n');
  cookEvents().forEach((e, i) => {
    const d = dayDate(e.day);
    lines.push('BEGIN:VEVENT', `UID:sali-${app.menu.weekStart}-${i}@sali`, `DTSTAMP:${fmt(new Date(), 0)}`,
      `DTSTART;TZID=Asia/Jerusalem:${fmt(d, e.start)}`, `DTEND;TZID=Asia/Jerusalem:${fmt(d, e.start + e.mins)}`,
      `SUMMARY:${escI((e.kind === 'o' ? 'Заготовка: ' : 'Готовим: ') + e.dishes.join(', '))}`, `DESCRIPTION:${escI('Sali · ' + e.title)}`);
    if (p.remind !== false) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Пора готовить', 'TRIGGER:-PT15M', 'END:VALARM');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------- параметры для модели ----------
function toParams(p) {
  const days = ds => ds.length === 7 ? 'каждый день' : ds.slice().sort().map(i => DAYS[i]).join(', ');
  const kidsAges = p.kids.map(k => k.age).filter(Boolean).join(', ');
  const meals = MEAL_ORDER.filter(m => p.meals[m]?.on && p.meals[m].days.length).map(m => `${m} (${days(p.meals[m].days)})`);
  const extra = [p.wish, p.friday?.on ? `В пятницу ужин с гостями: всего ${p.friday.guests} человек — праздничный, побольше.` : '',
    `Неделя: ${weekLabel(weekStartFor(p.weekMode))}. Ставь приёмы пищи только в указанные дни.`].filter(Boolean).join('\n');
  return {
    people: `${p.adults.length} взрослых` + (p.kids.length ? `, ${p.kids.length} детей${kidsAges ? ' (возраст: ' + kidsAges + ')' : ''}` : ''),
    meals: meals.join('; ') || 'ужин (каждый день)',
    diet: p.diet.join(', '), allergies: p.allergies, dislikes: p.dislikes, likes: p.likes,
    time: `в будни до ${p.maxMin} минут, в выходные можно дольше`, budget: p.budget ? p.budget + ' ₪' : '', cuisine: p.cuisine, extra,
  };
}
function plannedCount(p = app.profile) {
  return MEAL_ORDER.reduce((a, m) => a + (p.meals[m]?.on ? p.meals[m].days.length : 0), 0) + (p.friday?.on && !(p.meals['ужин']?.on && p.meals['ужин'].days.includes(5)) ? 1 : 0);
}

// ---------- сборка меню ----------
async function buildMenu() {
  const p = JSON.parse(JSON.stringify(app.profile));
  const b = app.build = { step: 0, done: 0, total: 0, error: null, msg: '' };
  go('#/building');
  const upd = () => { if (location.hash === '#/building') render(); };
  try {
    const params = toParams(p);
    const res = await fn('menu', { action: 'plan', params });
    const plan = res.result;
    const m = { v: 1, createdAt: Date.now(), weekStart: weekStartFor(p.weekMode), profile: p, params, plan, recipes: {}, images: {}, have: {}, chain: p.chain || '' };
    // в пятницу с гостями — больше порций
    b.step = 1; b.total = plan.dishes.length; b.msg = `Нашли ${plan.dishes.length} ${plural(plan.dishes.length, 'блюдо', 'блюда', 'блюд')} под ваш запрос`; upd();
    const fromLib = plan.dishes.filter(d => d.recipe_id), other = plan.dishes.filter(d => !d.recipe_id);
    const batches = [];
    if (fromLib.length) batches.push(fromLib);
    for (let i = 0; i < other.length; i += 5) batches.push(other.slice(i, i + 5));
    await Promise.all(batches.map(async part => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fn('menu', { action: 'recipes', params, dishes: part });
          for (const x of r.result.recipes || []) m.recipes[x.dish_id] = x;
          break;
        } catch (e) { console.warn('recipes', e); await sleep(1500); }
      }
      b.done = Object.keys(m.recipes).length; upd();
    }));
    for (const d of plan.dishes) { const r = m.recipes[d.id]; if (r?.recipe_id && !d.recipe_id) d.recipe_id = r.recipe_id; }
    app.menu = m; app.ui.day = null;
    b.step = 2; upd();
    await refreshImages();
    try { await refreshPrices(); } catch (e) { console.warn('prices', e); }
    b.step = 3; upd();
    await sleep(500);
    b.step = 4;
    saveMenu();
    app.build = null;
    go('#/today');
    const miss = plan.dishes.filter(d => !m.recipes[d.id]).length;
    if (miss) toast(`${miss} ${plural(miss, 'рецепт', 'рецепта', 'рецептов')} не загрузились — откройте блюдо, чтобы попробовать ещё раз`);
  } catch (e) {
    b.error = e.message || String(e); upd();
  }
}
async function loadRecipeFor(dish) {
  const m = app.menu;
  const r = await fn('menu', { action: 'recipes', params: m.params, dishes: [dish] });
  for (const x of r.result.recipes || []) m.recipes[x.dish_id] = x;
  const rr = m.recipes[dish.id]; if (rr?.recipe_id && !dish.recipe_id) dish.recipe_id = rr.recipe_id;
  await refreshImages(); saveMenu(); schedulePrices();
}
function schedulePrices() { debounce('prices', 600, () => refreshPrices().then(() => render()).catch(e => console.warn(e))); }

// ---------- изменения меню ----------
async function libRecipeFull(id) { return rpc('menu_recipe', { p_id: id }); }
// поставить рецепт (из библиотеки или свой) в слот: replace — заменить блюдо во всех слотах с тем же блюдом
function putDish(dayI, mi, src, opts = {}) {
  const m = app.menu, day = m.plan.days[dayI];
  const old = mi != null ? dishById(day.meals[mi]?.dish_id) : null;
  const meal = opts.meal || day.meals[mi]?.meal || 'ужин';
  const portions = old?.portions || (meal === 'в школу' ? Math.max(1, (m.profile?.kids?.length || 1)) : eaters(m.profile)) * (opts.days || 1);
  const id = 'x' + Date.now().toString(36);
  const dish = { id, name: src.name, meals: src.meals?.length ? src.meals : [meal], description: src.description || '', cook_minutes: src.cook_minutes || src.minutes || 30,
    portions, kcal: src.kcal || null, tags: src.tags || [], recipe_id: src.lib ? src.id : undefined, own_id: src.own ? src.id : undefined, image: src.image_url && !src.lib ? src.image_url : undefined };
  const base = src.portions || portions;
  m.plan.dishes.push(dish);
  m.recipes[id] = { dish_id: id, recipe_id: dish.recipe_id, ingredients: scaleIngs(src.ingredients || [], portions / base), steps: src.steps || [], tip: src.tip || null, portions0: base, ingredients0: src.ingredients || [] };
  if (src.lib && src.image_url) { m.images ||= {}; m.images[src.id] = { thumb: src.thumb_url || src.image_url, full: src.image_url }; }
  if (old && mi != null) {
    for (const d of m.plan.days) for (const s of d.meals) if (s.dish_id === old.id) s.dish_id = id;
  } else {
    day.meals.push({ meal, dish_id: id });
  }
  // неиспользуемые блюда убираем
  const used = new Set(m.plan.days.flatMap(d => d.meals.map(s => s.dish_id)));
  m.plan.dishes = m.plan.dishes.filter(d => used.has(d.id));
  for (const k of Object.keys(m.recipes)) if (!used.has(k)) delete m.recipes[k];
  saveMenu(); schedulePrices();
  return dish;
}
function removeSlot(dayI, mi) {
  const m = app.menu; m.plan.days[dayI].meals.splice(mi, 1);
  const used = new Set(m.plan.days.flatMap(d => d.meals.map(s => s.dish_id)));
  m.plan.dishes = m.plan.dishes.filter(d => used.has(d.id));
  saveMenu(); schedulePrices();
}
function setPortions(dish, n) {
  const r = recipeOf(dish.id); if (!r) return;
  r.portions0 ||= dish.portions; r.ingredients0 ||= r.ingredients;
  dish.portions = n;
  r.ingredients = scaleIngs(r.ingredients0, n / r.portions0);
  saveMenu(); schedulePrices();
}

// ---------- фильтр под семью (для замены и подбора) ----------
function fitsFamily(r, p = app.menu?.profile || app.profile) {
  const tags = new Set(r.tags || []);
  if (p.diet.includes('вегетарианское') && (tags.has('мясное') || tags.has('рыба'))) return false;
  if (p.diet.includes('без глютена') && tags.has('глютен')) return false;
  if (p.diet.includes('без лактозы') && tags.has('лактоза')) return false;
  const text = (r.name + ' ' + (r.ingredients || []).map(i => i.name).join(' ')).toLowerCase();
  const words = (p.allergies + ',' + p.dislikes).toLowerCase().split(/[,;\n]+|\s+и\s+/).map(s => s.trim()).filter(s => s.length > 2);
  const ALLERG = [[/орех|арахис/, 'орехи'], [/кунжут|тхин/, 'кунжут'], [/яйц/, 'яйца'], [/рыб/, 'рыба'], [/молок|лактоз/, 'лактоза'], [/глютен|пшениц/, 'глютен'], [/со[яи]/, 'соя']];
  for (const w of words) {
    for (const [re, t] of ALLERG) if (re.test(w) && tags.has(t)) return false;
    const stem = w.replace(/(ы|и|а|я|ов|ей|ами|ями|ой|ий|ые|ая)$/, '').slice(0, 6);
    if (stem.length > 2 && text.includes(stem)) return false;
  }
  return true;
}

// ---------- вход ----------
async function login(after) {
  if (!sb) { toast('Не загрузилась библиотека входа — обновите страницу'); return; }
  LS.set('sali.after', after || location.hash || '#/today');
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) toast('Не получилось войти: ' + error.message);
}
async function onSignedIn() {
  // профиль семьи: из аккаунта, если есть; иначе — сохраняем текущий
  try {
    const { data } = await sb.from('user_profiles').select('family').maybeSingle();
    if (data?.family && Object.keys(data.family).length) { app.profile = Object.assign(defaultProfile(), data.family); LS.set('sali.profile', app.profile); }
    else saveProfile();
  } catch (e) { console.warn(e); }
  // меню: несохранённое — в аккаунт; сохранённое — свежую версию из аккаунта; нет меню — последнее из аккаунта
  try {
    const m = app.menu;
    if (m?.plan && !m.savedId) await cloudSaveMenu();
    else if (m?.savedId) { const { data } = await sb.from('user_menus').select('id,state').eq('id', m.savedId).maybeSingle(); if (data) { app.menu = { ...data.state, savedId: data.id }; LS.set('sali.menu', app.menu); } else { delete m.savedId; await cloudSaveMenu(); } }
    else { const { data } = await sb.from('user_menus').select('id,state').order('updated_at', { ascending: false }).limit(1); if (data?.length) { app.menu = { ...data[0].state, savedId: data[0].id }; LS.set('sali.menu', app.menu); } }
  } catch (e) { console.warn(e); }
  // черновик рецепта, который ждал входа
  const after = LS.get('sali.after'); LS.set('sali.after', null);
  if (after && location.hash !== after) go(after); else render();
}
async function openMenu(id) {
  const { data, error } = await sb.from('user_menus').select('id,state').eq('id', id).single();
  if (error) { toast('Не открылось: ' + error.message); return; }
  app.menu = { ...data.state, savedId: data.id }; app.ui.day = null;
  LS.set('sali.menu', app.menu);
  go('#/today');
}

// ---------- интерфейс: шторка, уведомление ----------
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(timers.toast); timers.toast = setTimeout(() => t.hidden = true, ms); }
function sheet(title, html, onMount) {
  const w = $('#sheet');
  w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-h"><h2>${esc(title)}</h2><button class="ib" data-close aria-label="Закрыть">${ico('close')}</button></div>${html}</div>`;
  w.hidden = false;
  const close = () => { w.hidden = true; w.innerHTML = ''; };
  w.onclick = e => { if (e.target === w || e.target.closest('[data-close]')) close(); };
  onMount && onMount(w.firstElementChild, close);
  setTimeout(() => w.querySelector('input,textarea,button:not([data-close])')?.focus(), 30);
  return close;
}
function confirmSheet(title, text, yes, onYes) {
  sheet(title, `<p class="mu" style="margin:0">${esc(text)}</p><button class="cta w" data-yes>${esc(yes)}</button><button class="ghost w" data-close>Отмена</button>`,
    (el, close) => el.querySelector('[data-yes]').onclick = () => { close(); onYes(); });
}

// ---------- роутер ----------
const routes = [];
function route(re, fn, opts = {}) { routes.push({ re, fn, ...opts }); }
function go(h) { if (location.hash === h) render(); else location.hash = h; }
let lastPath = '';
function render() {
  const h = location.hash || '#/';
  for (const r of routes) {
    const m = h.match(r.re);
    if (!m) continue;
    const view = $('#view');
    const html = r.fn(...m.slice(1));
    if (html != null) view.innerHTML = html;
    r.after && r.after(view, ...m.slice(1));
    app.ui.tab = r.tab || null;
    $('#dock').innerHTML = r.dock ? r.dock() : '';
    if (h !== lastPath) { window.scrollTo(0, 0); lastPath = h; }
    renderChrome();
    return;
  }
  go(app.menu ? '#/today' : '#/start');
}
function renderChrome() {
  const tab = app.ui.tab;
  const tabs = [['menu', '#/today', 'Меню', 'menu'], ['recipes', '#/recipes', 'Рецепты', 'book'], ['basket', '#/basket', 'Корзина', 'cart'], ['cal', '#/calendar', 'Календарь', 'cal']];
  $('#tabs').innerHTML = tabs.map(([k, href, t, i]) => `<a href="${href}" class="${tab === k ? 'on' : ''}" ${tab === k ? 'aria-current="page"' : ''}>${ico(i, 22, 'currentColor', 1.9)}${t}</a>`).join('');
  const u = app.user, unsaved = app.menu?.plan && !u && tab !== 'menu';
  const av = u ? (u.user_metadata?.avatar_url ? `<img src="${esc(u.user_metadata.avatar_url)}" alt="" referrerpolicy="no-referrer">` : esc((u.email || '?')[0].toUpperCase())) : ico('user', 20);
  $('#top').innerHTML = `<div class="top-in"><a class="brand" href="${app.menu ? '#/today' : '#/start'}" aria-label="Sali — на главную">${IC.logo}Sali</a>
    <nav class="top-nav" aria-label="Разделы">${tabs.map(([k, href, t]) => `<a href="${href}" class="${tab === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <span class="sp"></span>
    ${unsaved ? `<button class="save-chip" data-act="save">Сохранить меню</button>` : ''}
    <a class="av-btn" href="#/account" aria-label="${u ? 'Мой кабинет' : 'Войти'}">${av}</a></div>`;
  const s = $('[data-act="save"]', $('#top')); if (s) s.onclick = () => askLogin('Сохраним меню', 'Войдите через Google — меню останется в аккаунте, и к нему можно вернуться с любого устройства.');
}
function askLogin(title, text, after) {
  sheet(title, `<p class="mu" style="margin:0">${esc(text)}</p><button class="gbtn" data-g>${IC.google}Продолжить с Google</button>
    <p class="mu" style="margin:0;font-size:12px">Входя, вы соглашаетесь с <a href="../privacy.html">политикой конфиденциальности</a>.</p>`,
    (el) => el.querySelector('[data-g]').onclick = () => login(after));
}
window.addEventListener('scroll', () => $('#top').classList.toggle('sh', scrollY > 4), { passive: true });
window.addEventListener('hashchange', render);
document.addEventListener('click', e => {
  const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); go(a.dataset.go); }
});
