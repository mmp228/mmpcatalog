import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const ALLOW = { p:1,h1:1,h2:1,h3:1,h4:1,blockquote:1,strong:1,b:1,em:1,i:1,u:1,s:1,ul:1,ol:1,li:1,a:1,img:1,figure:1,figcaption:1,br:1,hr:1,aside:1,mark:1,code:1,pre:1 };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---- Telegraph: официальный API, текст приходит уже структурированным ---- */
function telegraphImgSrc(src) {
  if (!src) return "";
  if (src.startsWith("/")) src = "https://telegra.ph" + src;
  return /^https:\/\//.test(src) ? src : "";
}

function nodeToHtml(n) {
  if (typeof n === "string") return esc(n);
  if (!n || typeof n !== "object") return "";
  const kids = (n.children || []).map(nodeToHtml).join("");
  const tag = String(n.tag || "").toLowerCase();
  if (!ALLOW[tag]) return kids;
  if (tag === "img") {
    const src = telegraphImgSrc((n.attrs || {}).src || "");
    return src ? '<img src="' + src.replace(/"/g, "&quot;") + '" alt="" loading="lazy">' : "";
  }
  if (tag === "a") {
    const h = (n.attrs || {}).href || "";
    return /^https?:\/\//i.test(h)
      ? '<a href="' + h.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener">' + kids + "</a>"
      : kids;
  }
  if (tag === "br" || tag === "hr") return "<" + tag + ">";
  return "<" + tag + ">" + kids + "</" + tag + ">";
}

function firstImgNode(nodes) {
  for (const n of nodes || []) {
    if (n && typeof n === "object") {
      if (String(n.tag).toLowerCase() === "img") {
        const s = telegraphImgSrc((n.attrs || {}).src || "");
        if (s) return s;
      }
      const deeper = firstImgNode(n.children);
      if (deeper) return deeper;
    }
  }
  return "";
}

async function fromTelegraph(url) {
  const path = new URL(url).pathname.replace(/^\//, "").split("/")[0];
  const r = await fetch("https://api.telegra.ph/getPage/" + encodeURIComponent(path) + "?return_content=true");
  const j = await r.json().catch(() => null);
  if (!j || !j.ok || !j.result) return { error: "Telegraph не отдал эту страницу. Проверьте ссылку." };
  const content = j.result.content || [];
  const body = content.map(nodeToHtml).join("");
  return {
    title: String(j.result.title || "").slice(0, 120),
    body,
    image: firstImgNode(content)
  };
}

/* ---- Пост Telegram: берём именно нужный номер поста из публичной веб-версии ---- */
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

function sanitizeHtml(html) {
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

async function fromTgPost(channel, id) {
  const r = await fetch("https://t.me/s/" + channel + "/" + id, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; MMPCatalog/1.0)", accept: "text/html" },
    redirect: "follow"
  });
  const html = (await r.text()).slice(0, 800000);
  const marker = 'data-post="' + channel + "/" + id + '"';
  const i = html.indexOf(marker);
  if (i < 0) return { error: "Пост не найден. Он должен быть публичным, и ссылка должна вести на пост, а не на канал." };
  const rest = html.slice(i + marker.length);
  const next = rest.indexOf('data-post="');
  const block = next > 0 ? rest.slice(0, next) : rest;
  const m = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return { error: "В этом посте нет текста (возможно, только видео)." };
  const parts = sanitizeHtml(m[1]).split(/(?:<br\s*\/?>\s*){2,}/i).map((x) => x.trim()).filter(Boolean);
  const body = parts.map((p) => "<p>" + p + "</p>").join("");
  const title = strip(m[1].replace(/<br\s*\/?>/gi, "\n")).split("\n").map((x) => x.trim()).find(Boolean) || "";
  const img = (block.match(/background-image:url\('([^']+)'\)/i) || [])[1] || "";
  return { title: title.slice(0, 120), body, image: img };
}

export default async (req) => {
  const u = new URL(req.url).searchParams.get("url") || "";
  const tg = u.match(/^https:\/\/t\.me\/([A-Za-z0-9_]{4,})\/(\d+)\/?$/);
  const tele = /^https:\/\/telegra\.ph\/[^\s]+$/.test(u);
  if (!tg && !tele) return json({ error: "Поддерживаются ссылки telegra.ph/... и посты t.me/канал/номер" }, 400);

  const store = getStore({ name: "articles", consistency: "strong" });
  const key = createHash("sha256").update("v2:" + u).digest("hex");
  const cached = await store.get(key, { type: "json" });
  if (cached && cached.body) return json(cached);

  try {
    const res = tg ? await fromTgPost(tg[1], tg[2]) : await fromTelegraph(u);
    if (res.error) return json({ error: res.error }, 404);
    if (!res.body) return json({ error: "Текст не найден по этой ссылке." }, 404);
    res.body = res.body.slice(0, 60000);
    await store.setJSON(key, res);
    return json(res);
  } catch (e) {
    return json({ error: "Не удалось открыть страницу: " + (e && e.message ? e.message : "нет связи") }, 502);
  }
};

export const config = { path: "/api/article" };
