// Варианты логотипа/брендинга через Gemini (nano banana): POST {token, items:[{id, prompt, aspect?}]} → {results:[{id, url}|{id, error}]}
// Доступ — по одноразовому пропуску из g_worker_tokens (scope 'brand'), картинки — в recipe-images/brand/.
const SB = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GK = Deno.env.get("GEMINI_API_KEY")!;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

async function gen(prompt: string, aspect = "1:1") {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": GK, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`gemini ${res.status}: ${j?.error?.message ?? ""}`.slice(0, 300));
  const part = (j.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: { data: string } }) => p.inlineData?.data);
  if (!part) throw new Error("no image");
  return { mime: part.inlineData.mimeType as string, bytes: Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0)) };
}

Deno.serve(async (req) => {
  try {
    const { token, items = [] } = await req.json();
    const ok = await fetch(`${SB}/rest/v1/g_worker_tokens?select=token&scope=eq.brand&token=eq.${encodeURIComponent(token || "")}&expires_at=gt.${new Date().toISOString()}`, { headers: H }).then((r) => r.json());
    if (!Array.isArray(ok) || !ok.length) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    const results = await Promise.all((items as { id: string; prompt: string; aspect?: string }[]).slice(0, 6).map(async (it) => {
      try {
        const img = await gen(it.prompt, it.aspect);
        const ext = img.mime.includes("jpeg") ? "jpg" : "png";
        const path = `brand/${it.id.replace(/[^a-z0-9_-]/gi, "")}-${Date.now().toString(36)}.${ext}`;
        const up = await fetch(`${SB}/storage/v1/object/recipe-images/${path}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": img.mime, "x-upsert": "true" }, body: img.bytes });
        if (!up.ok) throw new Error("storage " + up.status);
        return { id: it.id, url: `${SB}/storage/v1/object/public/recipe-images/${path}` };
      } catch (e) { return { id: it.id, error: String((e as Error).message ?? e).slice(0, 300) }; }
    }));
    return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
