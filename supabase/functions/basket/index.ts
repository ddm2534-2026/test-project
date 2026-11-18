// Корзина по сетям для приложения Sali: POST {need:[{key,qty}], chains:[...]} → результат g_recipe_basket.
// Считает в базе от имени сервиса (без 3-секундного лимита анонимных запросов) и кэширует результат на день
// (g_recipe_basket_cached): повторное открытие корзины и переключение «с доставкой / в магазине» — мгновенно.
const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CHAINS = new Set(["shufersal", "ramilevy", "victory", "tivtaam", "keshet", "yochananof", "osherad",
  "shufersal_deal", "shufersal_sheli", "shufersal_express", "ramilevy_store", "victory_store", "tivtaam_store", "keshet_store"]);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => null);
  const need = (Array.isArray(body?.need) ? body.need : [])
    .filter((x: any) => /^[a-z0-9_]{1,60}$/.test(x?.key ?? "") && Number(x?.qty) > 0 && Number(x.qty) < 1e6)
    .map((x: any) => ({ key: x.key, qty: Number(x.qty) }));
  const chains = (Array.isArray(body?.chains) ? body.chains : []).filter((c: unknown) => typeof c === "string" && CHAINS.has(c));
  if (!need.length || need.length > 200 || !chains.length) return json({ error: "bad request" }, 400);
  const r = await fetch(`${SB}/rest/v1/rpc/g_recipe_basket_cached`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_need: need, p_chains: chains }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: "Цены не посчитались: " + String(d?.message ?? r.status).slice(0, 200) }, 502);
  return json(d);
});
