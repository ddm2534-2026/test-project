// Меню на неделю: серверная функция, которая вызывает Claude.
// Ключ Anthropic берётся из секретов Supabase (ANTHROPIC_API_KEY) и в браузер не попадает.
//
//   POST {action: "plan", params}                — меню на 7 дней: блюда, порции, КБЖУ
//   POST {action: "recipes", params, dishes: []} — рецепты для части блюд (вызывается пачками)
//
// Защита баланса: не больше PER_CLIENT вызовов в день с одного адреса и TOTAL в день всего.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5-5";
const PER_CLIENT = 40;
const TOTAL = 400;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `Ты — опытный нутрициолог и домашний повар, составляешь меню для семей в Израиле.
Пиши по-русски. Названия ингредиентов дополнительно давай на иврите так, как товар называют в израильских супермаркетах
(например «творог 5%» → «גבינה לבנה 5%», «сметана 15%» → «שמנת חמוצה 15%», «куриное филе» → «חזה עוף»).
Правила:
- Строго исключай продукты, на которые указана аллергия или которые человек не ест. Если не уверен — не используй.
- Учитывай кашрут, если он указан (не смешивать мясное и молочное в одном блюде и приёме пищи).
- Используй продукты, которые легко купить в израильских сетях (Shufersal, Rami Levy и т.п.).
- Разумно: блюдо можно готовить на 2 дня; не больше 10–12 разных блюд в неделю; учитывай время на готовку.
- КБЖУ — честная оценка на порцию; не предлагай экстремально низкую калорийность и не давай медицинских советов.
- Рецепты — свои, простые, понятные, без ссылок на чужие сайты.`;

const PLAN_TOOL = {
  name: "weekly_menu",
  description: "Меню на 7 дней",
  input_schema: {
    type: "object",
    required: ["summary", "days", "dishes"],
    properties: {
      summary: { type: "string", description: "1–2 предложения: идея меню и как учтены пожелания" },
      days: {
        type: "array", minItems: 7, maxItems: 7,
        items: {
          type: "object", required: ["day", "meals"],
          properties: {
            day: { type: "string", description: "День недели, неделя начинается с воскресенья" },
            meals: {
              type: "array",
              items: {
                type: "object", required: ["meal", "dish_id"],
                properties: {
                  meal: { type: "string", enum: ["завтрак", "обед", "ужин", "перекус"] },
                  dish_id: { type: "string" },
                  leftovers: { type: "boolean", description: "true, если едим приготовленное раньше" },
                },
              },
            },
          },
        },
      },
      dishes: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "name", "description", "cook_minutes", "portions", "kcal", "protein", "fat", "carbs"],
          properties: {
            id: { type: "string", description: "короткий латинский id, например d1" },
            name: { type: "string" },
            description: { type: "string", description: "одна строка" },
            cook_minutes: { type: "integer" },
            portions: { type: "integer", description: "сколько порций готовим за раз" },
            kcal: { type: "integer", description: "ккал на взрослую порцию" },
            protein: { type: "integer" }, fat: { type: "integer" }, carbs: { type: "integer" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
      notes: { type: "array", items: { type: "string" }, description: "важные оговорки (аллергии, замены)" },
    },
  },
};

const RECIPES_TOOL = {
  name: "recipes",
  description: "Рецепты для блюд",
  input_schema: {
    type: "object", required: ["recipes"],
    properties: {
      recipes: {
        type: "array",
        items: {
          type: "object", required: ["dish_id", "ingredients", "steps"],
          properties: {
            dish_id: { type: "string" },
            ingredients: {
              type: "array",
              items: {
                type: "object", required: ["name", "name_he", "amount", "unit"],
                properties: {
                  name: { type: "string" }, name_he: { type: "string" },
                  amount: { type: "number", description: "на все порции блюда" },
                  unit: { type: "string", enum: ["г", "кг", "мл", "л", "шт", "ч.л.", "ст.л.", "по вкусу"] },
                  pantry: { type: "boolean", description: "true для соли, специй, масла и т.п., что обычно есть дома" },
                },
              },
            },
            steps: { type: "array", items: { type: "string" }, maxItems: 8 },
            tip: { type: "string" },
          },
        },
      },
    },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function claude(user: string, tool: typeof PLAN_TOOL | typeof RECIPES_TOOL, maxTokens: number) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens, system: SYSTEM,
      tools: [tool], tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const block = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (!block) throw new Error("модель не вернула результат");
  return { result: block.input, usage: data.usage };
}

function describe(p: Record<string, unknown>) {
  // параметры формы → понятный текст для модели (только известные поля, с ограничением длины)
  const s = (v: unknown, n = 600) => String(v ?? "").slice(0, n);
  const lines = [
    `Едоки: ${s(p.people, 300)}`,
    `Приёмы пищи: ${s(p.meals, 200)}`,
    p.allergies ? `АЛЛЕРГИИ / НЕЛЬЗЯ: ${s(p.allergies)}` : "",
    p.diet ? `Ограничения питания: ${s(p.diet, 300)}` : "",
    p.likes ? `Любимые блюда и продукты: ${s(p.likes)}` : "",
    p.dislikes ? `Не любят: ${s(p.dislikes)}` : "",
    p.goal ? `Цель по питанию: ${s(p.goal, 300)}` : "",
    p.time ? `Время на готовку: ${s(p.time, 300)}` : "",
    p.budget ? `Бюджет на неделю: ${s(p.budget, 100)}` : "",
    p.cuisine ? `Кухня: ${s(p.cuisine, 300)}` : "",
    p.extra ? `Дополнительно: ${s(p.extra, 1500)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "Не задан ключ ANTHROPIC_API_KEY в секретах Supabase" }, 500);

  let body: { action?: string; params?: Record<string, unknown>; dishes?: unknown[] };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (JSON.stringify(body).length > 20000) return json({ error: "слишком большой запрос" }, 413);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: allowed, error } = await db.rpc("menu_take", {
    p_client: await sha(ip + "menu-salt-1"), p_per_client: PER_CLIENT, p_total: TOTAL });
  if (error) return json({ error: "limit check: " + error.message }, 500);
  if (!allowed) return json({ error: "Лимит генераций на сегодня исчерпан, попробуйте завтра" }, 429);

  const params = body.params ?? {};
  try {
    if (body.action === "plan") {
      const out = await claude(
        `Составь меню на неделю (7 дней, с воскресенья) по этим параметрам:\n${describe(params)}\n` +
        `Повторно используй блюда (готовим на 2 дня), чтобы разных блюд было не больше 12.`,
        PLAN_TOOL, 6000);
      return json(out);
    }
    if (body.action === "recipes") {
      const dishes = (body.dishes ?? []).slice(0, 5);
      const out = await claude(
        `Параметры семьи:\n${describe(params)}\n\nНапиши рецепты для этих блюд (количество ингредиентов — на указанное число порций):\n` +
        JSON.stringify(dishes), RECIPES_TOOL, 6000);
      return json(out);
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
