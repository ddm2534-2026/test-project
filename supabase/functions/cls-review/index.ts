// Проверка категорий: товары, у которых цена за кг/л сильно выбивается из своего вида (очередь g_cls_review),
// Haiku сверяет название со справочником и перекладывает, если вид неверный.
//   POST {token, part?, parts?, budget_ms?, batch?} → {done, ok, moved, none, skip, left, err}
// Доступ — по временному пропуску из g_worker_tokens (scope 'cls'). Ручные правки (ingredient_src = 'manual') в очередь не попадают.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";
const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const apiKey = () => (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "").trim();
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

type Node = { key: string; name_ru: string; name_he: string | null; parent: string | null; is_group: boolean | null };
type Item = { barcode: string; name: string; maker: string | null; old_key: string; old_name: string | null; reason: string; ratio: number | null };

function treeText(all: Node[]) {
  const kids = new Map<string, Node[]>();
  for (const g of all) { const k = g.parent ?? ""; if (!kids.has(k)) kids.set(k, []); kids.get(k)!.push(g); }
  const out: string[] = [];
  const walk = (k: string, d: number) => {
    for (const g of kids.get(k) ?? []) {
      out.push(" ".repeat(d) + (g.is_group ? `[${g.name_ru}] ${g.key}` : `${g.key} | ${g.name_ru} | ${g.name_he ?? ""}`));
      walk(g.key, d + 1);
    }
  };
  walk("", 0);
  return out.join("\n");
}

const SYSTEM = `Ты проверяешь, правильно ли товары израильских супермаркетов разложены по справочнику видов товаров.
У каждого товара указан текущий ключ. Цена за килограмм или литр у этих товаров сильно отличается от обычной для их вида — часто это значит, что товар другого вида: косметика или духи вместо еды, БАД или сироп-лекарство, приправа вместо овоща, семечки вместо самого овоща, готовое блюдо или салат вместо сырого продукта, набор, подарок, посуда или аксессуар. Но часто это просто ошибка в весе упаковки — тогда вид верный.
Для каждого товара верни:
- ok=true и key=текущий ключ, если вид верный (дорогой или дешёвый вариант того же вида — тоже верно: икра, трюфельное масло, элитный чай, большая семейная упаковка);
- ok=false и key=самый точный ключ справочника, если вид неверный. Ключ копируй из справочника точно, символ в символ. Нельзя выбирать группы (строки в квадратных скобках);
- ok=false и key=null, если вид неверный, а подходящего вида в справочнике нет.
Смотри на название на иврите целиком; марка и фасовка не важны. Если не уверен, что вид неверный, — оставляй текущий (ok=true).
Готовое блюдо — не ингредиент; «со вкусом X» ≠ X; заменитель ≠ оригинал.`;
const TOOL = {
  name: "review",
  description: "Проверка вида для каждого товара",
  input_schema: {
    type: "object", required: ["items"],
    properties: { items: { type: "array", items: { type: "object", required: ["n", "ok", "key"],
      properties: { n: { type: "integer" }, ok: { type: "boolean" }, key: { type: ["string", "null"] } } } } },
  },
};

async function callModel(list: Item[], tree: string) {
  const user = `Товары (номер | название | производитель | текущий ключ | цена):\n` + list.map((x, i) =>
    `${i + 1} | ${x.name} | ${x.maker ?? ""} | ${x.old_key} (${x.old_name ?? ""}) | ${x.reason === "price_hi" ? "дороже" : "дешевле"} обычного в ${x.ratio ?? "?"} раз`).join("\n");
  let data: any = null;
  for (let a = 0; a < 3; a++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000,
        system: [{ type: "text", text: SYSTEM }, { type: "text", text: `Справочник (отступ — вложенность):\n${tree}`, cache_control: { type: "ephemeral" } }],
        tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name }, messages: [{ role: "user", content: user }] }),
    });
    data = await r.json();
    if (r.ok) break;
    if (![429, 500, 502, 503, 529].includes(r.status) || a === 2) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 6000 * (a + 1)));
  }
  if (data?.stop_reason === "max_tokens") throw new Error("ответ обрезан");
  const block = (data?.content || []).find((b: { type: string }) => b.type === "tool_use");
  let items = block?.input?.items;
  if (typeof items === "string") { try { items = JSON.parse(items); } catch { items = []; } }
  return (Array.isArray(items) ? items : []) as { n: number; ok: boolean; key: string | null }[];
}

Deno.serve(async (req) => {
  try {
    const { token, part = 0, parts = 1, budget_ms = 90000, batch = 80 } = await req.json();
    const db = createClient(SB, SR);
    const { data: tk } = await db.from("g_worker_tokens").select("token").eq("scope", "cls").eq("token", String(token || ""))
      .gt("expires_at", new Date().toISOString()).limit(1);
    if (!tk?.length) return json({ error: "forbidden" }, 403);
    const { data: ing, error: ie } = await db.from("g_ingredients").select("key,name_ru,name_he,parent,is_group").order("key").range(0, 4999);
    if (ie) return json({ error: ie.message }, 500);
    const all = (ing ?? []) as Node[];
    const tree = treeText(all);
    const leaf = new Set(all.filter((g) => !g.is_group).map((g) => g.key));
    const t0 = Date.now(), size = Math.max(10, Math.min(Number(batch) || 80, 120));
    const st = { done: 0, ok: 0, moved: 0, none: 0, skip: 0 };
    let left = 0, err = "";
    while (Date.now() - t0 < Math.min(Number(budget_ms) || 90000, 110000)) {
      const { data, error } = await db.rpc("g_cls_review_batch", { p_limit: size * 2, p_part: part, p_parts: parts });
      if (error) return json({ error: error.message, ...st }, 500);
      const list = (data ?? []) as Item[];
      left = list.length;
      if (!list.length) break;
      const batches: Item[][] = [];
      for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
      const res = await Promise.allSettled(batches.map(async (b) => ({ b, picks: await callModel(b, tree) })));
      let progressed = 0;
      for (const x of res) {
        if (x.status === "rejected") { err = String(x.reason).slice(0, 300); continue; }
        const { b, picks } = x.value;
        const seen = new Set<number>();
        for (const p of picks) {
          const it = b[Number(p.n) - 1];
          if (!it || seen.has(Number(p.n))) continue;
          seen.add(Number(p.n));
          const now = new Date().toISOString();
          // skip: модель предложила ключ, которого нет среди видов (группа или опечатка) — оставляем как есть, ключ запоминаем
          let verdict = "skip", newKey: string | null = p.key ?? null;
          if (p.ok || p.key === it.old_key) { verdict = "ok"; newKey = null; }
          else if (p.key && leaf.has(p.key)) {
            const { error: e } = await db.from("g_items").update({ ingredient: p.key, ingredient_src: "review", ingredient_checked_at: now })
              .eq("barcode", it.barcode).eq("ingredient", it.old_key);
            if (!e) verdict = "moved"; else err = e.message;
          } else if (p.key === null) {
            const { error: e } = await db.from("g_items").update({ ingredient: null, ingredient_src: "review", ingredient_checked_at: now })
              .eq("barcode", it.barcode).eq("ingredient", it.old_key);
            if (!e) verdict = "none"; else err = e.message;
          }
          await db.from("g_cls_review").update({ verdict, new_key: newKey, checked_at: now }).eq("barcode", it.barcode);
          (st as Record<string, number>)[verdict]++;
          st.done++; progressed++;
        }
      }
      if (!progressed) break; // модель ничего не вернула — не крутимся впустую
    }
    return json({ ...st, left, err });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
