import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const newId = () => {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 7; i++) s += (b[i] % 36).toString(36);
  return s;
};

export default async (req) => {
  const store = getStore({ name: "shares", consistency: "strong" });

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!/^[a-z0-9]{7}$/.test(id)) return json({ error: "Некорректная ссылка" }, 400);
    const data = await store.get(id, { type: "json" });
    if (!data) return json({ error: "Список не найден" }, 404);
    return json(data);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Некорректные данные" }, 400); }
    const name = String(body.name ?? "Список").trim().slice(0, 40) || "Список";
    const h = Array.isArray(body.h) ? body.h.map(String).filter((x) => /^[a-z0-9]{1,12}$/.test(x)).slice(0, 500) : [];
    if (!h.length) return json({ error: "В списке нет видео" }, 400);
    let id = newId();
    for (let i = 0; i < 3 && (await store.get(id)); i++) id = newId();
    await store.setJSON(id, { name, h });
    return json({ id });
  }

  return json({ error: "Метод не поддерживается" }, 405);
};

export const config = { path: "/api/share" };
