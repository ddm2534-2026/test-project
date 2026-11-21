// Web Push без сторонних библиотек: шифрование тела aes128gcm (RFC 8291) и подпись VAPID (RFC 8292) на WebCrypto.
const te = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const subtle = crypto.subtle;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}

// тело пуша для подписки браузера (p256dh, auth — base64url из PushSubscription)
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string) {
  const uaPub = unb64u(p256dh), secret = unb64u(auth);
  const as = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await subtle.exportKey("raw", as.publicKey));
  const uaKey = await subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(secret, shared, cat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// подпись VAPID: JWT ES256 для origin push-сервиса
async function vapidHeader(endpoint: string, pub: string, priv: string, subject: string) {
  const p = unb64u(pub);
  const jwk = { kty: "EC", crv: "P-256", d: priv, x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), ext: true };
  const key = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export async function sendPush(s: PushSub, payload: string | null, v: { pub: string; priv: string; subject: string }, opt: { ttl?: number; urgency?: string } = {}) {
  const headers: Record<string, string> = { TTL: String(opt.ttl ?? 86400), Urgency: opt.urgency || "high", Authorization: await vapidHeader(s.endpoint, v.pub, v.priv, v.subject) };
  let body: Uint8Array | undefined;
  if (payload != null) { body = await encrypt(te.encode(payload), s.p256dh, s.auth); headers["Content-Encoding"] = "aes128gcm"; headers["Content-Type"] = "application/octet-stream"; }
  const r = await fetch(s.endpoint, { method: "POST", headers, body });
  const text = r.ok ? "" : (await r.text()).slice(0, 200);
  return { status: r.status, ok: r.ok, text };
}
