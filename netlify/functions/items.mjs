import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const CATS = ["news", "clips", "vystup", "zakadrom"];
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

function clean(list) {
  if (!Array.isArray(list)) throw new Error("Ожидается список");
  if (list.length > 500) throw new Error("Слишком много записей (максимум 500)");
  return list.map((x, i) => {
    const row = i + 1;
    const t = String(x.t ?? "").trim();
    const u = String(x.u ?? "").trim();
    if (!t) throw new Error(`Строка ${row}: нет названия`);
    if (!/^https?:\/\//i.test(u)) throw new Error(`Строка ${row}: ссылка должна начинаться с http:// или https://`);
    if (!CATS.includes(x.cat)) throw new Error(`Строка ${row}: неизвестный раздел`);
    return {
      t: t.slice(0, 120),
      cat: x.cat,
      u: u.slice(0, 500)
    };
  });
}

export default async (req) => {
  const store = getStore({ name: "catalog", consistency: "strong" });

  if (req.method === "GET") {
    const data = await store.get("items", { type: "json" });
    return json(data ?? SEED);
  }

  if (req.method === "POST") {
    const pw = Netlify.env.get("ADMIN_PASSWORD");
    if (!pw) return json({ error: "В Netlify не задана переменная ADMIN_PASSWORD" }, 500);
    if (!same(req.headers.get("x-admin-password") || "", pw)) return json({ error: "Неверный пароль" }, 401);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Некорректные данные" }, 400); }
    if (body && body.check) return json({ ok: true });

    try {
      const items = clean(body.items);
      await store.setJSON("items", items);
      return json({ ok: true, count: items.length });
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  }

  return json({ error: "Метод не поддерживается" }, 405);
};

export const config = { path: "/api/items" };
