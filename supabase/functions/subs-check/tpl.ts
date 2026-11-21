// Шаблоны уведомлений: письмо (HTML с инлайн-стилями, таблицы — чтобы одинаково в Gmail, Outlook, Apple Mail) и пуш.
export const APP = "https://ddm2534-2026.github.io/test-project/app/";
const LOGO = `${APP}pwa/icon-192.png`;
const C = { bg: "#FBF6EC", card: "#FFFFFF", ink: "#1C1B18", mu: "#7A7468", g: "#137A4B", gl: "#E8F5EE", red: "#C4532D", line: "#EFE8DA" };
const CHAIN_RU: Record<string, string> = { shufersal: "Шуферсаль", ramilevy: "Рами Леви", victory: "Виктори", tivtaam: "Тив Таам", keshet: "Кешет Теамим", yochananof: "Йоханаоф", osherad: "Ошер Ад", yango: "Yango Deli" };
const CHAIN_COLOR: Record<string, string> = { shufersal: "#E2001A", ramilevy: "#D6001C", victory: "#F28C00", tivtaam: "#A0112D", keshet: "#0B6E3B", yochananof: "#1D4E9E", osherad: "#C8102E", yango: "#5B21B6" };
export const chainBase = (c: string) => String(c || "").replace(/_(store|deal|sheli|express)$/, "");
export const chainRu = (c: string) => CHAIN_RU[chainBase(c)] || c;
export const ils = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₪`;
export const ils2 = (n: number) => `${Number(n).toFixed(2).replace(".", ",")} ₪`;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const dateRu = (d: string) => new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
const plural = (n: number, a: string, b: string, c: string) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };

export type Deal = { chain: string; barcode: string; name: string; pct: number; deal: number; old: number; qty?: number; total?: number; ends?: string; img?: string };
export type Msg = { title: string; body: string; url: string; push: Record<string, unknown>; email: { subject: string; html: string } };

const chainPill = (c: string) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${CHAIN_COLOR[chainBase(c)] || C.g};color:#fff;font-size:11px;font-weight:700;line-height:16px">${esc(chainRu(c))}</span>`;
const dealPrice = (d: Deal) => Number(d.qty) > 1 && Number(d.total) > 0 ? `${Number(d.qty)} за ${ils2(Number(d.total))}` : ils2(d.deal);

function dealRows(deals: Deal[]) {
  return deals.map((d) => `<tr><td style="padding:10px 0;border-top:1px solid ${C.line}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="56" valign="middle" style="padding-right:12px">${d.img ? `<img src="${esc(d.img)}" width="52" height="52" alt="" style="display:block;width:52px;height:52px;border-radius:26px;object-fit:cover;background:${C.bg}">` : `<div style="width:52px;height:52px;border-radius:26px;background:${C.gl}"></div>`}</td>
      <td valign="middle" style="font-size:14px;line-height:19px;color:${C.ink}"><div style="font-weight:700">${esc(d.name)}</div><div style="padding-top:4px">${chainPill(d.chain)}${d.ends ? `<span style="color:${C.mu};font-size:12px"> &nbsp;до ${esc(dateRu(d.ends))}</span>` : ""}</div></td>
      <td valign="middle" align="right" style="white-space:nowrap;padding-left:8px"><div style="font-size:16px;font-weight:800;color:${C.g}">${esc(dealPrice(d))}</div><div style="font-size:12px;color:${C.mu}"><s>${esc(ils2(d.old))}</s> · <b style="color:${C.red}">−${d.pct}%</b></div></td>
    </tr></table></td></tr>`).join("");
}

function layout(o: { pre: string; title: string; lead?: string; block?: string; cta: { text: string; url: string }; why: string }) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.pre)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td align="center" style="padding:0 0 16px"><a href="${APP}" style="text-decoration:none"><img src="${LOGO}" width="64" height="64" alt="Sali" style="display:block;width:64px;height:64px;border-radius:16px"></a></td></tr>
    <tr><td style="background:${C.card};border-radius:24px;padding:28px 24px;box-shadow:0 2px 10px rgba(60,40,10,.06)">
      <h1 style="margin:0 0 8px;font-size:22px;line-height:28px;font-weight:800;color:${C.ink}">${esc(o.title)}</h1>
      ${o.lead ? `<p style="margin:0 0 18px;font-size:15px;line-height:22px;color:${C.mu}">${o.lead}</p>` : ""}
      ${o.block || ""}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="border-radius:999px;background:${C.g}">
        <a href="${esc(o.cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:800;color:#fff;text-decoration:none;border-radius:999px">${esc(o.cta.text)} →</a></td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:18px 16px 0;font-size:12px;line-height:18px;color:${C.mu}">
      ${o.why}<br><a href="${APP}#/subs" style="color:${C.g};font-weight:700">Изменить условия или отписаться</a>
      <div style="padding-top:10px">Sali — меню, корзина и акции 7 сетей Израиля</div>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

