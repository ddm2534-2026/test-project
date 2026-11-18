// Корзины Sali (вход «от корзины»): сравнение по сетям и чтение чеков.
//   POST {action:"compare", items:[{id, barcode?|key?, qty, kg?}], chains:[...]} → g_cart_compare (кэш на день)
//   POST {action:"receipt", image:"<base64>", mime:"image/jpeg"} → {chain, store, date, total, lines:[{name, qty, kg, price, total, match}]}
// Чтение чека — модель с картинкой; списывается из того же дневного лимита, что и сборка меню (menu_take).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "claude-sonnet-5-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CHAINS = ["shufersal", "ramilevy", "victory", "tivtaam", "keshet", "yochananof", "osherad",
  "shufersal_deal", "shufersal_sheli", "shufersal_express", "ramilevy_store", "victory_store", "tivtaam_store", "keshet_store"];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const apiKey = () => (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "").trim();
async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(d?.message ?? r.status).slice(0, 200));
  return d;
}

const RECEIPT_TOOL = {
  name: "receipt",
  description: "Содержимое кассового чека израильского супермаркета",
  input_schema: {
    type: "object", required: ["chain", "lines"],
    properties: {
      chain: { type: "string", enum: ["shufersal", "ramilevy", "victory", "tivtaam", "keshet", "yochananof", "osherad", "other"],
        description: "сеть по шапке чека (שופרסל, רמי לוי, ויקטורי, טיב טעם, קשת טעמים, יוחננוף, אושר עד)" },
      store: { type: "string", description: "название/адрес магазина из шапки, если есть" },
      date: { type: "string", description: "дата покупки YYYY-MM-DD, если видна" },
      total: { type: "number", description: "итог к оплате" },
      lines: {
        type: "array",
        items: {
          type: "object", required: ["name"],
          properties: {
            name: { type: "string", description: "название товара как в чеке, на иврите, без изменений" },
            barcode: { type: "string", description: "штрихкод/код товара, если напечатан" },
            qty: { type: "number", description: "количество штук/упаковок" },
            kg: { type: "number", description: "вес в кг для развесного товара" },
            unit_price: { type: "number", description: "цена за штуку или за кг" },
            line_total: { type: "number", description: "сумма строки" },
          },
        },
      },
    },
  },
};

async function readReceipt(image: string, mime: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 8000,
      thinking: { type: "between_tools" },
      tools: [RECEIPT_TOOL], tool_choice: { type: "auto" },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime, data: image } },
        { type: "text", text: "Это фото кассового чека из израильского супермаркета. Перепиши все товарные строки: название как напечатано, " +
          "количество или вес, цену. Скидки (הנחה/מבצע) отдельной строкой не пиши — учти их в сумме строки, если понятно к какому товару. " +
          "Пакеты, депозит за бутылки (פיקדון) и служебные строки пропускай. Если чек не читается — верни пустой список. " +
          "Ответь только вызовом инструмента receipt." },
      ] }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  console.log(JSON.stringify({ model: MODEL, tool: "receipt", usage: data.usage }));
  const block = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (!block) throw new Error("не удалось прочитать чек");
  return block.input as { chain: string; store?: string; date?: string; total?: number; lines: Record<string, unknown>[] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => null);
  try {
    if (body?.action === "compare") {
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 300).map((x: any) => ({
        id: String(x?.id ?? "").slice(0, 40),
        barcode: /^[a-z0-9:]{3,30}$/.test(x?.barcode ?? "") ? x.barcode : undefined,
        key: /^[a-z0-9_]{1,60}$/.test(x?.key ?? "") ? x.key : undefined,
        qty: Number(x?.qty) > 0 ? Math.min(Number(x.qty), 1e6) : 1,
        kg: Number(x?.kg) > 0 ? Math.min(Number(x.kg), 1000) : undefined,
      })).filter((x: any) => x.id && (x.barcode || x.key));
      const chains = (Array.isArray(body.chains) ? body.chains : []).filter((c: string) => CHAINS.includes(c));
      if (!items.length || !chains.length) return json({ error: "bad request" }, 400);
      return json(await rpc("g_cart_compare", { p_items: items, p_chains: chains }));
    }
    if (body?.action === "receipt") {
      const image = String(body.image ?? ""), mime = ["image/jpeg", "image/png", "image/webp"].includes(body.mime) ? body.mime : "image/jpeg";
      if (image.length < 1000 || image.length > 7_000_000) return json({ error: "фото не подходит" }, 400);
      if (!apiKey()) return json({ error: "Не задан ключ ANTHROPIC_API_KEY" }, 500);
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
      const db = createClient(SB, SR);
      const { data: allowed, error } = await db.rpc("menu_take", { p_client: await sha(ip + "menu-salt-1"), p_per_client: 40, p_total: 400 });
      if (error) throw new Error("limit check: " + error.message);
      if (!allowed) return json({ error: "Лимит на сегодня исчерпан, попробуйте завтра" }, 429);
      const rc = await readReceipt(image, mime);
      const chain = CHAINS.includes(rc.chain) ? rc.chain : null;
      const lines = (rc.lines || []).slice(0, 150).map((l) => ({
        name: String(l.name ?? "").slice(0, 120), barcode: l.barcode ? String(l.barcode).slice(0, 20) : undefined,
        qty: Number(l.qty) || undefined, kg: Number(l.kg) || undefined,
        unit_price: Number(l.unit_price) || undefined, line_total: Number(l.line_total) || undefined,
      })).filter((l) => l.name);
      const match = lines.length ? await rpc("g_receipt_match", { p_chain: chain, p_lines: lines }) : [];
      const byI = new Map((match as any[]).map((m) => [m.i, m]));
      return json({ chain, store: rc.store ?? null, date: rc.date ?? null, total: rc.total ?? null,
        lines: lines.map((l, i) => ({ ...l, match: byI.get(i)?.barcode ? byI.get(i) : null })) });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
