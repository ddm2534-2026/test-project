// Проба посредников для подписи поста Instagram: Bright Data, Apify, ScrapeCreators — параллельно, с замером времени.
//   POST {token, url} → {url, results: [{provider, ok, ms, status, caption, error}]}
// Ключи — секреты функции: BRIGHTDATA_API_KEY, APIFY_TOKEN, SCRAPECREATORS_API_KEY (нет ключа — посредник пропускается).
// Доступ — по временному пропуску из g_worker_tokens (scope 'igtest').
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const env = (k: string) => (Deno.env.get(k) ?? "").trim();

// подпись ищем по знакомым ключам в любом месте ответа и берём самую длинную строку
function findCaption(x: unknown): string | null {
  let best = "";
  const walk = (v: unknown, k = "") => {
    if (typeof v === "string") { if (/^(caption|description|text|caption_text)$/i.test(k) && v.length > best.length) best = v; return; }
    if (Array.isArray(v)) { v.forEach((y) => walk(y, k)); return; }
    if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(x);
  return best || null;
}

async function timed(provider: string, fn: () => Promise<Response>) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const txt = await r.text();
    let data: unknown = null; try { data = JSON.parse(txt); } catch { /* не JSON */ }
    const caption = data ? findCaption(data) : null;
    return { provider, ok: r.ok && !!caption, ms: Date.now() - t0, status: r.status, caption: caption?.slice(0, 600) ?? null,
      error: r.ok ? (caption ? null : "подписи в ответе нет: " + txt.slice(0, 200)) : txt.slice(0, 300) };
  } catch (e) {
    return { provider, ok: false, ms: Date.now() - t0, status: 0, caption: null, error: String((e as Error).message || e) };
  }
}

Deno.serve(async (req) => {
  const { token, url } = await req.json().catch(() => ({}));
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: tk } = await db.from("g_worker_tokens").select("token").eq("scope", "igtest").eq("token", String(token || ""))
    .gt("expires_at", new Date().toISOString()).limit(1);
  if (!tk?.length) return json({ error: "forbidden" }, 403);
  if (!/^https:\/\/(www\.)?instagram\.com\/(p|reel|reels)\/[\w-]+/.test(String(url || ""))) return json({ error: "нужна ссылка на пост или reel" }, 400);

  const jobs: Promise<unknown>[] = [];
  const sc = env("SCRAPECREATORS_API_KEY"), bd = env("BRIGHTDATA_API_KEY"), ap = env("APIFY_TOKEN");
  if (sc) jobs.push(timed("scrapecreators", () => fetch(`https://api.scrapecreators.com/v1/instagram/post?url=${encodeURIComponent(url)}&trim=true`, { headers: { "x-api-key": sc } })));
  if (bd) jobs.push(timed("brightdata", () => fetch("https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lk5ns7kz21pck8jpis&format=json", {
    method: "POST", headers: { Authorization: `Bearer ${bd}`, "Content-Type": "application/json" }, body: JSON.stringify([{ url }]) })));
  if (ap) jobs.push(timed("apify", () => fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(ap)}&timeout=60`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directUrls: [url], resultsType: "posts", resultsLimit: 1 }) })));
  if (!jobs.length) return json({ error: "ни одного ключа не задано" }, 400);
  return json({ url, results: await Promise.all(jobs) });
});
