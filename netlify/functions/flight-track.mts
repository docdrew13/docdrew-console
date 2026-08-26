import type { Config } from "@netlify/functions";

// Real recent flown path for one aircraft, via the OpenSky Network's free,
// keyless /tracks/all endpoint. This is genuinely flown history (typically
// the last ~30 minutes), NOT a scheduled route — OpenSky's free anonymous
// tier has no departure/arrival airport or flight-plan data at all; that
// requires their paid /flights endpoints. Anonymous access shares the same
// 400-credits/day budget as the states/all lookup in flights.mts, so this
// is only ever called on-demand (once per tracked flight), never polled.

interface TrackPoint {
  lat: number;
  lon: number;
}

const MAX_POINTS = 200;

export default async (req: Request) => {
  const url = new URL(req.url);
  const icao24 = (url.searchParams.get("icao24") || "").trim().toLowerCase();

  if (!icao24 || !/^[0-9a-f]{1,6}$/.test(icao24)) {
    return new Response(JSON.stringify({ error: "missing_or_invalid_icao24" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch(
      "https://opensky-network.org/api/tracks/all?icao24=" + encodeURIComponent(icao24) + "&time=0",
      { headers: { "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)" } }
    );
    if (!res.ok) throw new Error("upstream status " + res.status);
    const data = await res.json();

    const rawPath: any[] = Array.isArray(data?.path) ? data.path : [];
    let points: TrackPoint[] = [];
    for (const wp of rawPath) {
      const lat = wp?.[1];
      const lon = wp?.[2];
      if (typeof lat === "number" && typeof lon === "number") points.push({ lat, lon });
    }
    // downsample evenly if the track is long, so the payload and the globe
    // rendering both stay light — a dotted trail doesn't need every sample
    if (points.length > MAX_POINTS) {
      const step = points.length / MAX_POINTS;
      const sampled: TrackPoint[] = [];
      for (let i = 0; i < MAX_POINTS; i++) sampled.push(points[Math.floor(i * step)]);
      sampled.push(points[points.length - 1]);
      points = sampled;
    }

    return new Response(
      JSON.stringify({
        icao24,
        callsign: (data?.callsign || "").trim(),
        path: points,
        updated: new Date().toISOString(),
      }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/flight-track" };
