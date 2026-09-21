import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Tiny generic sync endpoint for small personal lists (Tasks / Notes / Groceries) so the
// same list shows up whether an item is added from the computer or the phone. The client
// owns the data shape entirely (id/text/done for Tasks, id/text/ts for Notes, id/text/
// category for Groceries) -- this endpoint just stores and returns whatever array it's
// given, scoped by collection + owner. No auth: this mirrors the console's existing model
// (each list already lived in the visiting browser's own localStorage, unauthenticated) --
// centralizing it doesn't lower that trust boundary, since anyone who could already open
// the page could already see/edit the data client-side.
const COLLECTIONS = new Set(["todos", "log", "groceries"]);
const OWNERS = new Set(["main", "peter", "susie"]);
const MAX_ITEMS = 500;
const MAX_BODY_BYTES = 256 * 1024;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const collection = url.searchParams.get("collection") || "";
  const owner = url.searchParams.get("owner") || "main";

  if (!COLLECTIONS.has(collection)) {
    return jsonResponse({ error: "invalid_collection" }, 400);
  }
  if (!OWNERS.has(owner)) {
    return jsonResponse({ error: "invalid_owner" }, 400);
  }

  const store = getStore("console-sync");
  const key = collection + ":" + owner;

  if (req.method === "GET") {
    try {
      const data = await store.get(key, { type: "json" });
      return jsonResponse(Array.isArray(data) ? data : []);
    } catch (err) {
      return jsonResponse({ error: "read_failed", message: String(err) }, 502);
    }
  }

  if (req.method === "PUT") {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    if (!Array.isArray(body)) {
      return jsonResponse({ error: "expected_array" }, 400);
    }
    const cleaned = body.slice(0, MAX_ITEMS).filter((it) => it && typeof it === "object");
    try {
      await store.setJSON(key, cleaned);
      return jsonResponse(cleaned);
    } catch (err) {
      return jsonResponse({ error: "write_failed", message: String(err) }, 502);
    }
  }

  return new Response("Method not allowed", { status: 405, headers: { allow: "GET, PUT" } });
};

export const config: Config = { path: "/api/sync" };
