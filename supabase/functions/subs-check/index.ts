// Подписки на корзины и товары: раз в день пересчитываем корзины по сетям и смотрим акции, шлём пуш и письмо.
//  cron:  POST {token}                          — пропуск из g_worker_tokens (scope 'subs'), все активные подписки
//  user:  POST {action:'init'}  + токен входа   — исходная цена для новых подписок пользователя (без уведомлений)
//         POST {action:'test'}  + токен входа   — тестовое уведомление себе по выбранным каналам
//         GET  ?vapid=1                         — публичный ключ для пуш-подписки в браузере
import { sendPush } from "./push.ts";
import { APP, chainRu, type Deal, type Msg, tplCartDeals, tplCartDrop, tplProduct, tplTest } from "./tpl.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") || "Sali <onboarding@resend.dev>";
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const SHOP: Record<string, string[]> = {
  delivery: ["shufersal", "ramilevy", "victory", "tivtaam", "keshet"],
  store: ["shufersal_deal", "shufersal_sheli", "shufersal_express", "ramilevy_store", "victory_store", "tivtaam_store", "keshet_store", "yochananof", "osherad"],
};

const rest = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status} ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
};
const rpc = (fn: string, body: unknown) => rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });

async function userId(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SR, Authorization: auth } });
  return r.ok ? ((await r.json())?.id as string) || null : null;
}

let vapid: { pub: string; priv: string } | null = null;
async function loadVapid() {
  if (vapid) return vapid;
  const rows = await rest("app_secrets?select=name,value&name=in.(vapid_public,vapid_private)");
  const m = Object.fromEntries(rows.map((r: { name: string; value: string }) => [r.name, r.value]));
  vapid = { pub: m.vapid_public, priv: m.vapid_private };
  return vapid;
}

type Sub = { id: string; user_id: string; kind: string; ref: string; title: string; email: boolean; push: boolean; cond: Record<string, unknown>; base: Record<string, unknown> | null; state: Record<string, unknown> };

