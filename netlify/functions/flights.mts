import type { Config } from "@netlify/functions";

// Live position search via the OpenSky Network's free, keyless anonymous API.
// Anonymous access is capped at 400 credits/day and has no server-side callsign
// filter, so we fetch the full worldwide state-vector snapshot once per request
// and filter client-side (server-side here, but "our" side of the fetch) by
// callsign. This ONLY reflects aircraft that are currently airborne/reporting —
// there is no schedule, route, date, or gate/delay data available from this feed.

interface FlightResult {
  icao24: string;
  callsign: string;
  originCountry: string;
  lon: number | null;
  lat: number | null;
  altitudeM: number | null;
  onGround: boolean;
  velocityMs: number | null;
  headingDeg: number | null;
  verticalRateMs: number | null;
}

const MAX_RESULTS = 15;

function mapState(state: any[]): FlightResult {
  return {
    icao24: state[0],
    callsign: (state[1] || "").trim(),
    originCountry: state[2],
    lon: state[5],
    lat: state[6],
    altitudeM: state[7] != null ? state[7] : state[13],
    onGround: !!state[8],
    velocityMs: state[9],
    headingDeg: state[10],
    verticalRateMs: state[11],
  };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "airline" ? "airline" : "flight";
  const rawQuery = (url.searchParams.get("query") || "").trim().toUpperCase();

  if (!rawQuery) {
    return new Response(JSON.stringify({ error: "missing_query" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch("https://opensky-network.org/api/states/all", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)" },
    });
    if (!res.ok) throw new Error("upstream status " + res.status);
    const data = await res.json();
    const states: any[] = Array.isArray(data?.states) ? data.states : [];

    const matched: FlightResult[] = [];
    for (const state of states) {
      const callsign = (state[1] || "").trim().toUpperCase();
      if (!callsign) continue;
      const isMatch = mode === "airline" ? callsign.startsWith(rawQuery) : callsign === rawQuery;
      if (!isMatch) continue;
      matched.push(mapState(state));
      if (matched.length >= MAX_RESULTS) break;
    }

    return new Response(
      JSON.stringify({ query: rawQuery, mode, results: matched, updated: new Date().toISOString() }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=15" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/flights" };
