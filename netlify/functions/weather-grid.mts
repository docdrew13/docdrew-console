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
//
// Open-Meteo's docs don't publish a hard cap on locations-per-request, but a single request
// with ~990 comma-separated coordinates risks a very long URL and a single point of failure.
// Instead the lattice is split into batches fired in parallel with Promise.all — keeps each
// request URL a reasonable size, keeps total latency close to one batch's round trip instead
// of the sum of all of them, and means one failed batch degrades the grid instead of blanking
// it entirely.
const LATS = [-84, -76, -68, -60, -52, -44, -36, -28, -20, -12, -4, 4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84];
const LONS = [
  -180, -172, -164, -156, -148, -140, -132, -124, -116, -108, -100, -92, -84, -76, -68, -60, -52, -44, -36, -28, -20,
  -12, -4, 4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116, 124, 132, 140, 148, 156, 164, 172,
];
const BATCH_SIZE = 250;

interface GridPoint {
  lat: number;
  lon: number;
  cloud: number | null;
  precip: number | null;
  temp: number | null;
  wind: number | null;
}

async function fetchBatch(lats: number[], lons: number[]): Promise<GridPoint[]> {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=" +
    lats.join(",") +
    "&longitude=" +
    lons.join(",") +
    "&current=cloud_cover,precipitation,temperature_2m,wind_speed_10m&timezone=UTC";

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("upstream status " + res.status);
    const data = await res.json();
    // Open-Meteo returns an array (one entry per location) when multiple coordinates are requested,
    // but collapses to a single object when a batch happens to contain exactly one point.
    const list: any[] = Array.isArray(data) ? data : [data];

    return list.map((entry: any, i: number) => ({
      lat: lats[i],
      lon: lons[i],
      cloud: typeof entry?.current?.cloud_cover === "number" ? entry.current.cloud_cover : null,
      precip: typeof entry?.current?.precipitation === "number" ? entry.current.precipitation : null,
      temp: typeof entry?.current?.temperature_2m === "number" ? entry.current.temperature_2m : null,
      wind: typeof entry?.current?.wind_speed_10m === "number" ? entry.current.wind_speed_10m : null,
    }));
  } catch {
    // one bad batch shouldn't blank the whole globe — just drop that slice of the lattice.
    return [];
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

  const batches: Promise<GridPoint[]>[] = [];
  for (let i = 0; i < lats.length; i += BATCH_SIZE) {
    batches.push(fetchBatch(lats.slice(i, i + BATCH_SIZE), lons.slice(i, i + BATCH_SIZE)));
  }

  try {
    const results = await Promise.all(batches);
    const points: GridPoint[] = results.flat();

    if (points.length === 0) throw new Error("all_batches_failed");

    return new Response(JSON.stringify({ points, updated: new Date().toISOString() }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/weather-grid" };
