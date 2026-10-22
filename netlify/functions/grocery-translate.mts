import type { Config } from "@netlify/functions";

// Backs the joint Andrew/Sylvain Grocery list at POST /api/grocery-translate.
// Given [{id, text}] it returns [{id, en, fr}]: the same item in English and in
// Canadian French, whichever language it was typed in. Items typed in English stay
// exactly as typed on the English page; the French page shows the "fr" field.
// Uses one small, tool-less Haiku call (a fraction of a cent per item added).
// Requires ANTHROPIC_API_KEY (already set for the travel functions). If it is missing
// or the call fails, the client simply keeps showing the item as it was typed.

const MAX_ITEMS = 40;
const MAX_TEXT = 120;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const items = (Array.isArray(body && body.items) ? body.items : [])
    .filter((it: any) => it && typeof it.id === "string" && typeof it.text === "string" && it.text.trim())
    .slice(0, MAX_ITEMS)
    .map((it: any) => ({ id: it.id.slice(0, 40), text: it.text.trim().slice(0, MAX_TEXT) }));
  if (items.length === 0) return json([]);

  const prompt = `These are grocery-list items from a shared family list. Each was typed in either English or French. For every item give both versions: "en" (English) and "fr" (Canadian French, as used in Quebec grocery stores, e.g. "bacon" stays "bacon", "chips" -> "croustilles", "zucchini" -> "courgettes"). If an item is already in one language, keep that version exactly as typed (only trim whitespace) and translate it for the other. Keep quantities and brand names. Keep each version short, the way someone would write it on a shopping list.

Respond with ONLY a JSON array, no markdown and no commentary, in the same order as the input, like:
[{"id":"...","en":"...","fr":"..."}]

Items:
${JSON.stringify(items)}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) return json({ error: "upstream error" }, 502);

    const data = await resp.json();
    const textBlock = Array.isArray(data.content) ? data.content.find((b: any) => b && b.type === "text") : null;
    const cleaned = ((textBlock && textBlock.text) || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: "could not parse model output" }, 502);
    }
    if (!Array.isArray(parsed)) return json({ error: "unexpected model output" }, 502);

    // Only hand back ids we asked about, with string fields, so a bad model reply can't inject anything odd.
    const wanted = new Set(items.map((i: any) => i.id));
    const out = parsed
      .filter((r: any) => r && wanted.has(r.id) && typeof r.en === "string" && typeof r.fr === "string" && r.en.trim() && r.fr.trim())
      .map((r: any) => ({ id: r.id, en: r.en.trim().slice(0, MAX_TEXT), fr: r.fr.trim().slice(0, MAX_TEXT) }));
    return json(out);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

export const config: Config = { path: "/api/grocery-translate" };
