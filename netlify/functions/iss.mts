import type { Config } from "@netlify/functions";

// Free, completely keyless ISS live-position feed. wheretheiss.at throttles
// to roughly 1 request/sec per client, which is generous enough for a short
// polling interval (the ISS moves ~7.66 km/s, so a stale reading goes stale fast).

export default async (req: Request) => {
  try {
    const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)" },
    });
    if (!res.ok) throw new Error("upstream status " + res.status);
    const data = await res.json();

    return new Response(
      JSON.stringify({
        lat: data.latitude,
        lon: data.longitude,
        altitudeKm: data.altitude,
        velocityKmh: data.velocity,
        visibility: data.visibility,
        timestamp: data.timestamp,
        updated: new Date().toISOString(),
      }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=5" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/iss" };
