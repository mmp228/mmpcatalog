import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_CATS = [
  { k: "news", t: "Новости" },
  { k: "clips", t: "Клипы" },
  { k: "vystup", t: "Выступления" },
  { k: "zakadrom", t: "За кадром" }
];
const SEED = [
  { t: "Выпуск 7", cat: "news", u: "https://drive.google.com/file/d/1uMoleuEO3nbqJZcc43FPqtDmtv07bUz7/view?usp=drive_link" },
  { t: "В мире животных", cat: "clips", u: "https://drive.google.com/file/d/1uMoleuEO3nbqJZcc43FPqtDmtv07bUz7/view?usp=drive_link" }
];

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const same = (a, b) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

function cleanCats(list) {
  if (!Array.isArray(list)) throw new Error("Ожидается список категорий");
  if (!list.length) throw new Error("Нужна хотя бы одна категория");
  if (list.length > 50) throw new Error("Слишком много категорий (максимум 50)");
  const seen = new Set();
  return list.map((x, i) => {
    const k = String(x.k ?? "").trim();
    const t = String(x.t ?? "").trim();
    if (!/^[a-z0-9]{1,24}$/.test(k)) throw new Error(`Категория ${i + 1}: некорректный ключ`);
    if (!t) throw new Error(`Категория ${i + 1}: нет названия`);
    if (seen.has(k)) throw new Error(`Категория «${t}» повторяется`);
    seen.add(k);
    return { k, t: t.slice(0, 40) };
  });
}

function cleanItems(list, keys) {
  if (!Array.isArray(list)) throw new Error("Ожидается список видео");
  if (list.length > 1000) throw new Error("Слишком много видео (максимум 1000)");
  return list.map((x, i) => {
    const row = i + 1;
    const t = String(x.t ?? "").trim();
    const u = String(x.u ?? "").trim();
    if (!t) throw new Error(`Видео ${row}: нет названия`);
    if (!/^https?:\/\//i.test(u)) throw new Error(`Видео ${row}: ссылка должна начинаться с http:// или https://`);
    if (!keys.includes(x.cat)) throw new Error(`Видео ${row}: неизвестная категория`);
    return { t: t.slice(0, 120), cat: x.cat, u: u.slice(0, 500) };
  });
}

export default async (req) => {
  const store = getStore({ name: "catalog", consistency: "strong" });

  if (req.method === "GET") {
    const items = (await store.get("items", { type: "json" })) ?? SEED;
    const cats = (await store.get("cats", { type: "json" })) ?? DEFAULT_CATS;
    return json({ items, cats });
  }

  if (req.method === "POST") {
    const pw = Netlify.env.get("ADMIN_PASSWORD");
    if (!pw) return json({ error: "В Netlify не задана переменная ADMIN_PASSWORD" }, 500);
    if (!same(req.headers.get("x-admin-password") || "", pw)) return json({ error: "Неверный пароль" }, 401);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Некорректные данные" }, 400); }
    if (body && body.check) return json({ ok: true });

    try {
      const cats = body.cats !== undefined
        ? cleanCats(body.cats)
        : ((await store.get("cats", { type: "json" })) ?? DEFAULT_CATS);
      const keys = cats.map((c) => c.k);
      const items = cleanItems(
        body.items !== undefined ? body.items : ((await store.get("items", { type: "json" })) ?? SEED),
        keys
      );
      if (body.cats !== undefined) await store.setJSON("cats", cats);
      if (body.items !== undefined) await store.setJSON("items", items);
      return json({ ok: true, items: items.length, cats: cats.length });
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  }

  return json({ error: "Метод не поддерживается" }, 405);
};

export const config = { path: "/api/items" };
