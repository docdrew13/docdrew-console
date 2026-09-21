import type { Config } from "@netlify/functions";

// Backs the Travel Planner's "Quick Research" and "Activity Finder" tools at
// POST /api/travel-research. Requires ANTHROPIC_API_KEY (Site settings ->
// Environment variables). If it's missing, this returns a 500 and the
// front-end silently falls back to its manual copy/paste-to-Claude workflow --
// nothing breaks either way.

interface ResearchRequest {
  kind?: string;
  location?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  minDays?: string | number;
  maxDays?: string | number;
  notes?: string;
  lang?: string;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  let body: ResearchRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { kind, location, category, startDate, endDate, minDays, maxDays, notes, lang } = body || {};
  if (!location || !String(location).trim()) {
    return new Response(JSON.stringify({ error: "location is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const dateInfo = startDate && endDate
    ? `${startDate} to ${endDate}`
    : (minDays && maxDays ? `${minDays}-${maxDays} days, flexible dates` : "flexible dates");

  const task = kind === "activity"
    ? "Find 3-5 concrete activity or tour options"
    : "Find 3-5 concrete booking options";

  const isFr = lang === "fr";

  const prompt = `You are a travel research assistant filling in a structured trip-planning form. ${task} for a traveler.
Location: ${location}
Category: ${category || "general"}
Timing: ${dateInfo}
Notes/preferences: ${notes || "none given"}

Respond with ONLY valid JSON (no markdown fences, no commentary before or after) matching exactly this shape:
{"summary": "1-2 sentence overview, including a brief note if prices/availability are time-sensitive and worth confirming closer to booking", "options": [{"title": "short name", "provider": "operator, vendor, airline, or hotel name", "price": "rough price or price range, or empty string if unknown", "dateInfo": "relevant dates or season", "includes": "what's included, or empty string", "notes": "one practical tip, or empty string", "link": "a URL if you're confident of one, otherwise empty string"}]}

Give 3-5 options. Be concrete and specific rather than generic. If you're not confident about exact current prices, say so briefly in the summary rather than inventing numbers.${isFr ? " Respond in French (Canadian French)." : ""}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return new Response(JSON.stringify({ error: "upstream error", detail }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    const data = await resp.json();
    const raw = (data.content && data.content[0] && data.content[0].text) || "";
    const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: "could not parse model output", raw: cleaned.slice(0, 500) }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/travel-research" };
