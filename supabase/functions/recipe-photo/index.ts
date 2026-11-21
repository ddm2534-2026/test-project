// Фото своего рецепта. Только для вошедших пользователей (проверяем их токен).
//  POST {gen: {name, items:[строки], kind?}} → {mime, data}  — иллюстрация блюда через Gemini (лимит в день на пользователя)
//  POST {put: {full, thumb}}  (base64 JPEG, уже уменьшенные в браузере) → {image_url, thumb_url} — в recipe-images/user/<uid>/
const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GK = Deno.env.get("GEMINI_API_KEY")!;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const DAY_LIMIT = 20;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function userId(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SR, Authorization: auth } });
  if (!r.ok) return null;
  return ((await r.json())?.id as string) || null;
}

async function gen(name: string, items: string[]) {
  const prompt = `Realistic, appetizing home-cooked food photo of the finished dish "${name}"` +
    (items.length ? ` (made with ${items.slice(0, 12).join(", ")})` : "") +
    `. Served on a simple plate or in a bowl on a light wooden kitchen table, soft natural daylight, three-quarter angle, shallow depth of field. ` +
    `Only the food and tableware: no text, no labels, no logos, no people, no hands.`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": GK, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3" } } }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`gemini ${res.status}: ${j?.error?.message ?? ""}`.slice(0, 200));
  const part = (j.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: { data: string } }) => p.inlineData?.data);
  if (!part) throw new Error("Не получилось нарисовать — попробуйте ещё раз");
  return { mime: part.inlineData.mimeType as string, data: part.inlineData.data as string };
}

async function put(path: string, b64: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length > 2_500_000) throw new Error("Слишком большое фото");
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error("Нужен JPEG");
  const up = await fetch(`${SB}/storage/v1/object/recipe-images/${path}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "image/jpeg", "x-upsert": "true", "cache-control": "max-age=31536000" }, body: bytes });
  if (!up.ok) throw new Error("storage " + up.status);
  return `${SB}/storage/v1/object/public/recipe-images/${path}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const uid = await userId(req);
    if (!uid) return out({ error: "Войдите, чтобы добавить фото" }, 401);
    const body = await req.json();
    if (body.gen) {
      const since = new Date(Date.now() - 864e5).toISOString();
      const used = await fetch(`${SB}/rest/v1/recipe_photo_log?select=id&user_id=eq.${uid}&at=gt.${since}`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
      const n = Number((used.headers.get("content-range") || "").split("/")[1] || 0);
      if (n >= DAY_LIMIT) return out({ error: `На сегодня лимит иллюстраций исчерпан (${DAY_LIMIT} в день)` }, 429);
      await fetch(`${SB}/rest/v1/recipe_photo_log`, { method: "POST", headers: H, body: JSON.stringify({ user_id: uid }) });
      const name = String(body.gen.name || "").slice(0, 120).trim();
      if (!name) return out({ error: "Нет названия блюда" }, 400);
      const items = (Array.isArray(body.gen.items) ? body.gen.items : []).map((s: unknown) => String(s).slice(0, 40));
      return out(await gen(name, items));
    }
    if (body.put) {
      const id = crypto.randomUUID().slice(0, 13);
      const [image_url, thumb_url] = await Promise.all([put(`user/${uid}/${id}.jpg`, String(body.put.full || "")), put(`user/${uid}/${id}_t.jpg`, String(body.put.thumb || ""))]);
      return out({ image_url, thumb_url });
    }
    return out({ error: "bad request" }, 400);
  } catch (e) {
    return out({ error: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
