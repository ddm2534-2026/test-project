// Иконки продуктов: генерация картинки продукта в заданном стиле (Gemini) и загрузка в storage.
// POST {style, items:[{key, en}]} → {results:[{key, url}]} — образцы стилей;
// POST {queue: n} — берёт n продуктов из очереди (claim_ingredient_images), фото «на светлом», пишет g_ingredients.img.
// Только для вызова из базы (JWT).
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GK = Deno.env.get("GEMINI_API_KEY")!;

const STYLES: Record<string, (en: string) => string> = {
  photo_table: (en) => `Realistic food photo of ${en} (raw grocery ingredient, a small natural amount) lying on a light natural wooden table, shot from directly above, soft natural window daylight, gentle shadow, centered, lots of empty wood around it. Same warm rustic look as a home-cooking food photo. No text, no labels, no packaging, no brand, no hands. Square.`,
  photo_plain: (en) => `Studio product photo of ${en} (raw grocery ingredient, a small natural amount), centered on a plain soft warm off-white background (#F4F1EA), soft diffused light, subtle natural shadow, slight 3/4 angle, crisp detail. Clean minimal catalogue style. No text, no labels, no packaging, no brand, no props, no hands. Square.`,
  flat_vector: (en) => `Flat vector illustration icon of ${en} (grocery ingredient). Simple geometric shapes, no outlines, two or three flat colors with one soft highlight, muted natural palette (sage green #137A4B accents, warm beige, terracotta), centered on a plain light cream background (#F4F1EA), generous padding. Consistent minimal app-icon style. No text, no shadows, no gradients. Square.`,
  flat_gouache: (en) => `Hand-painted gouache illustration of ${en} (grocery ingredient), soft visible brush texture, warm muted natural colors, simple and friendly, like a cookbook illustration, centered on a plain light cream paper background (#F4F1EA), generous padding. No outlines, no text. Square.`,
};

async function gen(prompt: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": GK, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } } }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`gemini ${res.status}: ${j?.error?.message ?? ""}`.slice(0, 300));
  const part = (j.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data);
  if (!part) throw new Error("no image");
  return { mime: part.inlineData.mimeType as string, bytes: Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0)) };
}

const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function upload(path: string, img: { mime: string; bytes: Uint8Array }) {
  const up = await fetch(`${SB}/storage/v1/object/recipe-images/${path}`, {
    method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": img.mime, "x-upsert": "true" }, body: img.bytes,
  });
  if (!up.ok) throw new Error("storage " + up.status);
  return `${SB}/storage/v1/object/public/recipe-images/${path}`;
}
type Q = { key: string; name_ru: string; name_he: string | null; category: string | null };
async function queued(n: number) {
  const q = await fetch(`${SB}/rest/v1/rpc/claim_ingredient_images`, { method: "POST", headers: H, body: JSON.stringify({ n }) });
  const rows: Q[] = await q.json();
  if (!Array.isArray(rows) || !rows.length) return { done: 0 };
  const out = await Promise.all(rows.map(async (r) => {
    const patch = (b: unknown) => fetch(`${SB}/rest/v1/g_ingredients?key=eq.${encodeURIComponent(r.key)}`, { method: "PATCH", headers: H, body: JSON.stringify(b) });
    try {
      const what = `${r.name_ru}${r.name_he ? ` (in Hebrew: ${r.name_he})` : ""} — as sold in an Israeli supermarket, shown as the food itself`;
      const raw = await gen(STYLES.photo_plain(what));
      // иконка 60–48 px: храним 192×192 JPEG (~10 КБ), исходник не нужен
      const im = (await Image.decode(raw.bytes)).cover(192, 192);
      const img = { mime: "image/jpeg", bytes: await im.encodeJPEG(80) };
      const url = await upload(`ingredients/${r.key}-${Date.now().toString(36)}.jpg`, img);
      await patch({ img: url, img_status: "done", img_error: null });
      return { key: r.key, ok: true };
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      await patch({ img_status: "error", img_error: msg });
      return { key: r.key, error: msg };
    }
  }));
  return { results: out };
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.queue) return Response.json(await queued(Math.min(Math.max(Number(body.queue) || 6, 1), 10)));
  const style = String(body.style ?? ""), folder = /^[a-z0-9_\-]+$/.test(body.folder ?? "") ? body.folder : "icon-samples";
  if (!STYLES[style]) return Response.json({ error: "style" }, { status: 400 });
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 8)
    .filter((x: any) => /^[a-z0-9_]+$/.test(x?.key ?? "") && typeof x?.en === "string" && x.en.length < 80);
  const results = await Promise.all(items.map(async (x: { key: string; en: string }) => {
    try {
      const img = await gen(STYLES[style](x.en));
      const ext = img.mime.includes("png") ? "png" : img.mime.includes("webp") ? "webp" : "jpg";
      const path = `${folder}/${style}/${x.key}.${ext}`;
      const up = await fetch(`${SB}/storage/v1/object/recipe-images/${path}`, {
        method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": img.mime, "x-upsert": "true" }, body: img.bytes,
      });
      if (!up.ok) throw new Error("storage " + up.status);
      return { key: x.key, url: `${SB}/storage/v1/object/public/recipe-images/${path}` };
    } catch (e) { return { key: x.key, error: String((e as Error).message ?? e).slice(0, 300) }; }
  }));
  return Response.json({ style, results });
});