// корзина подешевела
export function tplCartDrop(o: { title: string; was: number; now: number; chain: string; url: string; deals?: Deal[] }): Msg {
  const drop = o.was - o.now, pct = Math.round(drop / o.was * 100);
  const block = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.gl};border-radius:18px"><tr><td style="padding:18px 20px">
      <div style="font-size:13px;color:${C.mu}">Было <s>${esc(ils(o.was))}</s></div>
      <div style="font-size:34px;line-height:40px;font-weight:800;color:${C.g}">${esc(ils(o.now))}</div>
      <div style="padding-top:6px">${chainPill(o.chain)} <span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${C.red};color:#fff;font-size:12px;font-weight:800;line-height:16px">−${esc(ils(drop))} · −${pct}%</span></div>
    </td></tr></table>
    ${o.deals?.length ? `<div style="padding:18px 0 4px;font-size:14px;font-weight:800;color:${C.ink}">Что сейчас по акции</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dealRows(o.deals.slice(0, 5))}</table>` : ""}`;
  return {
    title: `Корзина «${o.title}» подешевела на ${ils(drop)}`, body: `Сейчас ${ils(o.now)} в ${chainRu(o.chain)} вместо ${ils(o.was)}`, url: o.url,
    push: { title: `−${ils(drop)} на корзину «${o.title}»`, body: `Сейчас ${ils(o.now)} в ${chainRu(o.chain)} вместо ${ils(o.was)} (−${pct}%). Открыть корзину →`, tag: `cart-${o.url}`, actions: [{ action: "open", title: "Открыть корзину" }] },
    email: { subject: `Корзина «${o.title}» подешевела на ${ils(drop)}`, html: layout({ pre: `Сейчас ${ils(o.now)} в ${chainRu(o.chain)} вместо ${ils(o.was)}`, title: `Корзина подешевела на ${ils(drop)}`, lead: `«${esc(o.title)}» сегодня дешевле всего в ${esc(chainRu(o.chain))}.`, block, cta: { text: "Открыть корзину", url: o.url }, why: `Вы подписались на корзину «${esc(o.title)}».` }) },
  };
}

// акции на товары из корзины (или их аналоги)
export function tplCartDeals(o: { title: string; n: number; deals: Deal[]; url: string }): Msg {
  const names = o.deals.slice(0, 2).map((d) => `${d.name} −${d.pct}%`).join(", ") + (o.deals.length > 2 ? ` и ещё ${o.deals.length - 2}` : "");
  return {
    title: `Акции на ${o.n} ${plural(o.n, "товар", "товара", "товаров")} из корзины «${o.title}»`, body: names, url: o.url,
    push: { title: `Акции на ${o.n} ${plural(o.n, "товар", "товара", "товаров")} из «${o.title}»`, body: names, image: o.deals.find((d) => d.img)?.img, tag: `deals-${o.url}`, actions: [{ action: "open", title: "Смотреть" }] },
    email: { subject: `Акции на ${o.n} ${plural(o.n, "товар", "товара", "товаров")} из корзины «${o.title}»`, html: layout({ pre: names, title: `Акции на ${o.n} ${plural(o.n, "товар", "товара", "товаров")} из вашей корзины`, lead: `В «${esc(o.title)}» сейчас скидки на эти товары или их аналоги:`, block: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dealRows(o.deals.slice(0, 6))}</table>`, cta: { text: "Открыть корзину", url: o.url }, why: `Вы подписались на корзину «${esc(o.title)}».` }) },
  };
}

// акция на товар
export function tplProduct(o: { title: string; deals: Deal[] }): Msg {
  const d = o.deals[0], url = `${APP}#/subs`;
  const where = `${dealPrice(d)} вместо ${ils2(d.old)} в ${chainRu(d.chain)}${d.ends ? ` · до ${dateRu(d.ends)}` : ""}`;
  return {
    title: `Акция на «${o.title}»: −${d.pct}%`, body: where, url,
    push: { title: `−${d.pct}% на «${o.title}»`, body: where + (o.deals.length > 1 ? ` и ещё в ${o.deals.length - 1} ${plural(o.deals.length - 1, "сети", "сетях", "сетях")}` : ""), image: d.img, tag: `prod-${d.barcode}`, actions: [{ action: "open", title: "Смотреть" }] },
    email: { subject: `Акция на «${o.title}»: −${d.pct}%`, html: layout({ pre: where, title: `Акция на «${o.title}»`, lead: o.deals.length > 1 ? `Скидка сразу в ${o.deals.length} ${plural(o.deals.length, "сети", "сетях", "сетях")}:` : "Товар, на который вы подписались, продаётся со скидкой:", block: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dealRows(o.deals.slice(0, 5))}</table>`, cta: { text: "Открыть Sali", url }, why: `Вы подписались на товар «${esc(o.title)}».` }) },
  };
}

// тест: как будет выглядеть уведомление о корзине
export function tplTest(deals: Deal[]): Msg {
  const m = tplCartDrop({ title: "Пример корзины", was: 418, now: 365, chain: "ramilevy", url: `${APP}#/subs`, deals });
  m.email.subject = "Sali: так будут выглядеть уведомления";
  (m.push as Record<string, unknown>).title = "Sali: пример уведомления";
  return m;
}
