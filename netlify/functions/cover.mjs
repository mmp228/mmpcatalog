import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const ALLOW = /^https:\/\/(vimeo\.com|kinescope\.io|t\.me)\//i;

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" }
  });

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function findImage(html) {
  const pats = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m && /^https?:\/\//i.test(decode(m[1]))) return decode(m[1]);
  }
  return "";
}

export default async (req) => {
  const u = new URL(req.url).searchParams.get("url") || "";
  if (!ALLOW.test(u)) return json({ error: "Этот адрес не поддерживается", image: "" }, 400);

  const store = getStore({ name: "covers", consistency: "strong" });
  const key = createHash("sha256").update(u).digest("hex");
  const cached = await store.get(key, { type: "json" });
  if (cached && cached.image) return json(cached);

  try {
    const r = await fetch(u, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MMPCatalog/1.0)", accept: "text/html" },
      redirect: "follow"
    });
    const html = (await r.text()).slice(0, 400000);
    const image = findImage(html);
    if (image) await store.setJSON(key, { image });
    return json({ image });
  } catch {
    return json({ image: "" });
  }
};

export const config = { path: "/api/cover" };
