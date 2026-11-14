// Меню на неделю: серверная функция, которая вызывает Claude.
// Ключ Anthropic берётся из секретов Supabase (ANTHROPIC_API_KEY) и в браузер не попадает.
//
//   POST {action: "plan", params}                — меню на 7 дней: блюда, порции, КБЖУ
//   POST {action: "recipes", params, dishes: []} — рецепты для части блюд (вызывается пачками)
//   POST {action: "shop", params, ingredients}   — сведённый список покупок
//   POST {action: "match", params, items}        — подбор товаров из базы цен
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


const CATS = ["dairy", "bakery", "produce", "meat", "drinks", "coffee", "sweets", "frozen", "pantry", "cleaning", "care", "baby", "pets", "other"];

const SHOP_TOOL = {
  name: "shopping_list",
  description: "Сведённый список покупок на неделю",
  input_schema: {
    type: "object", required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object", required: ["key", "name", "name_he", "search", "category", "fresh", "qty", "unit", "pantry"],
          properties: {
            key: { type: "string", description: "короткий латинский id, например milk3" },
            name: { type: "string", description: "по-русски, как в магазине: «молоко 3%»" },
            name_he: { type: "string", description: "как товар называется в израильском супермаркете" },
            search: { type: "string", description: "1–2 слова на иврите для поиска в названиях товаров, основа слова без окончаний (עגבני, מלפפון, גבינה לבנה 5%, חזה עוף)" },
            category: { type: "string", enum: CATS },
            fresh: { type: "boolean", description: "true для свежих овощей, фруктов, зелени, свежего мяса/курицы на развес" },
            qty: { type: "number", description: "сколько нужно на неделю в единицах unit" },
            unit: { type: "string", enum: ["г", "мл", "шт"] },
            pantry: { type: "boolean", description: "соль, специи, масло, сахар, мука в малых количествах — обычно есть дома" },
          },
        },
      },
    },
  },
};

