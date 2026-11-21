// Номера карточек Тив Таам (catalogProduct) по штрихкоду — в браузере пользователя в Израиле (API сети отвечает только оттуда).
// Вставляется во вкладку https://www.tivtaam.co.il/ через javascript_tool; __TOKEN__ — временный пропуск из g_worker_tokens
// (scope 'storai'), ключа базы в браузере нет. Crawl-delay из robots.txt — 4 с, держим 4,5 с между запросами.
// Очередь: нажатые «На сайте», товары в акциях, товары под рецепты, остальной ассортимент. Остановить: window.__sl.running = false.
(() => {
  const SBU = 'https://iavsoiirixtvkcszzfzd.supabase.co/rest/v1/rpc/', AK = 'sb_publishable_iyk2egos5cGAWztXikEigA_gfIlzAWr';
  const TOK = '__TOKEN__', RETAILER = 1062, BRANCH = 924, PAUSE = 4500;
  const rpc = async (fn, body) => {
    const r = await fetch(SBU + fn, { method: 'POST', headers: { apikey: AK, Authorization: 'Bearer ' + AK, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${fn} ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  if (window.__sl?.running) return 'already running';
  const S = window.__sl = { running: true, done: 0, found: 0, saved: 0, errors: 0, stop: null, last: null, started: new Date().toISOString() };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const lookup = async b => {
    const q = new URLSearchParams({ appId: 4, barcode: b, from: 0, size: 1 });
    const r = await fetch(`/v2/retailers/${RETAILER}/branches/${BRANCH}/products?${q}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (r.status === 403 || r.status === 429) return { stop: r.status };
    if (!r.ok) return { err: r.status };
    const d = await r.json();
    for (const p of d.products || []) {
      const br = p.branch || {};
      if (p.productId && br.isActive && br.isVisible && (br.regularPrice || 0) > 0) return { id: p.productId };
    }
    return { id: null };
  };
  (async () => {
    let buf = [];
    const flush = async () => { if (!buf.length) return; const rows = buf; buf = []; await rpc('storai_put_w', { p_token: TOK, p_rows: rows }); S.saved += rows.length; };
    try {
      while (S.running) {
        const todo = await rpc('storai_todo_w', { p_token: TOK, p_limit: 30 });
        if (!todo?.length) { S.stop = 'очередь пуста'; break; }
        for (const { barcode } of todo) {
          if (!S.running) break;
          let res;
          try { res = await lookup(barcode); } catch (e) { S.errors++; S.last = e.message; await sleep(PAUSE * 3); continue; }
          if (res.stop) { S.stop = `сайт ответил ${res.stop}`; S.running = false; break; }
          if (res.err) { S.errors++; S.last = `HTTP ${res.err}`; buf.push({ chain: 'tivtaam', barcode, product_id: null }); } // не зацикливаемся: проверим снова через 30 дней
          else { buf.push({ chain: 'tivtaam', barcode, product_id: res.id }); S.done++; if (res.id) S.found++; }
          if (buf.length >= 30) await flush();
          await sleep(PAUSE);
        }
        await flush();
      }
    } catch (e) { S.stop = 'ошибка: ' + e.message; }
    try { await flush(); } catch (e) { S.last = e.message; }
    S.running = false; S.finished = new Date().toISOString();
  })();
  return 'started';
})();
