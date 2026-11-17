// Составление плана меню на неделю для приложения Sali (/app).
// Код сгенерирован из supabase/functions/menu/index.ts (action "plan"): те же SYSTEM, PLAN_TOOL, BOX_RULES, describe, library, claude.
// Отличия: модель отвечает без долгих размышлений (на 5 приёмов пищи в день они съедали весь лимит) и план проверяется на полноту.
//   POST {params} → {result: {summary, days, dishes, notes}}
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5-5";
const PER_CLIENT = 40;
const TOTAL = 400;

const MEALS = ["завтрак", "обед", "ужин", "перекус", "в школу"];
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
                  meal: { type: "string", enum: MEALS },
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
          required: ["id", "name", "meals", "description", "cook_minutes", "portions", "kcal", "protein", "fat", "carbs"],
          properties: {
            id: { type: "string", description: "короткий латинский id, например d1" },
            recipe: { type: "string", description: "id рецепта из библиотеки (r12), если блюдо взято оттуда; иначе не указывай" },
            name: { type: "string" },
            meals: { type: "array", items: { type: "string", enum: MEALS },
              description: "к каким приёмам пищи вообще подходит блюдо (одна или несколько категорий), не только где оно стоит в этом меню" },
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


// правила для коробочки (ארוחת עשר): по чек-листам садов и школ и рекомендациям минздрава/минпроса Израиля
const BOX_RULES =
  `Правила израильских садов и школ для еды с собой (ארוחת עשר):\n` +
  `САД (тег «для сада»): только несладкий бутерброд (хлеб, лаваш/ваффл-пита, питы, тортилья, булочка — лучше цельнозерновые) ` +
  `с несладкой начинкой (белый/жёлтый сыр, лабане, хумус, авокадо, яйцо, тунец, овощные пасты) плюс сырые овощи (целиком или нарезанные) и, если хочется, фрукт. ` +
  `Без мяса и колбас (многие сады молочные), без орехов и арахисовой пасты, без кунжута/тхины (частая аллергия в группах), без сладкого.\n` +
  `ШКОЛА: то же плюс мясная начинка (индейка, курица), несладкая домашняя выпечка (сырные булочки, овощные маффины, бурекасы не жареные), ` +
  `холодные оладьи/котлеты в пите, фрукты. Нельзя ни там, ни там: сладости, торты, печенье, вафли, шоколадные пасты, сладкие йогурты и напитки, ` +
  `жареное (шницель, чипсы, жареные бурекасы), солёные снеки, орехи. Ребёнок ест сам, холодным, без разогрева; не течёт, не крошится сильно, ` +
  `выдерживает 3–4 часа без холодильника.`;


// ключ из секретов: убираем случайные пробелы, переносы строк и кавычки при вставке
function apiKey() {
  return (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}



// deno-lint-ignore no-explicit-any
async function claude(user: string, tool: any, maxTokens: number, model = MODEL,
  opt: { cached?: string; think?: boolean; system?: string } = {}) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      // справочник — отдельным кэшируемым блоком: повторные вызовы читают его со скидкой
      system: opt.cached ? [{ type: "text", text: opt.system ?? SYSTEM }, { type: "text", text: opt.cached, cache_control: { type: "ephemeral" } }] : (opt.system ?? SYSTEM),
      // у этой модели «без размышлений» — between_tools (disabled отвергается)
      ...(opt.think === false ? { thinking: { type: "between_tools" } } : {}),
      tools: [tool], tool_choice: { type: "auto" },
      messages: [{ role: "user", content: user + `\n\nОтветь только вызовом инструмента ${tool.name}, без текста.` }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  console.log(JSON.stringify({ model, tool: tool.name, stop: data.stop_reason, usage: data.usage,
    blocks: (data.content || []).map((b: { type: string }) => b.type) }));
  const block = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (block) return { result: unwrap(block.input, tool.name), usage: data.usage, stop: data.stop_reason };
  // запасной путь: модель ответила JSON-текстом вместо вызова инструмента
  const text = (data.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return { result: unwrap(JSON.parse(m[0]), tool.name), usage: data.usage, stop: data.stop_reason }; } catch { /* ниже */ } }
  throw new Error(`модель не вернула результат (stop: ${data.stop_reason}, текст: ${text.slice(0, 200)})`);
}

// иногда ответ приходит обёрнутым: {weekly_menu: {...}} или {input: {...}}
function unwrap(x: Record<string, unknown>, name: string): Record<string, unknown> {
  for (const k of [name, "input", "parameters", "arguments"]) {
    const v = x?.[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    if (typeof v === "string") { try { return fixStrings(JSON.parse(v)); } catch { /* дальше */ } }
  }
  return fixStrings(x);
}

// вложенные массивы иногда приходят строкой JSON — разворачиваем
function fixStrings(x: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(x ?? {})) {
    if (typeof v === "string" && /^\s*[\[{]/.test(v)) { try { x[k] = JSON.parse(v); } catch { /* оставляем как есть */ } }
  }
  return x;
}

function describe(p: Record<string, unknown>) {
  // параметры формы → понятный текст для модели (только известные поля, с ограничением длины)
  const s = (v: unknown, n = 600) => String(v ?? "").slice(0, n);
  const lines = [
    `Едоки: ${s(p.people, 300)}`,
    `Приёмы пищи: ${s(p.meals, 400)}`,
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

class LimitError extends Error {}

// библиотека рецептов: компактный каталог для модели (короткие id вместо uuid)
type Lib = { id: string; name: string; meals: string[]; tags: string[]; portions: number; ingredients: { name: string }[] };
async function library(db: ReturnType<typeof createClient>) {
  const { data } = await db.from("menu_recipes").select("id,name,meals,tags,portions,ingredients")
    .order("uses", { ascending: false }).order("created_at", { ascending: false }).limit(150);
  const list = (data ?? []) as Lib[];
  const short: Record<string, string> = {};
  const text = list.map((r, i) => {
    short["r" + (i + 1)] = r.id;
    const ing = (r.ingredients || []).map((x) => x.name).join(", ").slice(0, 260);
    return `r${i + 1} | ${r.name} | ${(r.meals || []).join(", ") || "—"} | ${(r.tags || []).join(", ")} | ${ing}`;
  }).join("\n");
  return { text, short };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!apiKey()) return json({ error: "Не задан ключ ANTHROPIC_API_KEY в секретах Supabase" }, 500);
  let body: { params?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (JSON.stringify(body).length > 40000) return json({ error: "слишком большой запрос" }, 413);
  const params = body.params ?? {};
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const client = await sha(ip + "menu-salt-1");
  try {
    const { data: allowed, error } = await db.rpc("menu_take", { p_client: client, p_per_client: PER_CLIENT, p_total: TOTAL });
    if (error) throw new Error("limit check: " + error.message);
    if (!allowed) throw new LimitError("Лимит генераций на сегодня исчерпан, попробуйте завтра");
    const lib = await library(db);
    const out = await claude(
      `Составь меню на неделю (7 дней, с воскресенья) по этим параметрам:\n${describe(params)}\n` +
      `Повторно используй блюда (готовим на 2 дня), чтобы разных блюд было не больше 12.\n` +
      `Каждый dish_id в days обязан быть в списке dishes.\n` +
      (String(params.meals ?? "").includes("в школу")
        ? `Приём «в школу» — коробочка, которую ребёнок берёт с собой в сад или школу: ставь его в учебные дни ` +
          `(воскресенье–пятница, если семья не написала иначе).\n${BOX_RULES}\n` +
          `Если среди детей есть дошкольник (до 6 лет), бери для этого приёма только блюда с тегом «для сада» или придумывай по правилам сада. ` +
          `Можно готовить вечером накануне. Для таких блюд укажи категорию «в школу».\n` : "") +
      (lib.text ? `\nБиблиотека готовых рецептов (id | название | категории | теги | ингредиенты):\n${lib.text}\n\n` +
        `Где блюдо из библиотеки подходит семье, бери его и укажи recipe (например r3) — так дешевле. ` +
        `Перед этим проверь его ингредиенты на аллергии, «не любят» и кашрут; если что-то не подходит — не бери. ` +
        `Название такого блюда оставь как в библиотеке. Новые блюда придумывай, только чтобы меню было разнообразным и учитывало пожелания.` : ""),
      PLAN_TOOL, 16000, MODEL, { think: false });
    const r = out.result as { days?: { meals?: { dish_id?: string }[] }[]; dishes?: { id?: string; recipe?: string; recipe_id?: string }[] };
    if (!Array.isArray(r.days) || !Array.isArray(r.dishes))
      throw new Error(`неполное меню (stop: ${out.stop}, поля: ${Object.keys(r).join(", ")})`);
    const ids = new Set(r.dishes.map((d) => d.id));
    const lost = r.days.flatMap((d) => d.meals ?? []).filter((m) => !ids.has(m.dish_id)).length;
    if (!r.dishes.length || lost) throw new Error(`неполное меню: блюд ${r.dishes.length}, без блюда ${lost} (stop: ${out.stop})`);
    for (const d of r.dishes) { const id = d.recipe && lib.short[d.recipe]; delete d.recipe; if (id) d.recipe_id = id; }
    return json(out);
  } catch (e) {
    if (e instanceof LimitError) return json({ error: e.message }, 429);
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