const MATCH_TOOL = {
  name: "product_picks",
  description: "Выбор товаров для списка покупок",
  input_schema: {
    type: "object", required: ["picks"],
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object", required: ["key", "options"],
          properties: {
            key: { type: "string" },
            options: {
              type: "array",
              description: "Фасованный товар — один вариант. Свежие овощи/мясо на развес — по одному подходящему варианту в каждой сети.",
              items: {
                type: "object", required: ["barcode", "count"],
                properties: {
                  barcode: { type: "string" },
                  count: { type: "number", description: "сколько упаковок (целое) или килограммов для весового товара (можно дробное, шаг 0.1)" },
                },
              },
            },
            comment: { type: "string", description: "коротко по-русски, если пришлось заменить или не нашлось" },
          },
        },
      },
    },
  },
};

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
async function claude(user: string, tool: any, maxTokens: number) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens, system: SYSTEM,
      tools: [tool], tool_choice: { type: "auto" },
      messages: [{ role: "user", content: user + `\n\nОтветь только вызовом инструмента ${tool.name}, без текста.` }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  console.log(JSON.stringify({ stop: data.stop_reason, usage: data.usage,
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
  const k = apiKey();
  if (!k) return json({ error: "Не задан ключ ANTHROPIC_API_KEY в секретах Supabase" }, 500);

  let body: { action?: string; params?: Record<string, unknown>; dishes?: unknown[]; ingredients?: unknown[]; items?: unknown[] };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (JSON.stringify(body).length > 40000) return json({ error: "слишком большой запрос" }, 413);

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
        PLAN_TOOL, 12000);
      const r = out.result as { days?: unknown; dishes?: unknown };
      if (!Array.isArray(r.days) || !Array.isArray(r.dishes))
        throw new Error(`неполное меню (stop: ${out.stop}, поля: ${Object.keys(r).join(", ")})`);
      return json(out);
    }
    if (body.action === "recipes") {
      const dishes = (body.dishes ?? []).slice(0, 5);
      const out = await claude(
        `Параметры семьи:\n${describe(params)}\n\nНапиши рецепты для этих блюд (количество ингредиентов — на указанное число порций):\n` +
        JSON.stringify(dishes), RECIPES_TOOL, 10000);
      if (!Array.isArray((out.result as { recipes?: unknown }).recipes))
        throw new Error(`неполные рецепты (stop: ${out.stop}, поля: ${Object.keys(out.result).join(", ")})`);
      return json(out);
    }
    if (body.action === "shop") {
      const ingredients = (body as { ingredients?: unknown[] }).ingredients ?? [];
      const out = await claude(
        `Параметры семьи:\n${describe(params)}\n\nВот все ингредиенты из рецептов недели (могут повторяться в разных единицах и под разными названиями):\n` +
        JSON.stringify(ingredients).slice(0, 15000) +
        `\n\nСведи их в один список покупок: объедини одинаковые продукты, переведи в граммы/миллилитры/штуки ` +
        `(штуки — только для яиц, хлеба, питы, халы и т.п.; овощи и мясо — в граммах, например 1 морковь ≈ 120 г, 1 луковица ≈ 120 г, 1 зубчик чеснока ≈ 5 г), ` +
        `округли в разумную сторону, НЕ включай воду. Отметь pantry для того, что обычно уже есть дома.`,
        SHOP_TOOL, 8000);
      if (!Array.isArray((out.result as { items?: unknown }).items)) throw new Error(`неполный список (stop: ${out.stop})`);
      return json(out);
    }
    if (body.action === "match") {
      type Item = { key: string; name: string; name_he: string; search: string; category: string; fresh: boolean; qty: number; unit: string };
      const items = ((body as { items?: Item[] }).items ?? []).slice(0, 60);
      // кандидаты из базы: сначала точный поиск с категорией, потом мягче
      const cands = await Promise.all(items.map(async (it) => {
        const tries: [string, string | null, boolean | null][] = [
          [it.search, it.category, it.fresh ? true : null],
          [it.search, null, it.fresh ? true : null],
          [String(it.search || "").split(/\s+/)[0], it.category, it.fresh ? true : null],
          [it.name_he, null, null],
        ];
        for (const [q, cat, w] of tries) {
          if (!q) continue;
          const { data } = await db.rpc("g_match_candidates", { p_q: q, p_limit: it.fresh ? 16 : 10, p_category: cat, p_weighted: w });
          if (data && data.length) return data;
        }
        return [];
      }));
      const brief = items.map((it, i) => ({
        key: it.key, need: `${it.name} (${it.name_he}) — ${it.qty} ${it.unit}`, fresh: it.fresh,
        candidates: cands[i].map((c: { barcode: string; name: string; quantity: number; unit: string; is_weighted: boolean; prices: Record<string, number> }) =>
          ({ barcode: c.barcode, name: c.name, size: `${c.quantity ?? ""} ${c.unit ?? ""}`.trim(), weighted: c.is_weighted, prices: c.prices })),
      }));
      const out = await claude(
        `Параметры семьи:\n${describe(params)}\n\nДля каждого продукта из списка покупок выбери товары из кандидатов (цены — по сетям, ₪).\n` +
        `Правила: выбирай только из кандидатов; товар должен соответствовать продукту (свежие помидоры — не консервы и не соус); ` +
        `учитывай кашрут и аллергии семьи; для фасованных бери один товар, который есть в большинстве сетей, и посчитай число упаковок, ` +
        `чтобы покрыть нужное количество без большого перебора; для свежих овощей/мяса на развес дай по одному варианту в каждой сети, ` +
        `где он есть, count — в килограммах (если цена указана за штуку/יחידה — в штуках). Если подходящего нет — options пустой и comment.\n\n` +
        JSON.stringify(brief),
        MATCH_TOOL, 8000);
      const picks = (out.result as { picks?: unknown }).picks;
      if (!Array.isArray(picks)) throw new Error(`неполный подбор (stop: ${out.stop})`);
      // приложим названия и цены выбранных товаров, чтобы страница могла их показать
      const info: Record<string, unknown> = {};
      cands.flat().forEach((c: { barcode: string }) => { info[c.barcode] = c; });
      return json({ result: { picks, products: info }, usage: out.usage });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    // подсказка без раскрытия ключа: формат и длина
    const hint = msg.includes("401") ? ` (ключ: начинается с ${k.slice(0, 7)}…, длина ${k.length})` : "";
    return json({ error: msg + hint }, 502);
  }
});
