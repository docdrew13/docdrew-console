import type { Config } from "@netlify/functions";

/* Backs the Travel Planner's "Around Me" tool at POST /api/around-me.
   Free, no API key: forward/reverse geocoding via OpenStreetMap Nominatim,
   nearby places via OpenStreetMap Overpass. A place is flagged "notable" when
   it carries a wikidata/wikipedia tag in OSM (a reasonable proxy for "well-known
   enough to have an encyclopedia entry"), and notable places always sort first
   within their category. Nothing here is saved -- it's a live, on-demand lookup. */

interface AroundMeRequest {
  lat?: number;
  lon?: number;
  query?: string;
  radius?: number;
  lang?: string;
}

interface Place {
  name: string;
  address: string;
  distanceM: number;
  notable: boolean;
  lat: number;
  lon: number;
}

const UA = "docdrew-travel-planner/1.0 (personal travel app; contact via Netlify site owner)";

const CATEGORY_FILTERS: Record<string, string[]> = {
  cafes: ['node["amenity"="cafe"]', 'way["amenity"="cafe"]'],
  restaurants: ['node["amenity"="restaurant"]', 'way["amenity"="restaurant"]'],
  shops: ['node["shop"]', 'way["shop"]'],
  galleries: ['node["tourism"="gallery"]', 'way["tourism"="gallery"]', 'node["shop"="art"]', 'way["shop"="art"]'],
  museums: ['node["tourism"="museum"]', 'way["tourism"="museum"]'],
  landmarks: [
    'node["tourism"="attraction"]', 'way["tourism"="attraction"]',
    'node["historic"]', 'way["historic"]',
    'node["tourism"="viewpoint"]', 'node["tourism"="artwork"]',
  ],
};

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeQuery(q: string, lang: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=${lang === "fr" ? "fr" : "en"}&q=${encodeURIComponent(q)}`;
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error("geocode failed");
  const data = (await resp.json()) as any[];
  if (!Array.isArray(data) || !data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
}

async function reverseGeocode(lat: number, lon: number, lang: string): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&accept-language=${lang === "fr" ? "fr" : "en"}`;
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) return "";
  const data: any = await resp.json();
  const a = data.address || {};
  const parts = [
    a.suburb || a.neighbourhood || a.quarter || a.city_district,
    a.city || a.town || a.village,
    a.country,
  ].filter(Boolean);
  return parts.join(", ") || data.display_name || "";
}

async function queryOverpass(lat: number, lon: number, radius: number): Promise<any> {
  const clauses: string[] = [];
  for (const filters of Object.values(CATEGORY_FILTERS)) {
    for (const f of filters) {
      clauses.push(`${f}(around:${radius},${lat},${lon});`);
    }
  }
  const ql = `[out:json][timeout:20];(${clauses.join("")});out center tags;`;
  const mirrors = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let lastErr: unknown;
  for (const base of mirrors) {
    try {
      const resp = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: "data=" + encodeURIComponent(ql),
      });
      if (!resp.ok) {
        lastErr = new Error("overpass " + resp.status);
        continue;
      }
      return await resp.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("overpass failed");
}

function categorize(tags: Record<string, string>): string | null {
  if (tags.amenity === "cafe") return "cafes";
  if (tags.amenity === "restaurant") return "restaurants";
  if (tags.tourism === "museum") return "museums";
  if (tags.tourism === "gallery" || tags.shop === "art") return "galleries";
  if (tags.historic || tags.tourism === "attraction" || tags.tourism === "viewpoint" || tags.tourism === "artwork") return "landmarks";
  if (tags.shop) return "shops";
  return null;
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: AroundMeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const lang = body.lang === "fr" ? "fr" : "en";
  const radius = Math.min(Math.max(Number(body.radius) || 1200, 200), 3000);

  let lat = typeof body.lat === "number" ? body.lat : undefined;
  let lon = typeof body.lon === "number" ? body.lon : undefined;
  let label = "";

  try {
    if ((lat === undefined || lon === undefined) && body.query) {
      const g = await geocodeQuery(body.query, lang);
      if (!g) return jsonResponse({ error: "place not found" }, 404);
      lat = g.lat;
      lon = g.lon;
      label = g.label;
    }
    if (lat === undefined || lon === undefined) {
      return jsonResponse({ error: "lat/lon or query required" }, 400);
    }

    if (!label) label = await reverseGeocode(lat, lon, lang);

    const osm = await queryOverpass(lat, lon, radius);
    const elements: any[] = Array.isArray(osm?.elements) ? osm.elements : [];

    const categories: Record<string, Place[]> = {
      cafes: [], restaurants: [], shops: [], galleries: [], museums: [], landmarks: [],
    };
    const seen = new Set<string>();

    for (const el of elements) {
      const tags = el.tags || {};
      const name: string | undefined = tags.name;
      if (!name) continue;
      const cat = categorize(tags);
      if (!cat) continue;
      const elat: number | undefined = el.lat ?? el.center?.lat;
      const elon: number | undefined = el.lon ?? el.center?.lon;
      if (elat == null || elon == null) continue;
      const key = `${cat}|${name}|${elat.toFixed(4)},${elon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const addrParts = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
      categories[cat].push({
        name,
        address: addrParts || tags["addr:city"] || "",
        distanceM: Math.round(haversineM(lat, lon, elat, elon)),
        notable: !!(tags.wikidata || tags.wikipedia),
        lat: elat,
        lon: elon,
      });
    }

    for (const cat of Object.keys(categories)) {
      categories[cat].sort((a, b) => Number(b.notable) - Number(a.notable) || a.distanceM - b.distanceM);
      categories[cat] = categories[cat].slice(0, 10);
    }

    return jsonResponse({ label, lat, lon, radius, categories });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 502);
  }
};

export const config: Config = { path: "/api/around-me" };
