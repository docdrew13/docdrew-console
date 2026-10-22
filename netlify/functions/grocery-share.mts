import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Share links for the Grocery list. POST /api/grocery-share stores a snapshot of the
// list as the sender saw it (already in the sender's language, grouped by aisle) and
// returns a short unguessable id; GET /api/grocery-share?id=... returns it. The public
// page at /l/<id> (rewritten to /list/?id=<id>) renders it as a tidy checkbox list.
// Like the rest of the console there is no login: a link works for whoever has it.
// Snapshots are small and capped, and old ones are simply left in the blob store.

const MAX_GROUPS = 20;
const MAX_ITEMS = 300;
const MAX_BODY_BYTES = 64 * 1024;
const ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes (l, 1, o, 0)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export default async (req: Request) => {
  const store = getStore("grocery-shares");

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!/^[a-z0-9]{6,20}$/.test(id)) return json({ error: "invalid_id" }, 400);
    try {
      const data = await store.get("share:" + id, { type: "json" });
      if (!data) return json({ error: "not_found" }, 404);
      return json(data);
    } catch (err) {
      return json({ error: "read_failed", message: String(err) }, 502);
    }
  }

  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    let count = 0;
    const groups = (Array.isArray(body && body.groups) ? body.groups : [])
      .slice(0, MAX_GROUPS)
      .map((g: any) => {
        const items = (Array.isArray(g && g.items) ? g.items : [])
          .map((it: any) => str(it, 120))
          .filter(Boolean)
          .slice(0, Math.max(0, MAX_ITEMS - count));
        count += items.length;
        return { label: str(g && g.label, 60), items };
      })
      .filter((g: any) => g.items.length > 0);
    if (groups.length === 0) return json({ error: "empty_list" }, 400);

    const snapshot = {
      lang: body.lang === "fr" ? "fr" : "en",
      title: str(body.title, 60),
      from: str(body.from, 40),
      created: new Date().toISOString(),
      groups,
    };
    try {
      const id = newId();
      await store.setJSON("share:" + id, snapshot);
      return json({ id });
    } catch (err) {
      return json({ error: "write_failed", message: String(err) }, 502);
    }
  }

  return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
};

export const config: Config = { path: "/api/grocery-share" };
