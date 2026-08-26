import type { Config } from "@netlify/functions";

// Powers the Sports panel's team picker: given a league, returns every team ESPN
// knows about in that league so the frontend can offer a live, accurate dropdown
// instead of a hand-maintained (and easily stale/wrong) list of team IDs.
// Sport/league slugs mirror ESPN's own hidden "site.api" URL convention, already
// used successfully elsewhere in this project (see sports.mts, TEAM_FEEDS).
const ALLOWED: Record<string, string> = {
  nfl: "football/nfl",
  "college-football": "football/college-football",
  nba: "basketball/nba",
  "mens-college-basketball": "basketball/mens-college-basketball",
  "womens-college-basketball": "basketball/womens-college-basketball",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

// ESPN's site.api is unofficial with no SLA — a browser-style user-agent avoids it
// treating us as a bot, and a hard timeout keeps a slow/hanging upstream connection
// from taking the whole function down with it.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export default async (req: Request) => {
  const url = new URL(req.url);
  const league = url.searchParams.get("league") || "";
  const path = ALLOWED[league];
  if (!path) {
    return new Response(JSON.stringify({ error: "unknown_league", known: Object.keys(ALLOWED) }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=999`, {
        headers: { "user-agent": BROWSER_UA, accept: "application/json, text/plain, */*" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) throw new Error("upstream status " + res.status);
    const data = await res.json();
    const groups: any[] = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    const teams = groups
      .map((g: any) => g.team)
      .filter(Boolean)
      .map((t: any) => ({ id: String(t.id), name: t.displayName || t.name || t.shortDisplayName || "" }))
      .filter((t: any) => t.id && t.name)
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ league, teams, updated: new Date().toISOString() }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
};

export const config: Config = { path: "/api/teams" };
