import type { Config } from "@netlify/functions";

// A global lattice used to paint a live "weather systems" layer across the weather globe.
// Precipitation is highly localized and intermittent — even the previous 9x18 (162-point,
// 20°-spacing) grid very often landed zero rainy cells while it was actively raining
// somewhere on Earth, since most real storms (tens to a few hundred km wide) are smaller
// than the ~2,200km gap between 20°-spaced sample points and simply fall between them.
// No amount of client-side interpolation can recover data that was never sampled — the fix
// has to be a denser real grid. 8° spacing (22 x 45 = 990 points) cuts the average gap
// between sample points roughly in half again versus the old grid, so far more storms have
// at least one real sample point inside their footprint.
const LATS = [-84, -76, -68, -60, -52, -44, -36, -28, -20, -12, -4, 4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84];
const LONS = [
  -180, -172, -164, -156, -148, -140, -132, -124, -116, -108, -100, -92, -84, -76, -68, -60, -52, -44, -36, -28, -20,
  -12, -4, 4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116, 124, 132, 140, 148, 156, 164, 172,
];

interface GridPoint {
  lat: number;
  lon: number;
  cloud: number | null;
  precip: number | null;
  temp: number | null;
  wind: number | null;
}

// Diagnosed 2026-09-01: the grid used to be split into 4 parallel Open-Meteo requests (one per
// ~250-point batch), reasoning that a single ~990-coordinate URL risked being "too long" and that
// batching isolated one bad batch from blanking the whole grid. In practice Open-Meteo's free tier
// enforces a *per-minute request-count* limit ("Minutely API request limit exceeded"), and Netlify
// functions run on IPs shared with many other sites also calling Open-Meteo — so firing 4 requests
// per page load (instead of 1) was needlessly quadrupling our own contribution to that shared cap,
// which is what was actually causing the intermittent "weather unavailable" 502s. Open-Meteo counts
// a request as one call no matter how many locations it carries, and an ~8KB URL is comfortably
// inside what both Node's fetch and Open-Meteo's edge accept — so all 990 points now go out as a
// single request. This alone cuts our per-load request volume 4x.
//
// Belt-and-suspenders: even a single request can still occasionally land on a 429 if other tenants
// on the same shared IP are hammering Open-Meteo at that moment. Rather than let that show up to
// Andrew as "weather unavailable", the last successful grid is kept in memory (per warm function
// instance) and served — marked stale — if a fresh fetch fails. Combined with the 10-minute CDN
// cache below, this means a real user only ever sees a hard failure if the very first invocation of
// a cold function instance also happens to hit a 429, which is rare.
const FETCH_TIMEOUT_MS = 9000;

let lastGood: { points: GridPoint[]; updated: string } | null = null;

async function fetchGrid(lats: number[], lons: number[]): Promise<{ points: GridPoint[]; error: string | null }> {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=" +
    lats.join(",") +
    "&longitude=" +
    lons.join(",") +
    "&current=cloud_cover,precipitation,temperature_2m,wind_speed_10m&timezone=UTC";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // Open-Meteo returns a JSON body with a human-readable "reason" on 4xx/5xx (e.g. bad
      // parameter, too many locations, rate limit) — surface that instead of just the bare status
      // code, since "upstream status 429" alone doesn't say WHY the request was rejected.
      let reason = "";
      try {
        const errBody: any = await res.json();
        reason = errBody?.reason || "";
      } catch {
        /* body wasn't JSON — fall through with just the status */
      }
      throw new Error("upstream status " + res.status + (reason ? ": " + reason : ""));
    }
    const data = await res.json();
    // Open-Meteo returns an array (one entry per location) when multiple coordinates are requested,
    // but collapses to a single object when the request happens to contain exactly one point.
    const list: any[] = Array.isArray(data) ? data : [data];

    const points = list.map((entry: any, i: number) => ({
      lat: lats[i],
      lon: lons[i],
      cloud: typeof entry?.current?.cloud_cover === "number" ? entry.current.cloud_cover : null,
      precip: typeof entry?.current?.precipitation === "number" ? entry.current.precipitation : null,
      temp: typeof entry?.current?.temperature_2m === "number" ? entry.current.temperature_2m : null,
      wind: typeof entry?.current?.wind_speed_10m === "number" ? entry.current.wind_speed_10m : null,
    }));
    return { points, error: null };
  } catch (err) {
    const reason = (err as any)?.name === "AbortError" ? "timed out after " + FETCH_TIMEOUT_MS + "ms" : String(err);
    return { points: [], error: reason };
  } finally {
    clearTimeout(timer);
  }
}

export default async (req: Request) => {
  const lats: number[] = [];
  const lons: number[] = [];
  for (const la of LATS) {
    for (const lo of LONS) {
      lats.push(la);
      lons.push(lo);
    }
  }

  const { points, error } = await fetchGrid(lats, lons);

  if (points.length > 0) {
    const updated = new Date().toISOString();
    lastGood = { points, updated };
    return new Response(JSON.stringify({ points, updated }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
    });
  }

  // Fresh fetch failed — fall back to the last successful grid (if this warm instance has one)
  // rather than showing "unavailable" over a single transient rate-limit hit.
  if (lastGood) {
    return new Response(JSON.stringify({ points: lastGood.points, updated: lastGood.updated, stale: true, staleReason: error }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    });
  }

  return new Response(JSON.stringify({ error: "fetch_failed", message: error }), {
    status: 502,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = { path: "/api/weather-grid" };
