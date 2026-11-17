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
  description: "Переводы названий товаров в том же порядке",
  input_schema: {
    type: "object",
    properties: { items: { type: "array", items: { type: "object", properties: { i: { type: "integer" }, t: { type: "string" } }, required: ["i", "t"] } } },
    required: ["items"],
  },
};

async function translate(names: string[], lang: string, makers: Record<string, string>): Promise<Record<number, string>> {
  const system = `Ты переводишь названия товаров из прайсов израильских супермаркетов на ${LANGS[lang]} язык.
Названия часто сокращены — раскрывай сокращения: מלפ. = מלפפון, ק"ג/קג = кг, גר/ג' = г, יח' = шт., אר./ארוז = фасованный, ת.א. = картофель.
В названии бывает бренд или производитель (иногда сокращённо: א.אדמה = бренд «Адама», а не «земля»), а иногда — название сети (רמי לוי, שופרסל, יוחננוף): это не часть товара, его опускай.
Производитель дан только как подсказка, где в названии бренд: если бренда нет в самом названии — не добавляй его. Название сети (רמי לוי, שופרסל, ויקטורי, טיב טעם, יוחננוף, אושר עד, קשת) никогда не пиши.
Пиши так, как товар назвали бы в русском магазине, коротко и естественно. Примеры:
גזר ארוז → Морковь фасованная; בצל יבש → Лук репчатый; בצל ירוק רמי לוי → Зелёный лук; פטרוזיליה א.אדמה → Петрушка «Адама»;
מלפ. במלח קטן13-17 540גר → Огурцы солёные мелкие 13–17, 540 г; גבינה לבנה 5% 250 גר → Творог 5%, 250 г; שמנת חמוצה 15% → Сметана 15%;
חזה עוף → Куриное филе; פרגיות → Куриные бёдра без кости; קוטג' 5% → Коттедж 5%; לחם אחיד פרוס → Хлеб «Ахид» нарезной.
Вес, объём, жирность, количество штук сохраняй. Бренды пиши как принято по-русски (Тнува, Штраус, Осем) или транслитом в кавычках.
Ничего не добавляй от себя. Если не понимаешь слово — оставь его транслитом.`;
  const user = names.map((n, i) => `${i}. ${n}${makers[n] ? ` (производитель: ${makers[n]})` : ""}`).join("\n");
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
  const out: Record<number, string> = {};
  for (const x of block?.input?.items || []) if (Number.isInteger(x.i) && typeof x.t === "string" && x.t.trim()) out[x.i] = x.t.trim();
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { lang = "ru", names = [], makers = {} } = await req.json();
    if (!LANGS[lang]) return json({ error: "язык не поддерживается" }, 400);
    const uniq = [...new Set((names as unknown[]).filter((n): n is string => typeof n === "string" && n.trim().length > 0 && n.length < 200))].slice(0, MAX);
    if (!uniq.length) return json({ tr: {} });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const tr: Record<string, string> = {};
    const { data: have } = await db.from("g_name_tr").select("src,tr").eq("lang", lang).in("src", uniq);
    for (const x of have || []) tr[x.src] = x.tr;
    const miss = uniq.filter((n) => !(n in tr));
    if (miss.length) {
      const got = await translate(miss, lang, makers && typeof makers === "object" ? makers : {});
      const rows = Object.entries(got).map(([i, t]) => ({ src: miss[+i], lang, tr: t })).filter((x) => x.src);
      for (const x of rows) tr[x.src] = x.tr;
      if (rows.length) await db.from("g_name_tr").upsert(rows, { onConflict: "src,lang" });
    }
    return json({ tr });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