const emails: Record<string, string> = {};
async function emailOf(uid: string) {
  if (uid in emails) return emails[uid];
  const r = await fetch(`${SB}/auth/v1/admin/users/${uid}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  emails[uid] = r.ok ? (await r.json())?.email || "" : "";
  return emails[uid];
}
async function log(uid: string, sub: string | null, channel: string, m: Msg, ok: boolean, error?: string) {
  await rest("notify_log", { method: "POST", body: JSON.stringify({ user_id: uid, sub_id: sub, channel, title: m.title, body: m.body, url: m.url, ok, error: error?.slice(0, 300) }) }).catch(() => {});
}
async function notify(uid: string, sub: { id: string | null; email: boolean; push: boolean }, m: Msg) {
  const sent: string[] = [];
  if (sub.push) {
    await loadVapid();
    const subs = await rest(`push_subs?select=id,endpoint,p256dh,auth&user_id=eq.${uid}`);
    for (const p of subs) {
      try {
        const r = await sendPush(p, JSON.stringify({ url: m.url, ...m.push }), { ...vapid!, subject: APP });
        if (r.ok) { sent.push("push"); await log(uid, sub.id, "push", m, true); }
        else {
          if (r.status === 404 || r.status === 410) await rest(`push_subs?id=eq.${p.id}`, { method: "DELETE" }).catch(() => {});
          await log(uid, sub.id, "push", m, false, `${r.status} ${r.text}`);
        }
      } catch (e) { await log(uid, sub.id, "push", m, false, (e as Error).message); }
    }
    if (!subs.length) await log(uid, sub.id, "push", m, false, "нет пуш-подписки на устройстве");
  }
  if (sub.email) {
    const to = await emailOf(uid);
    if (!RESEND) await log(uid, sub.id, "email", m, false, "нет RESEND_API_KEY");
    else if (to) {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: m.email.subject, html: m.email.html, text: `${m.title}\n${m.body}\n\n${m.url}` }) });
      const ok = r.ok; if (ok) sent.push("email");
      await log(uid, sub.id, "email", m, ok, ok ? undefined : (await r.text()).slice(0, 300));
    }
  }
  return sent;
}

// корзина: лучшая одна сеть (где есть больше всего товаров, из них — дешевле), без доставки
async function cartNow(s: Sub) {
  const rows = await rest(`user_baskets?select=state&id=eq.${encodeURIComponent(s.ref)}&user_id=eq.${s.user_id}`);
  const st = rows?.[0]?.state; if (!st) return null;
  const items = (st.items || []).filter((i: { have?: boolean; barcode?: string; key?: string }) => !i.have && (i.barcode || i.key))
    .map((i: { id: string; barcode?: string; key?: string; qty?: number; kg?: number }) => ({ id: i.id, barcode: i.barcode, key: i.key, qty: i.qty, kg: i.kg }));
  if (!items.length) return null;
  const shop = s.cond.shop === "store" ? "store" : "delivery";
  const cmp = await rpc("g_cart_compare", { p_items: items, p_chains: SHOP[shop] });
  const best = (cmp?.chains || []).filter((c: { total: number }) => Number(c.total) > 0)
    .sort((a: { have: number; total: number }, b: { have: number; total: number }) => b.have - a.have || Number(a.total) - Number(b.total))[0];
  const sig = JSON.stringify(items.map((i: { barcode?: string; key?: string; qty?: number; kg?: number }) => [i.barcode, i.key, i.qty, i.kg]).sort());
  return { st, items, best: best ? { sum: Number(best.total), chain: best.chain as string, have: best.have as number } : null, sig };
}
// одна лучшая акция на товар корзины (по самому большому %), не больше 6
function pickDeals(items: { barcode?: string; key?: string }[], deals: (Deal & { ingredient?: string })[]) {
  const out: Deal[] = [];
  for (const i of items) { const d = deals.find((x) => (i.barcode && x.barcode === i.barcode) || (i.key && x.ingredient === i.key)); if (d && !out.includes(d)) out.push(d); }
  return out.sort((a, b) => b.pct - a.pct);
}

async function checkSub(s: Sub, mode: "cron" | "init") {
  const state = { ...(s.state || {}) } as Record<string, unknown>;
  let base = s.base as Record<string, unknown> | null;
  const msgs: Msg[] = [];
  const c = s.cond || {};
  if (s.kind === "cart") {
    const now = await cartNow(s);
    if (!now?.best) return { skip: "пустая корзина" };
    const url = `${APP}#/cart/${now.st.id}`;
    const allDeals = c.deals_on || mode === "cron" ? await rpc("sub_deals", { p_barcodes: now.items.map((i: { barcode?: string }) => i.barcode).filter(Boolean), p_keys: now.items.map((i: { key?: string }) => i.key).filter(Boolean) }) : [];
    const picked = pickDeals(now.items, allDeals);
    if (!base || base.sig !== now.sig) { base = { sum: now.best.sum, chain: now.best.chain, have: now.best.have, sig: now.sig, at: new Date().toISOString() }; state.low = now.best.sum; }
    else if (mode === "cron" && now.best.have >= Number(base.have)) {
      const was = Number(base.sum), cur = now.best.sum, drop = was - cur, pct = drop / was * 100;
      const hit = (c.pct_on && pct >= Number(c.pct || 10)) || (c.ils_on && drop >= Number(c.ils || 50));
      if (hit && cur < Number(state.low ?? was) - 0.5) {
        msgs.push(tplCartDrop({ title: s.title, was, now: cur, chain: now.best.chain, url, deals: picked }));
        state.low = cur;
      }
    }
    if (c.deals_on) {
      const sig = picked.map((d) => d.chain + d.barcode + d.deal).sort().join(",");
      if (picked.length >= Number(c.deals || 3) && sig !== state.deals_sig) {
        if (mode === "cron" && !msgs.length) msgs.push(tplCartDeals({ title: s.title, n: picked.length, deals: picked, url }));
        state.deals_sig = sig;
      }
    }
  } else {
    const deals = await rpc("sub_deals", { p_barcodes: [s.ref], p_keys: [] });
    const exact = deals.filter((d: { exact: boolean }) => d.exact);
    const sig = exact.map((d: { chain: string; deal: number; ends: string }) => `${d.chain}:${d.deal}:${d.ends}`).sort().join(",");
    if (exact.length && sig !== state.deals_sig && mode === "cron") msgs.push(tplProduct({ title: s.title, deals: exact }));
    state.deals_sig = sig;
    base ||= { at: new Date().toISOString() };
  }
  for (const m of msgs) await notify(s.user_id, s, m);
  await rest(`user_subs?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ base, state, checked_at: new Date().toISOString() }) });
  return { sent: msgs.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") { const v = await loadVapid(); return out({ vapid: v.pub }); }
    const body = await req.json().catch(() => ({}));
    if (body.token) {
      const ok = await rest(`g_worker_tokens?select=token&scope=eq.subs&token=eq.${encodeURIComponent(body.token)}&expires_at=gt.${new Date().toISOString()}`);
      if (!ok?.length) return out({ error: "forbidden" }, 403);
      // проверка доставки: пуш без текста (без шифрования) и обычный — на все устройства пользователя
      if (body.ping_user) {
        await loadVapid();
        const subs = await rest(`push_subs?select=endpoint,p256dh,auth,ua&user_id=eq.${body.ping_user}`);
        const res: unknown[] = [];
        for (const p of subs) {
          const payload = JSON.stringify({ title: "Sali: проверка пуша", body: "Если видите это — пуши работают", url: `${APP}#/subs` });
          try { const r = await sendPush(p, payload, { ...vapid!, subject: APP }, { ttl: 600 }); res.push({ ua: p.ua?.slice(0, 40), ...r }); }
          catch (e) { res.push({ ua: p.ua?.slice(0, 40), error: (e as Error).message }); }
        }
        return out({ res });
      }
      const subs: Sub[] = await rest("user_subs?select=*&active=eq.true&order=checked_at.asc.nullsfirst&limit=500");
      const res: unknown[] = [];
      for (const s of subs) { try { res.push({ id: s.id, ...(await checkSub(s, s.base ? "cron" : "init")) }); } catch (e) { res.push({ id: s.id, error: (e as Error).message }); } }
      return out({ checked: subs.length, res });
    }
    const uid = await userId(req);
    if (!uid) return out({ error: "Войдите в аккаунт" }, 401);
    if (body.action === "init") {
      const subs: Sub[] = await rest(`user_subs?select=*&user_id=eq.${uid}&active=eq.true&base=is.null`);
      const res = []; for (const s of subs) { try { res.push(await checkSub(s, "init")); } catch (e) { res.push({ error: (e as Error).message }); } }
      return out({ ok: true, res });
    }
    if (body.action === "test") {
      // пример с настоящими акциями дня
      const top = await rest("g_deal_list_mv?select=chain,barcode,name:ru,he:name,pct,deal,old,qty,total,ends,ingredient&pct=gte.20&ru=not.is.null&order=save.desc&limit=40");
      const keys = [...new Set(top.map((d: { ingredient: string }) => d.ingredient).filter(Boolean))];
      const imgs = keys.length ? await rest(`g_ingredients?select=key,img&key=in.(${keys.map((k) => `"${k}"`).join(",")})`) : [];
      const im = Object.fromEntries(imgs.map((x: { key: string; img: string }) => [x.key, x.img]));
      const seen = new Set<string>(), sample: Deal[] = [];
      for (const d of top) { if (!im[d.ingredient] || seen.has(d.ingredient)) continue; seen.add(d.ingredient); sample.push({ ...d, img: im[d.ingredient] }); if (sample.length >= 3) break; }
      const sent = await notify(uid, { id: null, email: !!body.email, push: !!body.push }, tplTest(sample));
      return out({ sent });
    }
    return out({ error: "bad request" }, 400);
  } catch (e) {
    return out({ error: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
