// Перевод названий товаров из прайсов сетей (иврит, часто сокращённо) на язык приложения.
//   POST {lang: "ru", names: ["מלפ. במלח קטן13-17 540גר", ...], makers?: {"<иврит>": "<производитель>"}} → {tr: {"<иврит>": "<перевод>"}}
// Переводы кэшируются в таблице g_name_tr: каждое название переводится один раз на все устройства.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";
const MAX = 120;
const LANGS: Record<string, string> = { ru: "русский", en: "английский" };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });
const apiKey = () => (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "").trim();

const TOOL = {
  name: "translations",
  description: "Переводы названий товаров: для каждого — исходное название дословно (s) и перевод (t)",
  input_schema: {
    type: "object",
    properties: { items: { type: "array", items: { type: "object", properties: { s: { type: "string" }, t: { type: "string" } }, required: ["s", "t"] } } },
    required: ["items"],
  },
};

const BAD_SCRIPT = /[\u0590-\u05ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/; // иврит, японский, китайский, корейский — значит, модель сбилась
const BATCH = 25; // маленькие пачки: в длинных модель сбивалась и переводы уезжали к соседним строкам
async function translate(names: string[], lang: string, makers: Record<string, string>): Promise<Record<string, string>> {
  const parts: string[][] = [];
  for (let i = 0; i < names.length; i += BATCH) parts.push(names.slice(i, i + BATCH));
  const res = await Promise.allSettled(parts.map((p) => translateBatch(p, lang, makers)));
  return Object.assign({}, ...res.map((r) => (r.status === "fulfilled" ? r.value : {})));
}
async function translateBatch(names: string[], lang: string, makers: Record<string, string>): Promise<Record<string, string>> {
  const system = `Ты переводишь названия товаров из прайсов израильских супермаркетов на ${LANGS[lang]} язык.
Названия часто сокращены — раскрывай сокращения: מלפ. = מלפפון, ק"ג/קג = кг, גר/ג' = г, יח' = шт., אר./ארוז = фасованный, ת.א. = картофель.
В названии бывает бренд или производитель (иногда сокращённо: א.אדמה = бренд «Адама», а не «земля»), а иногда — название сети (רמי לוי, שופרסל, יוחננוף): это не часть товара, его опускай.
Производитель дан только как подсказка, где в названии бренд: если бренда нет в самом названии — не добавляй его. Название сети (רמי לוי, שופרסל, ויקטורי, טיב טעם, יוחננוף, אושר עד, קשת) никогда не пиши.
Пиши так, как товар назвали бы в русском магазине, коротко и естественно. Примеры:
גזר ארוז → Морковь фасованная; בצל יבש → Лук репчатый; בצל ירוק רמי לוי → Зелёный лук; פטרוזיליה א.אדמה → Петрушка «Адама»;
מלפ. במלח קטן13-17 540גר → Огурцы солёные мелкие 13–17, 540 г; גבינה לבנה 5% 250 גר → Творог 5%, 250 г; שמנת חמוצה 15% → Сметана 15%;
חזה עוף → Куриное филе; פרגיות → Куриные бёдра без кости; קוטג' 5% → Коттедж 5%; לחם אחיד פרוס → Хлеб «Ахид» нарезной;
פיתה → пита (не лаваш); פתיתים → птитим (паста-крупа, не хлопья); פריכיות → хлебцы; פריכונים → мини-хлебцы (не пышки); אסם → «Осем»; אמנון → тилапия; לברק → лаврак; דניס → дорада; כוסמין → полба; צנון → редис; עוף טחון → куриный фарш.
Вес, объём, жирность, количество штук сохраняй. Бренды пиши как принято по-русски (Тнува, Штраус, Осем) или транслитом в кавычках.
Ничего не добавляй от себя. Если не понимаешь слово — оставь его транслитом. Пиши только буквами целевого языка (кириллица для русского, латиница для английского), цифрами и знаками — никаких иероглифов и иврита.${lang === "en" ? `
Примеры выше — для русского; на английском пиши так, как товар назвали бы в магазине в США или Великобритании (Cottage cheese 5%, Pita, Ptitim, Rice cakes).` : ""}
В ответе для каждой строки верни s — исходное название на иврите дословно, символ в символ (без номера и без подсказки о производителе), и t — его перевод.`;
  const user = names.map((n, i) => `${i + 1}. ${n}${makers[n] ? ` (производитель: ${makers[n]})` : ""}`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 8000, system,
      tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const block = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  // принимаем перевод только если модель дословно повторила исходное название из этой пачки
  const want = new Map(names.map((n) => [n.trim(), n]));
  const out: Record<string, string> = {};
  for (const x of block?.input?.items || []) {
    const src = typeof x.s === "string" ? want.get(x.s.trim()) : undefined;
    if (src && typeof x.t === "string" && x.t.trim() && !BAD_SCRIPT.test(x.t)) out[src] = x.t.trim();
  }
  return out;
}

// служебное: заранее перевести все названия товаров с ценами (только с ключом service_role)
//   POST {action: "warm", lang} → {done, left}; вызывать в цикле, пока left > 0
async function warm(req: Request, lang: string) {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "forbidden" }, 403);
  const { error: pe } = await createClient(Deno.env.get("SUPABASE_URL")!, bearer).rpc("menu_admin_ping"); // проходит только с ключом service_role
  if (pe) return json({ error: "forbidden" }, 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const t0 = Date.now();
  let done = 0, left = 0;
  while (Date.now() - t0 < 100000) {
    const { data, error } = await db.rpc("g_name_tr_todo", { p_lang: lang, p_limit: 200 });
    if (error) return json({ error: error.message }, 500);
    const list = (data ?? []) as { name: string; maker: string | null }[];
    left = list.length;
    if (!list.length) break;
    const makers = Object.fromEntries(list.filter((x) => x.maker).map((x) => [x.name, x.maker as string]));
    const got = await translate(list.map((x) => x.name), lang, makers);
    const rows = Object.entries(got).map(([src, tr]) => ({ src, lang, tr }));
    if (rows.length) {
      const { error: e } = await db.from("g_name_tr").upsert(rows, { onConflict: "src,lang" });
      if (e) return json({ error: e.message }, 500);
    }
    done += rows.length;
    if (!rows.length) break; // модель ничего не вернула — не крутимся впустую
  }
  return json({ done, left });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const { lang = "ru", names = [], makers = {} } = body;
    if (!LANGS[lang]) return json({ error: "язык не поддерживается" }, 400);
    if (body.action === "warm") return await warm(req, lang);
    const uniq = [...new Set((names as unknown[]).filter((n): n is string => typeof n === "string" && n.trim().length > 0 && n.length < 200))].slice(0, MAX);
    if (!uniq.length) return json({ tr: {} });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const tr: Record<string, string> = {};
    const { data: have } = await db.from("g_name_tr").select("src,tr").eq("lang", lang).in("src", uniq);
    for (const x of have || []) tr[x.src] = x.tr;
    const miss = uniq.filter((n) => !(n in tr));
    if (miss.length) {
      const got = await translate(miss, lang, makers && typeof makers === "object" ? makers : {});
      const rows = Object.entries(got).map(([src, t]) => ({ src, lang, tr: t }));
      for (const x of rows) tr[x.src] = x.tr;
      if (rows.length) await db.from("g_name_tr").upsert(rows, { onConflict: "src,lang" });
    }
    return json({ tr });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
