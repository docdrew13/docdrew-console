import type { Config } from "@netlify/functions";

// Backs the Travel Planner's "Copy brief for Claude" button on a fresh (empty)
// trip, at POST /api/trip-brief. Given the same brief text the button copies to
// the clipboard, asks Claude to research the destination and return a full
// day-by-day itinerary plus a starter bookings list as structured JSON, which
// the front-end writes into the trip. Requires ANTHROPIC_API_KEY (Site settings
// -> Environment variables); if missing, returns a 500 and the front-end falls
// back to the existing copy-to-clipboard / paste-to-Claude-in-chat workflow.

interface TripBriefRequest {
  brief?: string;
  destination?: string;
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

  let body: TripBriefRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { brief, destination, lang } = body || {};
  if (!brief || !String(brief).trim()) {
    return new Response(JSON.stringify({ error: "brief is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const isFr = lang === "fr";

  const prompt = `You are a travel research assistant. A traveler filled out a trip-planning form; here is the brief they'd normally hand to a human travel planner:

---
${brief}
---

Research ${destination || "this destination"} and build a complete, realistic day-by-day itinerary matching their preferences, plus a starter list of things they'll need to book. Use real, specific, well-known places, neighborhoods, and operators rather than generic filler. If you're not confident about an exact current price, give a reasonable estimate and don't invent a false level of precision.

Respond with ONLY valid JSON (no markdown fences, no commentary before or after) matching exactly this shape:
{
  "days": [
    {
      "label": "short day label, e.g. 'Day 1' or 'Arrival'",
      "date": "",
      "activities": [
        {"time": "e.g. '9:00 AM', or empty string", "title": "short activity name", "location": "neighborhood, venue, or address", "notes": "one practical detail", "estCost": "a number in USD, or empty string if free/unknown"}
      ]
    }
  ],
  "bookings": [
    {"type": "flight|hotel|car|train|cruise|activity|other", "title": "short name", "provider": "airline, hotel chain, or operator", "estCost": "a number in USD, or empty string", "notes": "one practical detail, e.g. why this option or what to confirm"}
  ],
  "notes": "2-3 sentences of overall trip guidance -- best time to book, weather/packing notes, or anything that doesn't fit elsewhere"
}

Give one "days" entry per day of the trip (infer trip length from the dates/flexible-length given; if genuinely unclear, use 5 days as a reasonable default; cap at 6 days even for longer trips -- the traveler can add more manually), each with 2-3 activities. Give 3-5 starter bookings covering the major pieces (flights, lodging, and anything else clearly implied by the transportation/accommodation preferences). Leave "date" empty on each day -- the traveler will assign real dates. Keep every field concise -- this needs to generate quickly.${isFr ? " Respond in French (Canadian French)." : ""}`;

  try {
    // Netlify's default synchronous function timeout is ~10s, and a full
    // multi-day itinerary from a larger model can run right up against that.
    // Haiku is used here specifically for latency -- it's fast enough to
    // reliably finish before the platform times the request out, at some
    // cost to nuance versus the model used for the shorter research answers.
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        thinking: { type: "disabled" },
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

    if (data && data.type === "error") {
      return new Response(JSON.stringify({ error: "anthropic api error", detail: data.error }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    const textBlock = Array.isArray(data.content) ? data.content.find((b: any) => b && b.type === "text") : null;
    const raw = (textBlock && textBlock.text) || "";
    const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: "could not parse model output", raw: cleaned.slice(0, 800) }), {
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

export const config: Config = { path: "/api/trip-brief" };
