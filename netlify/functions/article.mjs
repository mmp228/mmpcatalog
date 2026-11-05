import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600" }
  });

const ALLOW = { p:1,h1:1,h2:1,h3:1,h4:1,blockquote:1,strong:1,b:1,em:1,i:1,u:1,s:1,ul:1,ol:1,li:1,a:1,img:1,figure:1,figcaption:1,br:1,hr:1,aside:1,mark:1,code:1,pre:1 };

function sanitize(html) {
  html = String(html || "")
    .replace(/<(script|style|iframe|object|embed|video|audio|form|input|button|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|style|iframe|object|embed|video|audio|form|input|button|svg|noscript)\b[^>]*>/gi, "");
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!ALLOW[tag]) return "";
    if (m.charAt(1) === "/") return "</" + tag + ">";
    if (tag === "a") {
      const h = (attrs.match(/href\s*=\s*"([^"]*)"/i) || [])[1] || "";
      return /^https?:\/\//i.test(h) ? '<a href="' + h.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener">' : "";
    }
    if (tag === "img") {
      const s = (attrs.match(/src\s*=\s*"([^"]*)"/i) || [])[1] || "";
      return /^https:\/\//i.test(s) ? '<img src="' + s.replace(/"/g, "&quot;") + '" alt="" loading="lazy">' : "";
    }
    return "<" + tag + ">";
  });
}

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
const firstImg = (html) => (html.match(/<img[^>]+src="(https:\/\/[^"]+)"/i) || [])[1] || "";

function fromTelegraph(html) {
  const i = html.indexOf("_tl_editor");
  if (i < 0) return null;
  const a = html.indexOf("<article", i);
  const b = html.indexOf("</article>", a);
  if (a < 0 || b < 0) return null;
  let inner = html.slice(a, b).replace(/^<article[^>]*>/i, "");
  const title = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
  inner = inner.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "");
  return { title: title.slice(0, 120), body: sanitize(inner), image: firstImg(inner) };
}

function fromTgPost(html) {
  const m = html.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const parts = sanitize(m[1]).split(/(?:<br\s*\/?>\s*){2,}/i).map((x) => x.trim()).filter(Boolean);
  const body = parts.map((p) => "<p>" + p + "</p>").join("");
  const title = strip(m[1].replace(/<br\s*\/?>/gi, "\n")).split("\n").map((x) => x.trim()).find(Boolean) || "";
  const img = (html.match(/tgme_widget_message_photo_wrap[^>]*style="[^"]*background-image:url\('([^']+)'\)/i) || [])[1] || "";
  return { title: title.slice(0, 120), body, image: img };
}

export default async (req) => {
  const u = new URL(req.url).searchParams.get("url") || "";
  const tg = u.match(/^https:\/\/t\.me\/([A-Za-z0-9_]{4,}\/\d+)$/);
  const tele = /^https:\/\/telegra\.ph\/[^\s]+$/.test(u);
  if (!tg && !tele) return json({ error: "Поддерживаются только ссылки telegra.ph и публичные посты t.me" }, 400);

  const store = getStore({ name: "articles", consistency: "strong" });
  const key = createHash("sha256").update(u).digest("hex");
  const cached = await store.get(key, { type: "json" });
  if (cached && cached.body) return json(cached);

  try {
    const r = await fetch(tg ? "https://t.me/s/" + tg[1] : u, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MMPCatalog/1.0)", accept: "text/html" },
      redirect: "follow"
    });
    const html = (await r.text()).slice(0, 600000);
    const res = tg ? fromTgPost(html) : fromTelegraph(html);
    if (!res || !res.body) return json({ error: "Не удалось найти текст статьи по этой ссылке" }, 404);
    res.body = res.body.slice(0, 60000);
    await store.setJSON(key, res);
    return json(res);
  } catch {
    return json({ error: "Страница не открылась" }, 502);
  }
};

export const config = { path: "/api/article" };
