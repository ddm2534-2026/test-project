// Разбор своего рецепта пользователя: текст, ссылка на страницу или фото (страница книги, тетрадь, скриншот).
// Возвращает название, порции, время, шаги по-русски и ингредиенты, привязанные к ключам справочника g_ingredients.
// Правила сопоставления — те же, что у action "parse_recipe" функции menu.
//   POST {text} | {url} | {image: {media_type, data(base64)}, text?}
//   POST {split: {name, ingredients: [строки], steps: [строки]}} — разделить готовый рецепт на основное и гарнир
// Обед/ужин из «основного + отдельно приготовленного гарнира» делится: гарнир — отдельным рецептом,
// с привязкой к базовому гарниру библиотеки (side_match), если такой есть.
// Лимит — общий с функцией menu (menu_take): не больше 40 вызовов модели в день с адреса.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5-5";
const MEALS = ["завтрак", "обед", "ужин", "перекус", "в школу", "десерт"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const apiKey = () => (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "").trim();

const SYSTEM = `Ты — опытный домашний повар в Израиле. Разбираешь рецепты пользователей на продукты из израильских супермаркетов. Пиши по-русски.`;

const TOOL = {
  name: "parsed_recipe",
  description: "Рецепт, разобранный на продукты из справочника",
  input_schema: {
    type: "object", required: ["title", "servings", "items", "steps"],
    properties: {
      title: { type: "string", description: "название блюда по-русски" },
      servings: { type: "number", description: "на сколько порций рассчитан рецепт (если не указано — оцени)" },
      items: { type: "array", items: { type: "object", required: ["line", "key", "qty"], properties: {
        line: { type: "string", description: "строка рецепта кратко, по-русски" },
        part: { type: "string", description: "часть блюда (соус, тесто…), если рецепт из частей" },
        key: { type: ["string", "null"], description: "ключ из справочника; null — если подходящего нет" },
        qty: { type: "number", description: "количество в базовой единице ключа (г, мл или шт)" },
        note: { type: "string", description: "как количество записано в рецепте, если не в базовой единице: кратко по-русски — «4 ст. л.», «1,5 стакана», «щепотка», «2 зубчика»; пусто, если там граммы, мл или те же штуки" },
        guess: { type: "boolean", description: "true, если количество оценено" },
        pantry: { type: "boolean", description: "true для соли, специй, масла — что обычно есть дома" },
        missing: { type: "string", description: "если key=null: что это за продукт, по-русски" },
      } } },
      steps: { type: "array", items: { type: "string" }, maxItems: 12, description: "шаги по-русски, кратко, своими словами" },
      minutes: { type: "integer", description: "всего минут до подачи" },
      work_minutes: { type: "integer", description: "минут активной работы" },
      meals: { type: "array", items: { type: "string", enum: MEALS } },
      kind: { type: "string", enum: ["мясное", "молочное", "парве"] },
      dish_type: { type: "string", enum: ["dish", "main", "side"],
        description: "dish — целое блюдо; main — основное, к которому в рецепте отдельно готовится гарнир; side — рецепт самого гарнира" },
      main_title: { type: "string", description: "если dish_type=main: название основного без гарнира («Тефтели в томатном соусе»)" },
      side_title: { type: "string", description: "если dish_type=main: название гарнира (по возможности одно из базовых)" },
      side_items: { type: "array", items: { type: "integer" }, description: "если dish_type=main: номера строк items (с 0), которые относятся к гарниру" },
      side_steps: { type: "array", items: { type: "string" }, description: "если dish_type=main: шаги приготовления гарнира; тогда steps — только шаги основного" },
      side_minutes: { type: "integer" },
    },
  },
};

// разделение готового рецепта библиотеки: только разметка (номера ингредиентов, шаги), ничего не выдумываем
const SPLIT_TOOL = {
  name: "split_recipe",
  description: "Разделение рецепта на основное блюдо и отдельно приготовленный гарнир",
  input_schema: {
    type: "object", required: ["split"],
    properties: {
      split: { type: "boolean", description: "true, если гарнир готовится отдельно и его можно подать с другим основным" },
      main_title: { type: "string" }, side_title: { type: "string" },
      side_ingredients: { type: "array", items: { type: "integer" }, description: "номера ингредиентов (с 0), которые идут только в гарнир" },
      main_steps: { type: "array", items: { type: "string" }, description: "шаги основного (исходные, без шагов гарнира; фразу подачи «с рисом» убери)" },
      side_steps: { type: "array", items: { type: "string" }, description: "шаги гарнира (исходные формулировки)" },
      side_minutes: { type: "integer" },
    },
  },
};

// базовые гарниры: названия, к которым сводим гарниры рецептов
const BASE_SIDES = ["Белый рис", "Рис с горошком и морковью", "Картофельное пюре", "Запечённый картофель", "Отварной картофель",
  "Птитим", "Булгур", "Кускус", "Гречка", "Макароны", "Стручковая фасоль", "Овощи на пару", "Запечённые овощи", "Израильский салат", "Пюре из зелёного горошка"];
const SPLIT_RULES =
  `Делить на основное и гарнир нужно только обед/ужин, где гарнир готовится ОТДЕЛЬНО и подошёл бы к другому основному: ` +
  `рис, птитим, пюре, картофель, макароны, булгур, кускус, гречка, овощной гарнир, отдельный салат к подаче. ` +
  `НЕ делить: если всё готовится вместе (один противень, одна кастрюля: курица с картошкой в духовке, жаркое, маджадра, плов, ` +
  `фаршированные овощи, суп, лапша с курицей); хлеб, пита, лаваш и свежие овощи нарезкой — это подача, а не гарнир; соус основного — часть основного. ` +
  `Название гарнира по возможности бери из базовых: ${BASE_SIDES.join(", ")}. Если гарнир другой — короткое понятное название.`;
const normName = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// Instagram и Facebook: подпись к публичному посту через посредника (ScrapeCreators, для Instagram запасной — Bright Data);
// сами сети серверу пост не отдают.
// Берём только текст подписи, видео и звук не скачиваем.
function findCaption(x: unknown): string {
  let best = "";
  const walk = (v: unknown, k = "") => {
    if (typeof v === "string") { if (/^(caption|description|text|caption_text|message)$/i.test(k) && v.length > best.length) best = v; return; }
    if (Array.isArray(v)) { v.forEach((y) => walk(y, k)); return; }
    if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(x);
  return best;
}
// автор поста (чтобы среди комментариев найти его собственный — рецепт часто пишут там)
function findOwner(x: unknown): string {
  let got = "";
  const walk = (v: unknown, k = "") => {
    if (got || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { if (k !== "comments") v.forEach((y) => walk(y, k)); return; }
    const o = v as Record<string, unknown>;
    if (/^(owner|user|author)$/i.test(k) && typeof o.username === "string") { got = o.username; return; }
    for (const [kk, vv] of Object.entries(o)) if (!/comment/i.test(kk)) walk(vv, kk);
  };
  walk(x);
  return got;
}
// похоже ли на рецепт: список с количествами, а не одно название с хэштегами
function looksRecipe(t: string) {
  const bare = t.replace(/#[\p{L}\p{N}_]+/gu, "").trim();
  const lines = bare.split(/\n/).filter((l) => l.trim()).length, nums = (bare.match(/\d/g) || []).length;
  return bare.length >= 80 && (nums >= 2 || lines >= 5);
}
// комментарии к посту Instagram (первая страница): рецепт часто выкладывают в первом комментарии автора
async function igComments(url: string, sc: string, owner: string) {
  const r = await fetch(`https://api.scrapecreators.com/v2/instagram/post/comments?url=${encodeURIComponent(url)}`, { headers: { "x-api-key": sc }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) return null;
  const list: { text: string; by: string }[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, Record<string, unknown> | string>;
    if (typeof o.text === "string" && o.text.length > 0) {
      const u = (o.user as Record<string, unknown>)?.username ?? (o.owner as Record<string, unknown>)?.username ?? o.username;
      list.push({ text: o.text, by: String(u || "") });
    }
    for (const vv of Object.values(o)) if (vv && typeof vv === "object") walk(vv);
  };
  walk(await r.json());
  const mine = list.filter((c) => owner && c.by.toLowerCase() === owner.toLowerCase() && looksRecipe(c.text)).sort((a, b) => b.text.length - a.text.length)[0];
  if (mine) return { text: mine.text, who: "комментарий автора" };
  const first = list.slice(0, 3).filter((c) => looksRecipe(c.text)).sort((a, b) => b.text.length - a.text.length)[0];
  return first ? { text: first.text, who: "из первых комментариев" } : null;
}
async function igRecipe(u: URL) {
  const fb = /(^|\.)facebook\.com$/.test(u.hostname), net = fb ? "Facebook" : "Instagram";
  const m = fb ? null : u.pathname.match(/^\/(p|reel|reels|tv)\/([\w-]+)/);
  if (!fb && !m) throw new Error("Это ссылка не на пост — откройте пост в Instagram и нажмите «Поделиться» → «Копировать ссылку»");
  const url = fb ? `https://www.facebook.com${u.pathname}` : `https://www.instagram.com/${m![1] === "p" ? "p" : "reel"}/${m![2]}/`;
  let caption = "", owner = "";
  const sc = (Deno.env.get("SCRAPECREATORS_API_KEY") ?? "").trim(), bd = (Deno.env.get("BRIGHTDATA_API_KEY") ?? "").trim();
  if (sc) try {
    const r = await fetch(`https://api.scrapecreators.com/v1/${fb ? "facebook" : "instagram"}/post?url=${encodeURIComponent(url)}&trim=true`, { headers: { "x-api-key": sc }, signal: AbortSignal.timeout(25000) });
    if (r.ok) { const j = await r.json(); caption = findCaption(j); owner = findOwner(j); }
  } catch { /* запасной посредник */ }
  if (!caption && bd && !fb) try {
    const r = await fetch("https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lk5ns7kz21pck8jpis&format=json", {
      method: "POST", headers: { Authorization: `Bearer ${bd}`, "Content-Type": "application/json" }, body: JSON.stringify([{ url }]), signal: AbortSignal.timeout(45000) });
    if (r.ok) caption = findCaption(await r.json());
  } catch { /* нет ответа */ }
  if (!caption) throw new Error(`Не удалось открыть пост в ${net} — проверьте, что он публичный, или пришлите скриншот`);
  // рецепт в подписи — это список с количествами; одно название с хэштегами модель «дописала» бы сама
  if (looksRecipe(caption)) return `Рецепт из ${net} (подпись к посту):\n${caption}`.slice(0, 12000);
  // в подписи нет — смотрим комментарии: сначала комментарий автора, потом первые три
  if (!fb && sc) try {
    const c = await igComments(url, sc, owner);
    if (c) return `Рецепт из ${net} (${c.who}):\n${c.text}\n\nПодпись к посту (там название блюда):\n${caption.slice(0, 800)}`.slice(0, 12000);
  } catch { /* комментарии не открылись */ }
  throw new Error(fb ? "В подписи к этому посту нет рецепта — он, видимо, только в видео. Сделайте скриншот кадра с ингредиентами"
    : "Рецепта нет ни в подписи, ни в комментариях автора — он, видимо, только в видео. Сделайте скриншот кадра с ингредиентами");
}

// рецепт со страницы: сначала разметка schema.org Recipe (JSON-LD), иначе текст страницы
async function pageRecipe(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Не похоже на ссылку"); }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(u.hostname) || u.hostname.endsWith(".internal"))
    throw new Error("Эту ссылку открыть нельзя");
  if (/(^|\.)(instagram|facebook)\.com$/.test(u.hostname)) return await igRecipe(u);
  if (/(tiktok\.com|youtube\.com|youtu\.be|fb\.watch)$/.test(u.hostname))
    throw new Error("TikTok и YouTube не отдают рецепт по ссылке — скопируйте текст или сделайте скриншот");
  const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (compatible; SaliRecipeBot/1.0)", "accept-language": "he,ru,en" }, redirect: "follow" });
  if (!r.ok) throw new Error(`Сайт ответил ${r.status} — скопируйте текст рецепта`);
  const html = (await r.text()).slice(0, 2_000_000);
  const pick = (x: unknown): Record<string, unknown> | null => {
    if (!x || typeof x !== "object") return null;
    if (Array.isArray(x)) { for (const y of x) { const f = pick(y); if (f) return f; } return null; }
    const o = x as Record<string, unknown>, t = o["@type"];
    if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return o;
    return pick(o["@graph"]);
  };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const rec = pick(JSON.parse(m[1].trim()));
      if (!rec) continue;
      // deno-lint-ignore no-explicit-any
      const stepText = (s: any): string => typeof s === "string" ? s : s?.text ?? (s?.itemListElement ?? []).map(stepText).join("\n");
      const steps = ([] as unknown[]).concat(rec.recipeInstructions ?? []).map(stepText).join("\n");
      return [`${rec.name ?? ""}`, `Порций: ${rec.recipeYield ?? ""}`, `Время: ${rec.totalTime ?? ""}`,
        "Ингредиенты:", ...([] as unknown[]).concat(rec.recipeIngredient ?? []).map(String), "Приготовление:", steps].join("\n").slice(0, 12000);
    } catch { /* следующий блок */ }
  }
  const text = html.replace(/<(script|style|noscript|svg|header|footer|nav)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split("\n").map((l) => l.trim()).filter((l) => l.length > 1).join("\n");
  if (text.length < 200) throw new Error("На странице не нашли рецепт — скопируйте текст рецепта");
  return text.slice(0, 12000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: { text?: string; url?: string; image?: { media_type?: string; data?: string } };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (JSON.stringify(body).length > 3_000_000) return json({ error: "Фото слишком большое" }, 413);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // гарниры библиотеки — для сопоставления
  const { data: libSides } = await db.from("menu_recipes").select("id,name").eq("kind", "side");
  const matchSide = (title?: string) => {
    if (!title) return null;
    const n = normName(title);
    return (libSides ?? []).find((x) => normName(x.name) === n) ?? null;
  };

  // режим «разделить готовый рецепт»
  const sp = (body as { split?: { name?: string; ingredients?: unknown[]; steps?: unknown[] } }).split;
  if (sp) {
    const ings = (sp.ingredients ?? []).map(String).slice(0, 40), stp = (sp.steps ?? []).map(String).slice(0, 20);
    if (!sp.name || !ings.length) return json({ error: "нужно name и ingredients" }, 400);
    const ip0 = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const { data: ok0 } = await db.rpc("menu_take", { p_client: await sha(ip0 + "menu-salt-1"), p_per_client: 60, p_total: 400 });
    if (!ok0) return json({ error: "Лимит на сегодня исчерпан, попробуйте завтра" }, 429);
    const prompt = `${SPLIT_RULES}\n\nРецепт «${sp.name}».\nИнгредиенты:\n${ings.map((x, i) => `${i}. ${x}`).join("\n")}\n` +
      `Шаги:\n${stp.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nОтветь только вызовом инструмента split_recipe.`;
    const r0 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYSTEM, tools: [SPLIT_TOOL], tool_choice: { type: "auto" }, thinking: { type: "between_tools" },
        messages: [{ role: "user", content: prompt }] }),
    });
    const d0 = await r0.json();
    if (!r0.ok) return json({ error: `Не получилось разделить (${r0.status}): ${JSON.stringify(d0).slice(0, 300)}` }, 502);
    const res0 = (d0.content || []).find((b: { type: string }) => b.type === "tool_use")?.input ?? { split: false };
    return json({ result: res0, side_match: res0.split ? matchSide(res0.side_title) : null });
  }

  let text = String(body.text ?? "").slice(0, 12000);
  const image = body.image && /^image\/(jpeg|png|webp)$/.test(String(body.image.media_type)) && typeof body.image.data === "string" && body.image.data.length > 100
    ? { media_type: String(body.image.media_type), data: body.image.data } : undefined;
  try {
    if (body.url) text = await pageRecipe(String(body.url).trim());
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 422); }
  if (!image && text.trim().length < 20) return json({ error: "Рецепт слишком короткий" }, 400);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const { data: allowed, error: le } = await db.rpc("menu_take", { p_client: await sha(ip + "menu-salt-1"), p_per_client: 40, p_total: 400 });
  if (le) return json({ error: "limit check: " + le.message }, 500);
  if (!allowed) return json({ error: "Лимит на сегодня исчерпан, попробуйте завтра" }, 429);

  // справочник: только рецептурные ключи и их предки, деревом
  type G = { key: string; name_ru: string; name_he: string; base_unit: string; piece_g: number; tbsp_g: number; tsp_g: number; parent: string | null; is_group: boolean; recipe: boolean };
  const { data: ing } = await db.from("g_ingredients").select("key,name_ru,name_he,base_unit,piece_g,tbsp_g,tsp_g,parent,is_group,recipe").order("key");
  const byKey = new Map(((ing ?? []) as G[]).map((g) => [g.key, g]));
  const need = new Set<string>();
  for (const g of byKey.values()) if (g.recipe && !g.is_group) for (let x: G | undefined = g; x && !need.has(x.key); x = x.parent ? byKey.get(x.parent) : undefined) need.add(x.key);
  const all = ((ing ?? []) as G[]).filter((g) => need.has(g.key));
  const kids = new Map<string, G[]>();
  for (const g of all) { const k = g.parent ?? ""; if (!kids.has(k)) kids.set(k, []); kids.get(k)!.push(g); }
  const out: string[] = [];
  const walk = (k: string, d: number) => {
    for (const g of kids.get(k) ?? []) {
      out.push(" ".repeat(d) + (g.is_group ? `[${g.name_ru}] ${g.key}` : [g.key, g.name_ru, g.name_he, g.base_unit,
        g.piece_g ? `шт≈${g.piece_g}г` : "", g.tbsp_g ? `ст.л.≈${g.tbsp_g}г` : "", g.tsp_g ? `ч.л.≈${g.tsp_g}г` : ""].filter(Boolean).join(" | ")));
      walk(g.key, d + 1);
    }
  };
  walk("", 0);

  const prompt =
    `Разбери рецепт на ингредиенты и сопоставь каждый с ключом из справочника.\n` +
    `Правила:\n- qty — в базовой единице ключа (г, мл или шт); переводи стаканы (1 стакан = 240 мл; муки ≈130 г, сахара ≈200 г), ложки, штуки, ` +
    `пучки по подсказкам справочника. «Горсть» зелени ≈ 20 г. «Немного/по вкусу» — оцени разумно и поставь guess=true.\n` +
    `- Если базовая единица ключа — мл, ложки и стаканы переводи по объёму: 1 ст. л. = 15 мл, 1 ч. л. = 5 мл, 1 стакан = 240 мл ` +
    `(подсказки ст.л./ч.л. в граммах — только для ключей в г).\n` +
    `- note — как количество записано в рецепте, если там ложки, стаканы, щепотки, зубчики, пучки и т. п.: кратко по-русски, ` +
    `«4 ст. л.», «1,5 стакана», «щепотка». Если в рецепте граммы, мл, кг, литры или штуки той же единицы — note не заполняй.\n` +
    `- Воду не включай.\n` +
    `- Бери самый точный ключ, который прямо следует из текста; если вид не указан — общий ключ, а не случайную разновидность. ` +
    `Справочник — дерево: отступ значит «разновидность ключа строкой выше».\n` +
    `- Если точного ключа нет, бери ближайший только если замена честная (красный лук ≠ просто лук). Иначе key=null и опиши продукт в missing.\n` +
    `- Сушёное ≠ свежее, консервированное ≠ свежее. Не меняй сорт и цвет.\n` +
    `- Раздел «сборка/подача» обычно повторяет то, что уже приготовлено выше: такие строки не включай повторно.\n` +
    `- line — строка рецепта кратко по-русски. steps — шаги по-русски своими словами, не дословно. minutes/work_minutes — оценка, если не указано.\n` +
    `- Основное и гарнир. ${SPLIT_RULES} Если делишь: dish_type=main, main_title, side_title, side_items — номера строк гарнира в items, ` +
    `side_steps — шаги гарнира, steps — только шаги основного. Если рецепт — сам гарнир, dish_type=side. Иначе dish_type=dish.\n\n` +
    (image ? `Рецепт на фотографии (страница книги, тетрадь, скриншот) — прочитай его.${text.trim() ? "\nПодпись пользователя: " + text : ""}` : `Рецепт:\n${text}`) +
    `\n\nОтветь только вызовом инструмента parsed_recipe, без текста.`;

  const t0 = Date.now();
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 6000,
      system: [{ type: "text", text: SYSTEM }, { type: "text", text: `Справочник ингредиентов (ключ | по-русски | на иврите | базовая единица | подсказки):\n${out.join("\n")}`, cache_control: { type: "ephemeral" } }],
      tools: [TOOL], tool_choice: { type: "auto" },
      messages: [{ role: "user", content: image
        ? [{ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } }, { type: "text", text: prompt }]
        : prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) return json({ error: `Не получилось разобрать (${r.status})` }, 502);
  const block = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (!block) return json({ error: "Не получилось разобрать рецепт" }, 502);
  const res = block.input as { items?: { key: string | null }[] };
  // к ключам — названия и базовые единицы, чтобы страница могла показать продукт
  const keys = [...new Set((res.items ?? []).map((i) => i.key).filter(Boolean))] as string[];
  const defs = Object.fromEntries(keys.filter((k) => byKey.has(k)).map((k) => { const g = byKey.get(k)!; return [k, { name: g.name_ru, name_he: g.name_he, unit: g.base_unit, piece_g: g.piece_g }]; }));
  const side_match = (res as { dish_type?: string; side_title?: string }).dish_type === "main" ? matchSide((res as { side_title?: string }).side_title) : null;
  return json({ result: res, defs, side_match, ms: Date.now() - t0 });
});
