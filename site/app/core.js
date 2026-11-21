/* Sali — основа приложения: данные, вход, расчёты цен, роутер. Экраны — в screens*.js. */
'use strict';
const SB_URL = '/*__SUPABASE_URL__*/'.replace(/\/$/, '');
const KEY = '/*__SUPABASE_KEY__*/';
const FN = SB_URL + '/functions/v1/';
const REST = SB_URL + '/rest/v1/';
const sb = window.supabase ? window.supabase.createClient(SB_URL, KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } }) : null;

// ---------- хранилище в браузере ----------
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('ls', e); } },
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const money = (n, frac) => n == null || !isFinite(n) ? '—' : (frac || n < 100 ? new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : nf.format(Math.round(n))) + ' ₪';
const moneyR = n => n == null || !isFinite(n) ? '—' : nf.format(Math.round(n)) + ' ₪';
const amt = a => { const n = Number(a); if (!isFinite(n)) return ''; if (!(n % 1)) return String(n); const s = n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, ''); return UI_LANG === 'ru' ? s.replace('.', ',') : s; };
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m > 1 && m < 5 ? b : m === 1 ? a : c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const DAYS_GEN = ['воскресенья', 'понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MEAL_ORDER = ['завтрак', 'в школу', 'обед', 'перекус', 'ужин', 'десерт'];
const MEAL_LABEL = { 'завтрак': 'Завтрак', 'в школу': 'Коробочка в сад и школу', 'обед': 'Обед', 'перекус': 'Перекус', 'ужин': 'Ужин', 'десерт': 'Десерт после ужина' };
const MEAL_SHORT = { 'завтрак': 'завтрак', 'в школу': 'коробочка', 'обед': 'обед', 'перекус': 'перекус', 'ужин': 'ужин', 'десерт': 'десерт' };
const MEAL_COLOR = { 'завтрак': '#C98A12', 'в школу': '#E07B2A', 'обед': '#2E7D32', 'перекус': '#7B4FBF', 'ужин': '#B8321C', 'десерт': '#C2417A' };
const CHAINS = { yango: 'Yango Deli', shufersal: 'Шуферсаль Онлайн', ramilevy: 'Рами Леви', victory: 'Виктори', tivtaam: 'Тив Таам', yochananof: 'Йохананоф', osherad: 'Ошер Ад', keshet: 'Кешет Теамим',
  // наборы цен «в магазине»: у Шуферсаля цены зависят от формата магазина (до 14%), у остальных — типичный филиал
  shufersal_deal: 'Шуферсаль Дил', shufersal_sheli: 'Шуферсаль Шели', shufersal_express: 'Шуферсаль Экспресс',
  ramilevy_store: 'Рами Леви', victory_store: 'Виктори', tivtaam_store: 'Тив Таам', keshet_store: 'Кешет Теамим' };
const baseChain = c => String(c || '').replace(/_(store|deal|sheli|express)$/, '');
// «С доставкой» — цены интернет-магазинов; «В магазине» — цены филиалов (Йохананоф и Ошер Ад не возят)
const SHOP = {
  delivery: ['shufersal', 'ramilevy', 'victory', 'tivtaam', 'keshet'],
  store: ['shufersal_deal', 'shufersal_sheli', 'shufersal_express', 'ramilevy_store', 'victory_store', 'tivtaam_store', 'keshet_store', 'yochananof', 'osherad'],
};
// условия доставки с сайтов сетей (ноябрь 2026)
const DELIVERY = { shufersal: { fee: 35.9, min: 0 }, ramilevy: { fee: 35.9, min: 0 }, victory: { fee: 35.9, min: 250 }, tivtaam: { fee: 29.9, min: 300 }, keshet: { fee: 35.9, min: 350 } };
const shopMode = () => app.profile?.shop === 'store' ? 'store' : 'delivery';
const delivOf = c => shopMode() === 'delivery' ? DELIVERY[c] || null : null;
// сеть пользователя в текущем режиме: «Шуферсаль» в магазине → «Шуферсаль Дил»
const modeChain = id => !id ? null : SHOP[shopMode()].includes(id) ? id : SHOP[shopMode()].find(c => baseChain(c) === baseChain(id)) || null;
const CAT_LABEL = { produce: 'Овощи и фрукты', meat: 'Мясо, курица, рыба', dairy: 'Молочное и яйца', bakery: 'Хлеб и выпечка', pantry: 'Бакалея', frozen: 'Заморозка', drinks: 'Напитки', sweets: 'Сладкое', coffee: 'Чай и кофе', other: 'Другое' };
// ссылки на товар на сайте сети — только проверенные правила (17.11, с телефона в Израиле):
//   Шуферсаль — страница товара по штрихкоду; Рами Леви — /he/share/<код> (так делает их кнопка «поделиться»);
//   Тив Таам и Кешет (платформа Stor.ai) — карточка по номеру из storai_products, пока номера нет — поиск по штрихкоду; Ошер Ад — интернет-магазина нет; Йохананоф — id Magento, из наших данных не собрать;
//   Виктори — поиск на сайте: по штрихкоду (нужный товар идёт первым), для внутренних кодов развесного — по названию.
//   Адрес карточки /product/<название> по названию из файла цен часто не совпадает с сайтом (404), поэтому его не строим.
const chainNames = LS.get('sali.chainNames', {});
const CHAIN_LINK = {
  // Шуферсаль: развесное с кодом 729000… на сайте — без «729» и ведущих нулей (7290000000046 → P_46, 7290002505471 → P_2505471);
  //   упакованное развесное с настоящим штрихкодом (7296073440369) — полный код
  // (проверено на сайте: 7290001201596 → P_1201596, полный код даёт 404) — для всех товаров с префиксом 729000, не только развесных
  shufersal: b => `https://www.shufersal.co.il/online/he/p/P_${/^729000\d{7}$/.test(b) ? String(Number(b.slice(6))) : b}`,
  ramilevy: b => `https://www.rami-levy.co.il/he/share/${b.replace(/^ramilevy:/, '')}`,
  victory: (b, w, n) => /^\d{8,14}$/.test(b) ? `https://www.victoryonline.co.il/search?q=${b}`
    : (q => q ? `https://www.victoryonline.co.il/search?q=${encodeURIComponent(q)}` : null)(searchQ(chainNames.victory?.[b] || chainNames.victory_store?.[b] || n)),
  // Тив Таам и Кешет: карточка по номеру catalogProduct (таблица storai_products, её заполняет израильская машина), иначе поиск
  // поиск по штрихкоду на их сайте не работает — ищем по названию (первые слова без цифр и единиц)
  tivtaam: (b, w, n) => storaiIds.tivtaam?.[b] ? `https://www.tivtaam.co.il/?catalogProduct=${storaiIds.tivtaam[b]}` : `https://www.tivtaam.co.il/search/${encodeURIComponent(searchQ(n) || b)}`,
  keshet: (b, w, n) => storaiIds.keshet?.[b] ? `https://www.keshet-teamim.co.il/?catalogProduct=${storaiIds.keshet[b]}` : `https://www.keshet-teamim.co.il/search/${encodeURIComponent(searchQ(n) || b)}`,
};
// какие коды годятся: штрихкод — везде; внутренний код развесного — у Рами Леви (/share/108 открывает лук) и Виктори (ссылка по названию)
// строка поиска по названию: без цифр, единиц и знаков, первые 3 слова
const searchQ = n => String(n || '').replace(/["'״׳*()]/g, ' ').split(/\s+/)
  .filter(w => w && !/\d/.test(w) && !/^(גר|גרם|ג|קג|ק"ג|מל|מ"ל|ליטר|ל|יח|יחידות|ארוז|בשקית|בקופסא|במשקל)$/.test(w)).slice(0, 3).join(' ');
const productLink = (chain, barcode, weighted, name) => {
  chain = baseChain(chain);
  const b = String(barcode || ''), f = CHAIN_LINK[chain];
  // Yango Deli: свои товары — страница по адресу из их каталога, наши штрихкоды — поиск по названию (?text= robots.txt разрешает)
  if (chain === 'yango' && yangoSlugs[b]) return `https://deli.yango.com/he-il/good/${encodeURIComponent(yangoSlugs[b])}`; // наш штрихкод сопоставлен с карточкой Yango
  if (chain === 'yango') return /^yango:/.test(b) ? `https://deli.yango.com/he-il/good/${encodeURIComponent(b.slice(6))}` : `https://deli.yango.com/he-il/search?text=${encodeURIComponent(searchQ(name) || name || '')}`;
  if (!f) return null;
  if (/^\d{8,14}$/.test(b)) return f(b, weighted, name);
  if ((chain === 'ramilevy' || chain === 'victory') && new RegExp(`^${chain}:\\d+$`).test(b)) return f(b, weighted, name);
  return null;
};
const storaiIds = LS.get('sali.storai', {});
// ссылка ведёт в поиск, а не в карточку (номера товара ещё нет)
// штрихкод → карточка товара в Yango Deli (для товаров, сопоставленных по штрихкоду)
const yangoSlugs = {}, yangoAsked = new Set();
async function loadYangoSlugs(codes) {
  const ask = [...new Set(codes.filter(b => b && /^\d{5,14}$/.test(b) && !yangoAsked.has(b)))].slice(0, 150);
  if (!ask.length) return false;
  ask.forEach(b => yangoAsked.add(b));
  try {
    const r = await fetch(`${REST}g_yango_items?select=barcode,slug&barcode=in.(${ask.join(',')})`, { headers: { apikey: KEY } });
    let any = false; for (const x of await r.json() || []) if (x.slug) { yangoSlugs[x.barcode] = x.slug; any = true; }
    return any;
  } catch { ask.forEach(b => yangoAsked.delete(b)); return false; }
}
const linkIsSearch = (chain, b) => (chain = baseChain(chain), chain === 'yango' ? !/^yango:/.test(b || '') && !yangoSlugs[b] : chain === 'victory' || ((chain === 'tivtaam' || chain === 'keshet') && !storaiIds[chain]?.[b]));
async function loadStoraiIds(chain, barcodes) {
  const map = (storaiIds[chain] ||= {});
  const need = [...new Set(barcodes)].filter(b => /^\d{8,14}$/.test(b) && !(b in map));
  let got = false;
  for (let i = 0; i < need.length; i += 80) {
    const part = need.slice(i, i + 80);
    const r = await fetch(`${REST}storai_products?select=barcode,product_id&chain=eq.${chain}&barcode=in.(${part.map(b => `"${b}"`).join(',')})`, { headers: { apikey: KEY } });
    if (!r.ok) return got;
    for (const x of await r.json()) if (x.product_id) { map[x.barcode] = x.product_id; got = true; }
  }
  LS.set('sali.storai', storaiIds);
  return got;
}
// названия товаров так, как их пишет сама сеть (на ценнике и в чеке), плюс производитель и цена за единицу;
// названия Виктори нужны ещё и для ссылок
const chainMeta = LS.get('sali.chainMeta', {});
async function loadChainNames(chain, barcodes) {
  const map = (chainNames[chain] ||= {}), meta = (chainMeta[chain] ||= {});
  const need = [...new Set(barcodes)].filter(b => (/^\d{8,14}$/.test(b) || /^[a-z]+:\d+$/.test(b)) && !(b in meta));
  for (let i = 0; i < need.length; i += 150) {
    const part = need.slice(i, i + 150);
    const rows = await rpc('g_chain_items', { p_chain: chain, p_barcodes: part });
    for (const b of part) { meta[b] = null; if (!(b in map)) map[b] = null; }
    for (const x of rows || []) { map[x.barcode] = x.name; meta[x.barcode] = { m: x.maker, up: x.unit_price, uom: x.unit_of_measure }; }
  }
  LS.set('sali.chainNames', chainNames); LS.set('sali.chainMeta', chainMeta);
  return need.length > 0;
}
const shelfName = (chain, b, fallback) => chainNames[chain]?.[b] || fallback;
// перевод названий товаров на язык приложения (функция name-tr, общий кэш в базе + localStorage)
// язык названий и карточек товаров: ru / en / he (иврит — как в прайсах сетей); интерфейс пока русский
const APP_LANG = typeof UI_LANG !== 'undefined' ? UI_LANG : (l => ['ru', 'en', 'he'].includes(l) ? l : 'ru')(LS.get('sali.lang', 'ru'));
const nameTr = LS.get('sali.nameTr3.' + APP_LANG, {});
const nameTrAsked = new Set();
async function loadNameTr(items) { // items: [{n: название на иврите, m: производитель}]
  if (APP_LANG === 'he') return false;
  const need = [...new Map(items.filter(x => x.n && !(x.n in nameTr) && !nameTrAsked.has(x.n)).map(x => [x.n, x])).values()];
  if (!need.length) return false;
  for (const x of need) nameTrAsked.add(x.n);
  for (let i = 0; i < need.length; i += 100) {
    const part = need.slice(i, i + 100);
    const r = await fn('name-tr', { lang: APP_LANG, names: part.map(x => x.n), makers: Object.fromEntries(part.filter(x => x.m).map(x => [x.n, x.m])) });
    Object.assign(nameTr, r.tr || {});
  }
  LS.set('sali.nameTr3.' + APP_LANG, nameTr);
  return true;
}
const trName = he => APP_LANG === 'he' ? he : (he && nameTr[he]) || he;
// название товара из выдачи сервера: p.ru — готовый русский перевод, для других языков — из кэша переводов
const pName = p => (APP_LANG === 'ru' && p.ru) || trName(p.name);
const needTr = p => APP_LANG !== 'he' && !(APP_LANG === 'ru' && p.ru);
// продукт в рецепте на языке интерфейса: по-русски — как написано в рецепте («Помидоры свежие или консервированные…»),
// на иврите и английском — общее название продукта (рецептурного текста в переводе нет)
// пояснение к количеству («3 ст. л.», «5–6 средних картофелин»): своё в рецепте пользователя или из библиотеки (note / note_en / note_he)
function ingNote(i) {
  if (APP_LANG === 'ru') return String(i.note || '').trim();
  if (i['note_' + APP_LANG]) return String(i['note_' + APP_LANG]).trim();
  if (!i.note) return '';
  // своё пояснение на другом языке: показываем, только если словарь перевёл его целиком (или оно не по-русски)
  const t = typeof tr === 'function' ? tr(i.note) : i.note;
  return typeof I18N !== 'undefined' && I18N.CYR.test(t) ? '' : String(t).trim();
}
function ingLabel(i) {
  const ru = i.name || app.defs[i.key]?.name_ru || i.key || '';
  if (APP_LANG === 'ru' || typeof I18N === 'undefined') return ru;
  const d = app.defs[i.key];
  let t = APP_LANG === 'he' ? (i.name_he || d?.name_he) : (d?.name_ru && tr(d.name_ru));
  if (!t || I18N.CYR.test(t)) t = tr(ru);
  else if (/по желани/i.test(ru)) t += APP_LANG === 'he' ? ' (לא חובה)' : ' (optional)';
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
// настоящий штрихкод (не внутренний код развесного) — по нему товар находится на сайте и в приложении сети
const realBarcode = (b, weighted) => /^\d{8,14}$/.test(String(b || '')) && !(weighted && /^729000\d{7}$/.test(b)) ? b : null;
const uomRu = u => { const t = String(u || '').replace(/\s+/g, ' ').trim();
  if (/קילו|ק"ג|קג|^kg/i.test(t)) return 'кг';
  if (/100 ?(גרם|גר|g)|(גרם|גר) ?100/i.test(t)) return '100 г';
  if (/100 ?(מ"ל|מל|ml)/i.test(t)) return '100 мл';
  if (/ליטר|^l$/i.test(t)) return 'л';
  if (/יח/.test(t)) return 'шт';
  return 'кг'; };
// кусочки строки под названием: производитель (иврит), цена за кг/100 г, штрихкод — каждый отдельно, чтобы иврит и русский не путали порядок
function productMeta(chain, l) {
  if (!l) return [];
  const mt = chainMeta[chain]?.[l.barcode], w = l.kg != null, bc = realBarcode(l.barcode, w);
  const mk = mt?.m && !/^לא ידוע$/.test(mt.m) ? mt.m : '';
  const he = chainNames[chain]?.[l.barcode];
  return [mk, w && mt?.up ? `${amt(mt.up)} ₪/${uomRu(mt.uom)}` : '', bc ? 'штрихкод ' + bc : (w ? 'развесное' : '')].filter(Boolean);
}
const productMetaHtml = (chain, l) => {
  if (!l) return '';
  const he = chainNames[chain]?.[l.barcode], xs = productMeta(chain, l);
  return (he && nameTr[he] ? `<span class="pc-he" dir="rtl">${esc(he)}</span>` : '') +
    (xs.length ? `<span class="pc-m">${xs.map(t => `<bdi>${esc(t)}</bdi>`).join('<i>·</i>')}</span>` : '');
};
const CAT_BG = { produce: '#EAF5E4', meat: '#FBE6E1', dairy: '#E6EEFA', bakery: '#F8ECDC', pantry: '#F5EFDD', frozen: '#E6ECFA', drinks: '#E2F3F5', sweets: '#FBE4EE', coffee: '#EFE6DE', other: '#F0EEEC' };
// иконка продукта: фото (g_ingredients.img), пока его нет — эмодзи
const iconOf = key => app.defs[key]?.img ? `<img src="${esc(app.defs[key].img)}" alt="" loading="lazy" decoding="async">` : (app.defs[key]?.icon || '🛒');
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
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  tag: '<path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1.3 1.3 0 0 1 0 1.8Z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  google: '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z"/></svg>',
};
const ico = (name, s, c, w) => IC.i(IC[name], s, c, w).replace('<svg ', `<svg class="i-${name}" `);
// иврит: ленты листаются в другую сторону (scrollLeft уходит в минус)
const RTLX = document.documentElement.dir === 'rtl' ? -1 : 1;


// профиль с недостающими приёмами пищи (например, «десерт» добавился позже) — дополняем значениями по умолчанию
function fixProfile(p) { const d = defaultProfile(); p.meals = Object.assign({}, d.meals, p.meals || {}); return p; }
function defaultProfile() {
  const all = [0, 1, 2, 3, 4, 5, 6], school = [0, 1, 2, 3, 4];
  return {
    wish: '',
    people: 4, boxes: 1,
    meals: {
      'завтрак': { on: false, days: all.slice() }, 'в школу': { on: false, days: school.slice() }, 'обед': { on: false, days: all.slice() },
      'перекус': { on: false, days: all.slice() }, 'ужин': { on: true, days: all.slice() }, 'десерт': { on: false, days: all.slice() },
    },
    friday: { on: false, guests: 8 },
    diet: [], maxMin: 40, budget: '', allergies: '', dislikes: '', likes: '',
    cuisine: 'домашняя русская и израильская, привычные блюда',
    chain: '', remind: true, weekMode: 'auto',
  };
}

const app = {
  user: null,
  profile: fixProfile(Object.assign(defaultProfile(), LS.get('sali.profile') || {})),
  menu: (m => { if (!(m?.plan?.dishes?.length && m.weekStart)) return null; try { fixSideRuns(m); } catch {} return m; })(LS.get('sali.menu')),
  // остальные меню на устройстве (открытое — app.menu); как корзины: много, каждое можно открыть или удалить
  menus: (LS.get('sali.menus') || []).filter(m => m?.plan?.dishes?.length && m.weekStart),
  lib: null, libP: null,
  defs: LS.get('sali.defs', {}),
  allIngs: null,
  draft: LS.get('sali.draft'),
  myRecipes: null,
  build: null,
  ui: { day: null, recTab: 'all', q: '' },
};

// старт сборки с пустого экрана: «на сегодня» — все включённые приёмы только на сегодняшний день этой недели,
// «на неделю» — на все 7 дней; дальше обычный экран настроек и сборки
function startPlan(scope, day) {
  const p = app.profile, one = scope !== 'week', d = one ? (day ?? new Date().getDay()) : null;
  if (!MEAL_ORDER.some(m => p.meals[m]?.on)) { p.meals['ужин'] ||= { on: true, days: [] }; p.meals['ужин'].on = true; }
  // каждый раз с исходного положения: дни у ВСЕХ приёмов пищи (и выключенных — их могут включить в диалоге)
  for (const m of MEAL_ORDER) { p.meals[m] ||= { on: false, days: [] }; p.meals[m].days = one ? [d] : m === 'в школу' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6]; }
  // один день в уже собранное меню — дописываем в него (та же неделя); иначе — новое меню
  const merge = one && !!app.menu?.plan?.dishes?.length;
  if (one) { p.weekMode = merge ? (app.menu.weekStart === weekStartFor('next') ? 'next' : 'this') : 'this'; if (p.friday && d !== 5) p.friday.on = false; }
  else p.weekMode = 'auto';
  app.ui.planScope = one ? 'today' : 'week'; app.ui.planDay = d; app.ui.planMerge = merge;
  saveProfile(); go('#/start');
}
function saveProfile() {
  LS.set('sali.profile', app.profile);
  if (app.user) debounce('profile', 1000, () => sb.from('user_profiles').upsert({ user_id: app.user.id, family: app.profile }).then(({ error }) => error && console.warn(error)));
}
const menuOk = m => !!(m?.plan?.dishes?.length && m.plan.days?.length);
const newLid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// у каждого меню свой номер: меню на одну и ту же дату или неделю может быть сколько угодно — различаем по номеру
const nextMenuNum = () => 1 + Math.max(0, ...[app.menu, ...app.menus].filter(Boolean).map(x => x.num || 0));
function ensureLid(m) { if (m && !m.lid) m.lid = newLid(); if (m && !m.num) m.num = nextMenuNum(); return m; }
const saveMenus = () => LS.set('sali.menus', app.menus);
// старые меню без номера — пронумеровать по дате создания
(() => {
  const all = [app.menu, ...app.menus].filter(Boolean), todo = all.filter(m => !m.num).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!todo.length) return;
  let n = Math.max(0, ...all.map(m => m.num || 0));
  todo.forEach(m => { m.num = ++n; });
  saveMenus(); if (app.menu) LS.set('sali.menu', app.menu);
})();
// открытое меню — в список (перед тем как открыть или собрать другое)
function archiveMenu() {
  const m = app.menu; if (!m || !menuOk(m)) return;
  ensureLid(m);
  app.menus = [m, ...app.menus.filter(x => x.lid !== m.lid && !(m.savedId && x.savedId === m.savedId))].slice(0, 40);
  saveMenus();
}
// открыть меню из списка на устройстве
function takeMenu(lid) {
  const m = app.menus.find(x => x.lid === lid); if (!m) return false;
  archiveMenu();
  app.menus = app.menus.filter(x => x.lid !== lid); saveMenus();
  app.menu = m; app.ui.day = null; LS.set('sali.menu', m);
  return true;
}
// посчитать что-то для другого (не открытого) меню
function withMenu(m, f) { const s = app.menu; app.menu = m; try { return f(); } finally { app.menu = s; } }
function saveMenu(opts = {}) {
  if (!app.menu) { LS.set('sali.menu', null); return; }
  if (!menuOk(app.menu)) return;
  ensureLid(app.menu);
  app.menu.updatedAt = Date.now();
  LS.set('sali.menu', app.menu);
  if (app.user && !opts.local) debounce('menu', 900, cloudSaveMenu);
}
async function cloudSaveMenu() {
  const m = app.menu; if (!m || !app.user || !menuOk(m)) return;
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
// на сколько дней меню: заполненные дни; подписи «неделя / сегодня / вторник / 3 дня»
function menuSpan(m = app.menu) {
  const days = (m?.plan?.days || []).map((d, i) => (d?.meals?.length ? i : -1)).filter(i => i >= 0);
  const n = days.length, week = n === 0 || n === 7;
  const one = n === 1 ? days[0] : null, d = one != null ? addDays(m.weekStart, one) : null;
  const isToday = d && isoDate(d) === isoDate(new Date());
  const acc = one != null ? (isToday ? 'сегодня' : DAYS_FULL[one].replace(/а$/, 'у')) : null;
  return {
    n, week, one,
    on: week ? 'на неделю' : one != null ? 'на ' + acc : `на ${n} ${plural(n, 'день', 'дня', 'дней')}`,
    date: d ? `${DAYS_FULL[one]}, ${d.getDate()} ${MONTHS[d.getMonth()]}` : weekLabel(m.weekStart),
  };
}
function menuTitle(m) {
  const sp = menuSpan(m);
  const per = sp.week ? weekLabel(m.weekStart) : sp.one != null ? sp.date : `${sp.n} ${plural(sp.n, 'день', 'дня', 'дней')}, ${weekLabel(m.weekStart)}`;
  return `Меню${m?.num ? ' ' + m.num : ''} · ${per}`;
}
// сколько человек едят: число; старые профили (со списками взрослых и детей) — по длине списков
function eaters(p = app.profile) { return Math.max(1, Number(p?.people) || ((p?.adults?.length || 0) + (p?.kids?.length || 0)) || 4); }
function boxes(p = app.profile) { return Math.max(1, Number(p?.boxes) || p?.kids?.length || 1); }

// ---------- вызовы сервера ----------
async function fn(name, body, auth) {
  // auth: передать токен вошедшего пользователя (функции, которые пишут от его имени)
  const tok = auth && sb ? (await sb.auth.getSession()).data.session?.access_token : null;
  const r = await fetch(FN + name, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });
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
// ключей нет в справочнике — больше не спрашиваем в этой сессии
const defMiss = new Set();
async function loadDefs(keys) {
  const need = [...new Set(keys)].filter(k => k && k !== 'water' && !defMiss.has(k) && (!app.defs[k] || app.defs[k].icon === undefined || (app.defs[k].img === undefined && Date.now() - (app.defs[k]._at || 0) > 36e5)));
  for (let i = 0; i < need.length; i += 80) {
    const part = need.slice(i, i + 80);
    const q = encodeURIComponent(`(${part.map(k => `"${k}"`).join(',')})`);
    const r = await fetch(`${REST}g_ingredients?select=key,name_ru,name_he,base_unit,piece_g,tbsp_g,tsp_g,category,pantry,icon,img&key=in.${q}`, { headers: { apikey: KEY } });
    if (r.ok) for (const d of await r.json()) app.defs[d.key] = { ...d, img: d.img || undefined, _at: Date.now() };
    // ключа нет в справочнике — помечаем, чтобы не запрашивать по кругу
    if (r.ok) for (const k of part) { if (!app.defs[k]) { defMiss.add(k); continue; } if (app.defs[k].icon === undefined) app.defs[k].icon = null; app.defs[k]._at ||= Date.now(); }
  }
  LS.set('sali.defs', app.defs);
  return app.defs;
}
async function loadAllIngs() {
  if (app.allIngs) return app.allIngs;
  const r = await fetch(`${REST}g_ingredients?select=key,name_ru,name_he,base_unit,piece_g,tbsp_g,tsp_g,category,pantry,icon&recipe=eq.true&is_group=eq.false&order=name_ru&limit=5000`, { headers: { apikey: KEY } });
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
    const { note: _n, note_en: _ne, note_he: _nh, ...rest } = x; // пояснение относилось к прежнему количеству
    return { ...rest, amount: a };
  });
}

// ---------- меню: слоты, блюда, рецепты ----------
const dishById = id => app.menu?.plan?.dishes?.find(d => d.id === id);
const recipeOf = id => app.menu?.recipes?.[id];
function slots(dayI) {
  const day = app.menu.plan.days[dayI]; if (!day) return [];
  return day.meals.map((s, mi) => ({ ...s, mi, dayI, dish: dishById(s.dish_id), side: s.side_id ? dishById(s.side_id) || null : null })).filter(s => s.dish)
    .sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal));
}
function allSlots() { const out = []; for (let i = 0; i < 7; i++) out.push(...slots(i)); return out; }
// сколько раз блюдо готовится за неделю (остатки не считаем)
// гарнир считается так же: варим, где нет side_leftovers
function cooks(dishId) { const n = allSlots().filter(s => (s.dish_id === dishId && !s.leftovers) || (s.side_id === dishId && !s.side_leftovers)).length; return Math.max(1, n); }
// id блюд, которые стоят в меню (основное и гарниры)
function usedIds(m = app.menu) { return new Set(m.plan.days.flatMap(d => d.meals.flatMap(s => s.side_id ? [s.dish_id, s.side_id] : [s.dish_id]))); }
// гарнир «на несколько дней»: в скольких приёмах этот гарнир и сколько раз его варим
function sideRun(s) { if (!s.side) return null; const all = allSlots().filter(x => x.side_id === s.side_id); return { n: all.length, cooks: all.filter(x => !x.side_leftovers).length }; }
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
  const ids = [...new Set(m.plan.dishes.map(d => d.recipe_id).filter(Boolean))].filter(id => !m.images?.[id]?.thumb || (m.images[id].thumb === m.images[id].full && !(timers['img' + id] > Date.now() - 600e3) && (timers['img' + id] = Date.now())));
  if (!ids.length) return;
  try {
    const rows = await rpc('menu_images', { p_ids: ids });
    m.images ||= {};
    let ch = false;
    for (const r of rows) if (r.thumb_url && m.images[r.id]?.thumb !== r.thumb_url) { m.images[r.id] = { thumb: r.thumb_url, full: r.image_url }; ch = true; }
    if (ch) saveMenu();
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
    let offers = null;
    for (let t = 0; t < 3 && !offers; t++) { try { offers = await rpc('g_ingredient_offers', { p_keys: part }); } catch (e) { console.warn(e); await sleep(800 * (t + 1)); } }
    if (!offers) return;
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
// порядок сетей: сначала те, где заказ дотягивает до минимума доставки, потом по сумме вместе с доставкой
const chainRank = (a, z) => (a.short > 0) - (z.short > 0) || withFee(a) - withFee(z);
function bestChain() { const ok = fullChains(); return ok.length ? ok.sort(chainRank)[0].chain : null; }
function priceChain() { return modeChain(app.menu?.chain || app.profile.chain) || bestChain(); }
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
// цена блюда; null — рецепт не загружен или ни один продукт пока не оценён
function dishCost(dish) { const r = recipeOf(dish?.id); if (!r) return null; const c = ingsCost(r.ingredients); return c.sum > 0 || !c.miss ? c.sum : null; }
// продукты меню без цен — дозапрашиваем (после сбоя запроса)
function unpricedKeys() { return [...new Set(Object.values(app.menu?.recipes || {}).flatMap(r => (r.ingredients || []).filter(i => i.key && i.key !== 'water' && !i.pantry && !unitCache[i.key]).map(i => i.key)))]; }
function slotCost(s) {
  const a = s.leftovers ? 0 : dishCost(s.dish), b = !s.side || s.side_leftovers ? 0 : dishCost(s.side);
  return a == null || b == null ? null : a + b;
}
function portionsOf(s) { return s.meal === 'в школу' ? boxes(app.menu.profile || app.profile) : eaters(app.menu.profile || app.profile); }

// нужное на неделю: по ключам, в базовых единицах
function weekNeed() {
  const m = app.menu, sum = {};
  const seen = new Set();
  for (const id of usedIds()) {
    if (seen.has(id)) continue; seen.add(id);
    const r = recipeOf(id); if (!r) continue;
    const k = cooks(id);
    for (const i of r.ingredients || []) {
      if (!i.key || i.key === 'water') continue;
      const q = toBase(i, app.defs[i.key]); if (q == null) continue;
      const e = (sum[i.key] ||= { key: i.key, qty: 0, pantry: true, dishes: new Set() });
      e.qty += q * k; if (!i.pantry) e.pantry = false; e.dishes.add(id);
    }
  }
  return Object.values(sum).map(e => ({ ...e, dishes: [...e.dishes], have: m.have?.[e.key] ?? e.pantry }));
}
// версия расчёта корзины: при смене правил (например, минимум для весового товара) корзины пересчитываются
const BASKET_V = 5;
const basketStale = m => !m?.basket || (m.basket.v || 0) < BASKET_V || Date.now() - m.basket.at > 12 * 3600e3 || (m.basket.shop || 'delivery') !== shopMode();
async function refreshPrices() {
  const m = app.menu; if (!m?.plan) return;
  const keys = Object.values(m.recipes || {}).flatMap(r => (r.ingredients || []).map(i => i.key)).filter(Boolean);
  await loadDefs(keys);
  await ensureUnits(keys);
  const need = weekNeed();
  m.have ||= {};
  for (const e of need) if (!(e.key in m.have)) m.have[e.key] = e.pantry;
  // цены — на все продукты недели, включая «есть дома»: убранное остаётся в корзине зачёркнутым, с товаром и ценой
  const buy = need.map(e => {
    const d = app.defs[e.key];
    const qty = d?.base_unit === 'шт' ? Math.ceil(e.qty - 0.01) : e.qty >= 100 ? Math.ceil(e.qty / 10) * 10 : Math.max(5, Math.ceil(e.qty / 5) * 5);
    return { key: e.key, qty };
  });
  if (!buy.length) { m.basket = { at: Date.now(), chains: [], qty: {} }; saveMenu(); return; }
  const shop = shopMode(), sig = JSON.stringify(buy);
  // обе корзины («с доставкой» и «в магазине») храним в меню: переключение без нового запроса, пока продукты те же
  m.baskets ||= {};
  const keep = m.baskets[shop];
  if (keep && keep.sig === sig && keep.v === BASKET_V && Date.now() - keep.at < 6 * 3600e3) { m.basket = keep; saveMenu(); return; }
  const b = await fn('basket', { need: buy, chains: SHOP[shop] });
  const chains = (b.all || []).map(c => ({
    chain: c.chain,
    lines: [...(c.lines || []), ...(c.subst || [])].map(l => ({ key: l.for || l.key, sub: l.substitute ? l.key : undefined, name: l.name, barcode: l.barcode, cost: Number(l.cost), regular: Number(l.regular), packs: l.packs, kg: l.kg, deal: l.deal })),
  }));
  m.basket = m.baskets[shop] = { v: BASKET_V, shop, sig, at: Date.now(), chains, qty: Object.fromEntries(buy.map(x => [x.key, x.qty])) };
  saveMenu();
}
// корзина с учётом «есть дома» и замен товаров: строка в сети, итоги по сетям
function lineIn(c, key) {
  const pk = app.menu.pick?.[key];
  if (pk && pk.chain === c.chain) return pk;
  return c.lines.find(l => l.key === key) || null;
}
function buyKeys() { const m = app.menu; return Object.keys(m.basket?.qty || {}).filter(k => !m.have?.[k]); }
function chainSum(c) {
  let total = 0, have = 0; for (const k of buyKeys()) { const l = lineIn(c, k); if (l) { total += l.cost; have++; } }
  const dv = delivOf(c.chain);   // с доставкой: стоимость доставки и сколько не хватает до минимального заказа
  return { chain: c.chain, total, have, fee: dv?.fee || 0, short: dv?.min ? Math.max(0, dv.min - total) : 0 };
}
const withFee = c => c.total + (c.fee || 0);
function chainSums() { return (app.menu?.basket?.chains || []).map(chainSum); }
// «полные» сети: где есть все продукты (при длинном списке прощаем один ненайденный)
function fullChains(cs = chainSums()) { if (!cs.length) return []; const full = Math.max(...cs.map(c => c.have)), tol = buyKeys().length >= 20 ? 1 : 0; return cs.filter(c => c.have >= full - tol); }
function weekRange() {
  const cs = chainSums(); if (!cs.length) return null;
  const ok = fullChains(cs);
  const from = Math.min(...ok.map(c => c.total));
  const mine = modeChain(app.menu.chain || app.profile.chain);
  const mc = mine && cs.find(c => c.chain === mine);
  return { from, to: mc ? mc.total : Math.max(...ok.map(c => c.total)) };
}
function totalPortions() { return allSlots().reduce((a, s) => a + portionsOf(s), 0) || 1; }

// ---------- параметры для модели ----------
function toParams(p) {
  const days = ds => ds.length === 7 ? 'каждый день' : ds.slice().sort().map(i => DAYS[i]).join(', ');
  const meals = MEAL_ORDER.filter(m => p.meals[m]?.on && p.meals[m].days.length).map(m => `${m} (${days(p.meals[m].days)})`);
  const extra = [p.wish, p.friday?.on ? `В пятницу ужин с гостями: всего ${p.friday.guests} человек — праздничный, побольше.` : '',
    `Неделя: ${weekLabel(weekStartFor(p.weekMode))}. Ставь приёмы пищи только в указанные дни.`].filter(Boolean).join('\n');
  return {
    people: `${eaters(p)} человек` + (p.meals['в школу']?.on ? `; коробочек в сад/школу: ${boxes(p)}` : ''),
    meals: meals.join('; ') || 'ужин (каждый день)',
    diet: p.diet.join(', '), allergies: p.allergies, dislikes: p.dislikes, likes: p.likes,
    time: `в будни до ${p.maxMin} минут, в выходные можно дольше`, budget: p.budget ? p.budget + ' ₪' : '', cuisine: p.cuisine, extra,
  };
}
function plannedCount(p = app.profile) {
  return MEAL_ORDER.reduce((a, m) => a + (p.meals[m]?.on ? p.meals[m].days.length : 0), 0) + (p.friday?.on && !(p.meals['ужин']?.on && p.meals['ужин'].days.includes(5)) ? 1 : 0);
}

// ---------- сборка меню ----------
// модель иногда расписывает всю неделю, хотя просили один день: оставляем только заказанные приёмы и дни
function keepAsked(plan, p) {
  const ok = (i, meal) => (p.meals[meal]?.on && p.meals[meal].days.includes(i)) || (meal === 'ужин' && i === 5 && p.friday?.on);
  const days = []; for (let i = 0; i < 7; i++) { const d = plan.days[i] || {}; days.push({ ...d, meals: (d.meals || []).filter(x => ok(i, x.meal)) }); }
  plan.days = days;
  const used = new Set(days.flatMap(d => d.meals.flatMap(x => [x.dish_id, x.side_id]).filter(Boolean)));
  plan.dishes = plan.dishes.filter(d => used.has(d.id));
}
async function buildMenu() {
  const p = JSON.parse(JSON.stringify(app.profile));
  const b = app.build = { step: 0, done: 0, total: 0, error: null, msg: '', scope: app.ui.planScope, day: app.ui.planDay, merge: app.ui.planScope === 'today' && app.ui.planMerge && !!app.menu?.plan };
  go('#/building');
  const upd = () => { if (location.hash === '#/building') render(); };
  try {
    const params = toParams(p);
    // план: проверяем полноту (у каждого приёма есть блюдо), неполный — повторяем один раз
    let plan = null, lastErr = null;
    for (let attempt = 0; attempt < 2 && !plan; attempt++) {
      try {
        const res = await fn('menu-plan', { params });
        const pl = res.result, ids = new Set((pl?.dishes || []).map(d => d.id));
        const slotsN = (pl?.days || []).flatMap(d => d.meals || []);
        if (pl?.dishes?.length && slotsN.length && slotsN.every(x => ids.has(x.dish_id))) {
          keepAsked(pl, p);
          if (pl.days.some(d => d.meals.length)) plan = pl; else lastErr = new Error('модель не поставила блюда в выбранные дни');
        } else lastErr = new Error('модель вернула неполное меню');
      } catch (e) { lastErr = e; if (/Лимит/.test(e.message)) break; }
      if (!plan && attempt === 0) { b.msg = 'Первая попытка не удалась — пробуем ещё раз'; upd(); }
    }
    if (!plan) throw new Error((lastErr?.message || 'Не получилось') + '. Попробуйте ещё раз — или уберите пару приёмов пищи.');
    if (b.merge) { const sfx = '_' + Date.now().toString(36).slice(-4), mp = id => id && id + sfx;
      for (const d of plan.dishes) d.id = mp(d.id);
      for (const d of plan.days) for (const x of d.meals) { x.dish_id = mp(x.dish_id); if (x.side_id) x.side_id = mp(x.side_id); } }
    const m = { v: 1, createdAt: Date.now(), weekStart: weekStartFor(p.weekMode), profile: p, params, plan, recipes: {}, images: {}, have: {}, chain: p.chain || '' };
    fixSideRuns(m);
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
    if (b.merge && app.menu?.plan) {
      // дописываем день в текущее меню: блюда, рецепты, приёмы этого дня
      const base = app.menu;
      base.plan.dishes.push(...plan.dishes);
      Object.assign(base.recipes, m.recipes);
      plan.days.forEach((d, i) => { if (!d.meals.length) return; base.plan.days[i] ||= { meals: [] }; base.plan.days[i].meals.push(...d.meals); });
      base.plan.summary = base.plan.summary || plan.summary;
      fixSideRuns(base); app.menu = base; app.ui.day = b.day;
    } else { archiveMenu(); app.menu = ensureLid(m); app.ui.day = null; }
    b.step = 2; upd();
    await refreshImages();
    try { await refreshPrices(); } catch (e) { console.warn('prices', e); }
    b.step = 3; upd();
    await sleep(500);
    b.step = 4;
    saveMenu();
    app.build = null; app.ui.planScope = null; app.ui.planMerge = false;
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
// продукты меню поменялись — сохранённые корзины режимов больше не годятся
function schedulePrices() { if (app.menu) app.menu.baskets = {}; debounce('prices', 600, () => refreshPrices().then(() => render()).catch(e => console.warn(e))); }

// ---------- изменения меню ----------
async function libRecipeFull(id) { return rpc('menu_recipe', { p_id: id }); }
// ---------- переводы рецептов (описание, шаги, совет) на английский и иврит — таблица menu_recipe_tr ----------
const recipeTr = {};
async function loadRecipeTr(ids) {
  if (APP_LANG === 'ru') return false;
  const need = [...new Set(ids)].filter(id => id && /^[0-9a-f-]{36}$/i.test(id) && !(id in recipeTr));
  if (!need.length) return false;
  need.forEach(id => { recipeTr[id] = null; });
  try {
    const r = await fetch(`${REST}menu_recipe_tr?select=recipe_id,description,steps,tip&lang=eq.${APP_LANG}&recipe_id=in.(${need.join(',')})`, { headers: { apikey: KEY } });
    if (!r.ok) throw new Error('menu_recipe_tr: ' + r.status);
    let got = false;
    for (const x of await r.json()) { recipeTr[x.recipe_id] = x; got = true; }
    return got;
  } catch (e) { need.forEach(id => { delete recipeTr[id]; }); return false; }
}
// рецепт на языке интерфейса: переведённые описание, шаги и совет (шаги — только если их столько же, сколько в оригинале)
function withTr(r, id) {
  const t = r && recipeTr[id || r.recipe_id || r.id];
  if (!t) return r;
  const steps = Array.isArray(t.steps) && t.steps.length === (r.steps || []).length ? t.steps : r.steps;
  return { ...r, description: r.description && t.description || r.description, steps, tip: r.tip && t.tip || r.tip };
}
// поставить рецепт (из библиотеки или свой) в слот: replace — заменить блюдо во всех слотах с тем же блюдом
// новое блюдо меню из рецепта (библиотека или свой)
function addDish(src, meal, portions) {
  const m = app.menu, id = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const dish = { id, name: src.name, meals: src.meals?.length ? src.meals : [meal], description: src.description || '', cook_minutes: src.cook_minutes || src.minutes || 30,
    portions, kcal: src.kcal || null, tags: src.tags || [], kind: src.kind || 'dish', side_id: src.side_id || undefined, sides_ok: src.sides_ok || undefined,
    recipe_id: src.lib ? src.id : undefined, own_id: src.own ? src.id : undefined, image: src.image_url && !src.lib ? src.image_url : undefined };
  const base = src.portions || portions;
  m.plan.dishes.push(dish);
  m.recipes[id] = { dish_id: id, recipe_id: dish.recipe_id, ingredients: scaleIngs(src.ingredients || [], portions / base), steps: src.steps || [], tip: src.tip || null, portions0: base, ingredients0: src.ingredients || [] };
  if (src.lib && src.image_url) { m.images ||= {}; m.images[src.id] = { thumb: src.thumb_url || src.image_url, full: src.image_url }; }
  return dish;
}
// неиспользуемые блюда и рецепты убираем
function pruneMenu() {
  const m = app.menu, used = usedIds(m);
  m.plan.dishes = m.plan.dishes.filter(d => used.has(d.id));
  for (const k of Object.keys(m.recipes)) if (!used.has(k)) delete m.recipes[k];
  saveMenu(); schedulePrices();
}
// поставить рецепт в слот: заменяет основное во всех слотах с тем же блюдом; гарнир остаётся,
// если новое блюдо — основное (целое блюдо идёт без гарнира)
function putDish(dayI, mi, src, opts = {}) {
  const m = app.menu, day = m.plan.days[dayI];
  const old = mi != null ? dishById(day.meals[mi]?.dish_id) : null;
  const meal = opts.meal || day.meals[mi]?.meal || 'ужин';
  const portions = old?.portions || (meal === 'в школу' ? boxes(m.profile) : eaters(m.profile)) * (opts.days || 1);
  const dish = addDish(src, meal, portions);
  if (old && mi != null) {
    for (const d of m.plan.days) for (const s of d.meals) if (s.dish_id === old.id) {
      s.dish_id = dish.id;
      if (dish.kind !== 'main') { delete s.side_id; delete s.side_leftovers; }
    }
  } else {
    day.meals.push({ meal, dish_id: dish.id });
  }
  pruneMenu();
  return dish;
}
// слоты, где стоит гарнир текущего слота (scope 'all') или только этот слот
function sideTargets(dayI, mi, scope) {
  const s0 = app.menu.plan.days[dayI].meals[mi];
  if (scope !== 'all' || !s0.side_id) return [s0];
  return app.menu.plan.days.flatMap(d => d.meals).filter(s => s.side_id === s0.side_id);
}
// гарнир: поставить (или заменить) — в одном слоте или во всех, где был тот же гарнир
function putSide(dayI, mi, src, scope = 'one') {
  const m = app.menu, s0 = m.plan.days[dayI].meals[mi];
  const ts = sideTargets(dayI, mi, scope);
  // гарнир на несколько дней варим сразу на все эти приёмы
  const runs = scope === 'all' ? ts.filter(s => s.side_leftovers).length + 1 : 1;
  const side = addDish({ ...src, kind: 'side' }, s0.meal, eaters(m.profile) * runs);
  ts.forEach(s => { s.side_id = side.id; if (scope !== 'all') delete s.side_leftovers; });
  fixSideRuns(); pruneMenu();
  return side;
}
// ближайший следующий обед/ужин с основным, куда можно отдать этот же гарнир (сварить один раз на 2 дня)
function nextSideSlot(dayI, s) {
  for (let i = dayI + 1; i < 7; i++) {
    const x = slots(i).find(y => y.meal === s.meal && y.side_id !== s.side_id && (y.dish.kind === 'main' || y.side));
    if (x) return x;
  }
  return null;
}
function extendSide(dayI, mi) {
  const s = slots(dayI).find(x => x.mi === mi), n = nextSideSlot(dayI, s); if (!n) return null;
  const t = app.menu.plan.days[n.dayI].meals[n.mi];
  t.side_id = s.side_id; t.side_leftovers = true;
  setPortions(s.side, s.side.portions + eaters(app.menu.profile || app.profile));
  fixSideRuns(); pruneMenu();
  return n;
}
function removeSide(dayI, mi, scope = 'one') {
  for (const s of sideTargets(dayI, mi, scope)) { delete s.side_id; delete s.side_leftovers; }
  fixSideRuns(); pruneMenu();
}
// первый по неделе приём блюда (и гарнира) — «готовим», дальше можно «остатки»:
// модель иногда ставит остатки в первый же день (особенно в меню на один день) — тогда готовить было бы нечего
function fixSideRuns(menu = app.menu) {
  const seenD = new Set(), seenS = new Set();
  for (const d of menu.plan.days) for (const s of [...(d.meals || [])].sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal))) {
    if (!seenD.has(s.dish_id)) { seenD.add(s.dish_id); if (s.leftovers) s.leftovers = false; }
    if (s.side_id && !seenS.has(s.side_id)) { seenS.add(s.side_id); s.side_leftovers = false; }
  }
}
function removeSlot(dayI, mi) {
  app.menu.plan.days[dayI].meals.splice(mi, 1);
  fixSideRuns(); pruneMenu();
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
    if (data?.family && Object.keys(data.family).length) { app.profile = fixProfile(Object.assign(defaultProfile(), data.family)); LS.set('sali.profile', app.profile); }
    else saveProfile();
  } catch (e) { console.warn(e); }
  // меню: несохранённое — в аккаунт; сохранённое — свежую версию из аккаунта; нет меню — последнее из аккаунта
  try {
    const m = app.menu;
    if (m?.plan && !m.savedId) await cloudSaveMenu();
    else if (m?.savedId) { const { data } = await sb.from('user_menus').select('id,state').eq('id', m.savedId).maybeSingle(); if (data && menuOk(data.state)) { app.menu = { ...data.state, savedId: data.id }; fixSideRuns(); LS.set('sali.menu', app.menu); } else if (!data) { app.menu = null; LS.set('sali.menu', null); } else { delete m.savedId; await cloudSaveMenu(); } }
    else { const { data } = await sb.from('user_menus').select('id,state').order('updated_at', { ascending: false }).limit(5); const ok = (data || []).find(x => menuOk(x.state) && x.state.weekStart); if (ok) { app.menu = { ...ok.state, savedId: ok.id }; LS.set('sali.menu', app.menu); } }
  } catch (e) { console.warn(e); }
  // черновик рецепта, который ждал входа
  const after = LS.get('sali.after'); LS.set('sali.after', null);
  if (after && location.hash !== after) go(after); else render();
}
async function openMenu(id) {
  const { data, error } = await sb.from('user_menus').select('id,state').eq('id', id).single();
  if (error) { toast('Не открылось: ' + error.message); return; }
  if (!menuOk(data.state) || !data.state.weekStart) { toast('Это меню неполное или из старой версии — откройте другое или соберите новое'); return; }
  if (app.menu?.savedId !== data.id) archiveMenu();
  app.menu = ensureLid({ ...data.state, savedId: data.id }); app.ui.day = null;
  app.menus = app.menus.filter(x => x.savedId !== data.id && x.lid !== app.menu.lid); saveMenus();
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
    // нижняя панель — до after(): там к её кнопкам привязываются действия
    $('#dock').innerHTML = r.dock ? r.dock() : '';
    r.after && r.after(view, ...m.slice(1));
    rowArrows(view);
    app.ui.tab = r.tab || null;
    if (h !== lastPath) { window.scrollTo(0, 0); lastPath = h; }
    renderChrome();
    return;
  }
  go(app.menu ? '#/today' : '#/start');
}
// горизонтальные ряды карточек («Мои корзины», «Мои меню»): стрелки ‹ › по краям, видны, когда есть куда листать
function rowArrows(view) {
  $$('.mm-row', view).forEach(row => {
    if (row.parentElement?.classList.contains('mm-wrap')) return;
    const wrap = document.createElement('div'); wrap.className = 'mm-wrap';
    row.before(wrap); wrap.appendChild(row);
    const mk = (dir, label) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mm-arr mm-arr-' + dir; b.setAttribute('aria-label', label);
      b.innerHTML = ico('back', 18, '#151515', 2.4); b.onclick = () => row.scrollBy({ left: (dir === 'r' ? 1 : -1) * Math.max(160, row.clientWidth * 0.8), behavior: 'smooth' }); wrap.appendChild(b); return b; };
    const l = mk('l', 'Листать назад'), r = mk('r', 'Листать дальше');
    const upd = () => { const max = row.scrollWidth - row.clientWidth; l.hidden = row.scrollLeft < 8; r.hidden = row.scrollLeft > max - 8; wrap.classList.toggle('more', row.scrollLeft < max - 8); };
    row.addEventListener('scroll', upd, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(upd).observe(row);
    new MutationObserver(upd).observe(row, { childList: true });
    upd();
  });
}
function renderChrome() {
  const tab = app.ui.tab;
  const tabs = [['menu', '#/menu', 'Меню', 'menu'], ['recipes', '#/recipes', 'Рецепты', 'book'], ['deals', '#/deals', 'Акции', 'tag'], ['basket', '#/baskets', 'Товары', 'cart']];
  $('#tabs').innerHTML = tabs.map(([k, href, t, i]) => `<a href="${href}" class="${tab === k ? 'on' : ''}" ${tab === k ? 'aria-current="page"' : ''}>${ico(i, 22, 'currentColor', 1.9)}${t}</a>`).join('');
  const u = app.user, unsaved = app.menu?.plan && !u && tab !== 'menu';
  const av = u ? (u.user_metadata?.avatar_url ? `<img src="${esc(u.user_metadata.avatar_url)}" alt="" referrerpolicy="no-referrer">` : esc((u.email || '?')[0].toUpperCase())) : ico('user', 20);
  $('#top').innerHTML = `<div class="top-in"><a class="brand" href="${app.menu ? '#/today' : '#/start'}" aria-label="Sali — на главную"><img class="brand-lg" src="logos/sali.svg" alt="Sali"></a>
    <nav class="top-nav" aria-label="Разделы">${tabs.filter(t => t[0] !== 'menus').map(([k, href, t]) => `<a href="${href}" class="${tab === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <span class="top-sp"></span>
    ${unsaved ? `<button class="save-chip" data-act="save">Сохранить меню</button>` : ''}
    <span class="lang-sw" role="group" aria-label="Язык">${[['ru', 'RU'], ['en', 'EN'], ['he', 'עב']].map(([l, t]) => `<button data-lang="${l}" aria-pressed="${APP_LANG === l}"${l === 'he' ? ' lang="he"' : ''}>${t}</button>`).join('')}</span>
    <a class="av-btn" href="#/account" aria-label="${u ? 'Мой кабинет' : 'Войти'}">${av}</a></div>`;
  $$('[data-lang]', $('#top')).forEach(b => b.onclick = () => { if (b.dataset.lang === APP_LANG) return; LS.set('sali.lang', b.dataset.lang); location.reload(); });
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
// установленное приложение на Android: внешние ссылки (сайты сетей) — в обычном браузере, а не во встроенном окне,
// чтобы корзину на сайте сети можно было собирать в одной вкладке и возвращаться к ней
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
document.addEventListener('click', e => {
  if (!STANDALONE || !/Android/i.test(navigator.userAgent) || e.defaultPrevented) return;
  const a = e.target.closest('a[href]'); if (!a) return;
  let u; try { u = new URL(a.href); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return;
  e.preventDefault();
  location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
});
