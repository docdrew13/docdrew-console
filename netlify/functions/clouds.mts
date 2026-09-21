import type { Config } from "@netlify/functions";

// Proxies OpenWeatherMap's free "clouds_new" tile layer for the weather globe's real-time
// cloud overlay (added 2026-09-21, per Andrew's request for globally-visible real-time clouds,
// independent of day/night). Proxied through a function rather than hit directly from the
// client so the API key never appears in the four HTML pages' page source — this endpoint is
// public and unauthenticated, same trust boundary as every other /api/* function here, but the
// upstream key stays server-side.
//
// Requires OPENWEATHERMAP_API_KEY (Site settings -> Environment variables, scope: Functions) —
// see docdrew-console-setup-history.md for how/when it was set up.
//
// GET /api/clouds?z=<zoom>&x=<tile x>&y=<tile y> — standard Web Mercator XYZ tile coordinates,
// same scheme sampleRadar()/renderRadarLayer() already use for the RainViewer radar layer.
export default async (req: Request) => {
  const url = new URL(req.url);
  const z = url.searchParams.get("z") || "";
  const x = url.searchParams.get("x") || "";
  const y = url.searchParams.get("y") || "";
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,4}$/.test(x) || !/^\d{1,4}$/.test(y)) {
    return new Response("bad tile coordinates", { status: 400 });
  }

  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENWEATHERMAP_API_KEY not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const upstream = await fetch(
      `https://tile.openweathermap.org/map/clouds_new/${z}/${x}/${y}.png?appid=${apiKey}`
    );
    if (!upstream.ok) {
      return new Response("upstream tile fetch failed: " + upstream.status, { status: 502 });
    }
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      headers: {
        "content-type": upstream.headers.get("content-type") || "image/png",
        // OpenWeatherMap's own cloud composite refreshes roughly hourly; cache a good bit
        // shorter than that so the globe doesn't lag too far behind a real refresh.
        "cache-control": "public, max-age=900",
      },
    });
  } catch (err) {
    return new Response("fetch_failed: " + String(err), { status: 502 });
  }
};

export const config: Config = { path: "/api/clouds" };
