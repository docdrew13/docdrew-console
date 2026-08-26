import type { Config } from "@netlify/functions";

// A coarse global lattice used to paint a live "weather systems" layer across the weather globe.
const LATS = [-60, -30, 0, 30, 60];
const LONS = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

interface GridPoint {
  lat: number;
  lon: number;
  cloud: number | null;
  precip: number | null;
  temp: number | null;
  wind: number | null;
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
    // Open-Meteo returns an array (one entry per location) when multiple coordinates are requested.
    const list: any[] = Array.isArray(data) ? data : [data];

    const points: GridPoint[] = list.map((entry: any, i: number) => ({
      lat: lats[i],
      lon: lons[i],
      cloud: typeof entry?.current?.cloud_cover === "number" ? entry.current.cloud_cover : null,
      precip: typeof entry?.current?.precipitation === "number" ? entry.current.precipitation : null,
      temp: typeof entry?.current?.temperature_2m === "number" ? entry.current.temperature_2m : null,
      wind: typeof entry?.current?.wind_speed_10m === "number" ? entry.current.wind_speed_10m : null,
    }));

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
