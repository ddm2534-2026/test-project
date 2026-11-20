// Сбор карточек Шуферсаля (состав, аллергены, пищевая ценность) в браузере пользователя в Израиле.
// Вставляется во вкладку https://www.shufersal.co.il/online/he/ через javascript_tool; __TOKEN__ — временный пропуск
// из g_worker_tokens (scope 'shuf'), ключа базы в браузере нет. Окно robots.txt 04:00–08:45 UTC, 10–12 с между карточками.
(() => {
  const SBU = 'https://iavsoiirixtvkcszzfzd.supabase.co/rest/v1/rpc/', AK = 'sb_publishable_iyk2egos5cGAWztXikEigA_gfIlzAWr';
  window.__TOK = '__TOKEN__';
  window.__sbrpc = async (fn, body) => { const r = await fetch(SBU + fn, { method: 'POST', headers: { apikey: AK, Authorization: 'Bearer ' + AK, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(fn + ' ' + r.status + ' ' + (await r.text()).slice(0, 200)); const t = await r.text(); return t ? JSON.parse(t) : null; };
  window.__shufParse = (() => {
    const un = s => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
    const text = s => { if (s == null) return null; s = s.replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, ' '); s = un(s.replace(/\s+/g, ' ')).trim().replace(/^[ ,]+|[ ,]+$/g, ''); return s.replace(/\s*,\s*,\s*/g, ', ') || null; };
    const block = (p, cls) => { const m = p.match(new RegExp(`<div class="${cls}"[^>]*>([\\s\\S]*?)</div>`)); return m ? text(m[1]) : null; };
    const unitKg = page => { const t = un(page.replace(/<[^>]+>/g, ' ')); const m = t.match(/הערכת\s+משקל\s*:?\s*(\d+(?:[.,]\d+)?)\s*(ק"ג|קג|ק״ג|קילו|גרם|גר)/); if (!m) return null; let v = parseFloat(m[1].replace(',', '.')); if (m[2].startsWith('גר')) v /= 1000; return v >= 0.01 && v <= 30 ? Math.round(v * 1000) / 1000 : null; };
    const parse = page => {
      const i = page.indexOf('<ul class="productContainer"'); if (i < 0) return null;
      const j = page.indexOf('legalNotes', i); const p = page.slice(i, j > 0 ? j : i + 60000);
      const data = {}; const dl = p.match(/<ul class="dataList">([\s\S]*?)<\/ul>/);
      for (const m of (dl ? dl[1] : '').matchAll(/<div class="name">([\s\S]*?)<\/div>\s*<div class="text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) { const k = text(m[1]), v = text(m[2]); if (k && v) data[k.replace(/:$/, '')] = v; }
      const nut = []; for (const m of p.matchAll(/<div class="nutritionItem">\s*<div class="number[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="name">([\s\S]*?)<\/div>\s*<div class="text">([\s\S]*?)<\/div>/g)) nut.push({ name: text(m[3]), value: text(m[1]), unit: text(m[2]) });
      const per = p.match(/nutritionListTitle[\s\S]*?<div class="subInfo">([\s\S]*?)<\/div>/);
      const marks = [...p.matchAll(/<div class="markingItem">[\s\S]*?<div class="text">([\s\S]*?)<\/div>/g)].map(m => text(m[1])).filter(Boolean);
      const rem = p.match(/<div class="remarksText">([\s\S]*?)<\/div>\s*<\/div>/);
      return { found: true, ingredients: (block(p, 'componentsText') || '').replace(/\.?ttrn$/, '.') || null, contains: block(p, 'alergiesProperties'), may_contain: block(p, 'alergiesTracesProperties'), features: block(p, 'featuresList'), health_marks: marks.length ? marks : null, nutrition: nut.length ? { per: per ? text(per[1]) : null, items: nut } : null, data: Object.keys(data).length ? data : null, remark: rem ? text(rem[1]) : null };
    };
    const code = b => /^729000\d{7}$/.test(b) ? String(parseInt(b.slice(6), 10)) : b;
    return async b => { const r = await fetch(`/online/he/p/P_${code(b)}`, { credentials: 'same-origin' }); if (r.status === 404) return { found: false, status: 404 }; if (!r.ok) return { stop: r.status }; const page = await r.text(); const row = parse(page) || { found: false }; const uk = unitKg(page); if (uk) row.unit_kg = uk; const og = page.match(/property="og:image"\s+content="([^"]+)"/); if (og && !/default|placeholder/i.test(og[1])) row.image_url = og[1]; return row; };
  })();
  if (window.__sw?.running) return 'already running';
  const S = window.__sw = { running: true, done: 0, found: 0, rich: 0, errors: 0, saved: 0, stop: null, last: null, started: new Date().toISOString() };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const inWin = () => { const d = new Date(), m = d.getUTCHours() * 60 + d.getUTCMinutes(); return m >= 240 && m < 525; };
  const retry = async (fn, tries = 4) => { for (let i = 1; ; i++) { try { return await fn(); } catch (e) { S.errors++; S.last = e.message; if (i >= tries) throw e; await sleep(15000 * i); } } };
  (async () => {
    let buf = [], lastReq = 0;
    const flush = async () => { if (!buf.length) return; const rows = buf; buf = []; try { await retry(() => window.__sbrpc('shuf_info_save_w', { p_token: window.__TOK, p_rows: rows })); S.saved += rows.length; } catch (e) { S.last = 'save: ' + e.message; buf = rows.concat(buf); } };
    try {
      while (S.running) {
        if (!inWin()) { S.stop = 'окно закончилось'; break; }
        await flush();
        const todo = await retry(() => window.__sbrpc('shuf_info_todo_w', { p_token: window.__TOK, p_limit: 30 }));
        if (!todo?.length) { S.stop = 'очередь пуста'; break; }
        for (const b of todo) {
          if (!S.running || !inWin()) break;
          const wait = 10000 + Math.random() * 2000 - (Date.now() - lastReq); if (wait > 0) await sleep(wait);
          lastReq = Date.now();
          let row;
          try { row = await window.__shufParse(b); } catch (e) { S.errors++; S.last = b + ': ' + e.message; continue; }
          if (row.stop) { S.stop = 'сайт ответил ' + row.stop; S.running = false; break; }
          delete row.status;
          buf.push({ barcode: b, ...row }); S.done++; S.found += !!row.found; S.rich += !!(row.ingredients || row.nutrition);
          if (buf.length >= 10) await flush();
        }
      }
    } catch (e) { S.stop = 'ошибка: ' + e.message; }
    await flush(); S.running = false; S.ended = new Date().toISOString();
  })();
  return 'started';
})()
