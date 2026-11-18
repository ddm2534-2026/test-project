// Иконки продуктов: генерация картинки продукта в заданном стиле (Gemini) и загрузка в storage.
// POST {style, items:[{key, en}]} → {results:[{key, url}]}. Только для вызова из базы (JWT).
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

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
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
